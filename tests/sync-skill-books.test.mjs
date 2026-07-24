import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = [
  '.claude/skills/sync-skill-books/sync.mjs',
  '.agents/skills/sync-skill-books/sync.mjs',
];

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initRepo(prefix) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.name', 'sync test');
  git(cwd, 'config', 'user.email', 'sync-test@example.com');
  return cwd;
}

function commitAll(cwd, message = 'fixture') {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
}

function makeSource({ symlink = false } = {}) {
  const cwd = initRepo('skill-books-source-');
  for (const sourceDir of ['.claude/skills', '.agents/skills']) {
    const skill = join(cwd, sourceDir, 'sample-skill');
    write(join(skill, 'SKILL.md'), `---\nname: sample-skill\ndescription: test\n---\n${sourceDir}\n`);
    if (symlink && sourceDir === '.agents/skills') {
      symlinkSync('SKILL.md', join(skill, 'linked.md'));
    }
  }
  commitAll(cwd);
  return cwd;
}

function defaultManifest(source) {
  return {
    repository: source,
    ref: 'main',
    sync: [
      { sourceDir: '.claude/skills', skills: ['sample-skill'] },
      { sourceDir: '.agents/skills', skills: ['sample-skill'] },
    ],
    lastSyncedCommit: '',
  };
}

function makeConsumer(source, manifest = defaultManifest(source), setup) {
  const cwd = initRepo('skill-books-consumer-');
  write(join(cwd, 'scripts/skill-books.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  write(join(cwd, '.agents/skills/local-only/SKILL.md'), 'local-only\n');
  setup?.(cwd);
  commitAll(cwd);
  return cwd;
}

function run(script, cwd, ...args) {
  return spawnSync(process.execPath, [join(repoRoot, script), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

for (const script of scripts) {
  describe(script, () => {
    test('check、apply、lastSyncedCommit、両sourceDir、冪等性を扱う', () => {
      const source = makeSource();
      const consumer = makeConsumer(source);
      const localPath = join(consumer, '.agents/skills/local-only/SKILL.md');

      const check = run(script, consumer, '--check');
      assert.equal(check.status, 1, check.stderr);
      assert.equal(readFileSync(localPath, 'utf8'), 'local-only\n');

      const apply = run(script, consumer);
      assert.equal(apply.status, 0, apply.stderr);
      assert.match(readFileSync(join(consumer, '.claude/skills/sample-skill/SKILL.md'), 'utf8'), /\.claude/);
      assert.match(readFileSync(join(consumer, '.agents/skills/sample-skill/SKILL.md'), 'utf8'), /\.agents/);
      assert.equal(readFileSync(localPath, 'utf8'), 'local-only\n');
      const manifest = JSON.parse(readFileSync(join(consumer, 'scripts/skill-books.manifest.json')));
      assert.equal(manifest.lastSyncedCommit, git(source, 'rev-parse', 'HEAD'));

      commitAll(consumer, 'sync');
      const again = run(script, consumer, '--check');
      assert.equal(again.status, 0, again.stderr);
      assert.match(again.stdout, /差分なし/);
    });

    test('dirty treeでは停止する', () => {
      const source = makeSource();
      const consumer = makeConsumer(source);
      write(join(consumer, 'untracked.txt'), 'dirty');
      const result = run(script, consumer, '--check');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /未コミット/);
    });

    for (const [name, mutate, pattern] of [
      ['不正entry', (m) => { m.sync = [null]; }, /オブジェクト/],
      ['sourceDir逸脱', (m) => { m.sync[0].sourceDir = '../outside'; }, /sourceDir/],
      ['skill名path traversal', (m) => { m.sync[0].skills = ['../escape']; }, /安全な単一/],
      ['target重複', (m) => { m.sync.push(m.sync[0]); }, /重複/],
      ['missing source', (m) => { m.sync[0].skills = ['missing-skill']; }, /存在しません/],
    ]) {
      test(`${name}をexit 2にする`, () => {
        const source = makeSource();
        const manifest = defaultManifest(source);
        mutate(manifest);
        const consumer = makeConsumer(source, manifest);
        const result = run(script, consumer, '--check');
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, pattern);
      });
    }

    test('同期元symlinkを拒否する', () => {
      const source = makeSource({ symlink: true });
      const manifest = defaultManifest(source);
      manifest.sync = [{ sourceDir: '.agents/skills', skills: ['sample-skill'] }];
      const consumer = makeConsumer(source, manifest);
      const result = run(script, consumer, '--check');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /symlink/);
    });

    test('同期先symlinkを拒否する', () => {
      const source = makeSource();
      const manifest = defaultManifest(source);
      manifest.sync = [{ sourceDir: '.agents/skills', skills: ['sample-skill'] }];
      const consumer = makeConsumer(source, manifest, (cwd) => {
        mkdirSync(join(cwd, '.agents/skills'), { recursive: true });
        symlinkSync('local-only', join(cwd, '.agents/skills/sample-skill'));
      });
      const result = run(script, consumer, '--check');
      assert.equal(result.status, 2);
      assert.match(result.stderr, /symlink/);
    });

    test('一時コピー失敗時に既存スキルを保持する', {
      skip: typeof process.getuid === 'function' && process.getuid() === 0,
    }, () => {
      const source = makeSource();
      const manifest = defaultManifest(source);
      manifest.sync = [{ sourceDir: '.agents/skills', skills: ['sample-skill'] }];
      const oldPath = '.agents/skills/sample-skill/SKILL.md';
      const consumer = makeConsumer(source, manifest, (cwd) => {
        write(join(cwd, oldPath), 'old version\n');
      });
      const parent = join(consumer, '.agents/skills');
      chmodSync(parent, 0o555);
      let result;
      try {
        result = run(script, consumer);
      } finally {
        chmodSync(parent, 0o755);
      }
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
      assert.equal(readFileSync(join(consumer, oldPath), 'utf8'), 'old version\n');
    });
  });
}

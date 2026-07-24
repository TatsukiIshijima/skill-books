#!/usr/bin/env node
// skill-books から消費側リポジトリへスキルをベンダリング(実コピー)する同期スクリプト。
//
// - Node.js の組み込みモジュールのみ使用(外部 npm 依存ゼロ)。
// - 外部プロセスは `git` のみを `spawnSync(..., { shell: false })` で呼び出す
//   (シェルコマンド・パイプは使わない)。Windows / macOS / Linux で同一挙動。
// - 消費側リポジトリのルートで実行する想定:
//     node .agents/skills/sync-skill-books/sync.mjs [--check] [--manifest <path>]
//
// マニフェスト(既定 scripts/skill-books.manifest.json)の形式:
//   {
//     "repository": "https://github.com/OWNER/skill-books.git",
//     "ref": "main",
//     "sync": [
//       { "sourceDir": ".claude/skills", "skills": ["create-pr", ...] },
//       { "sourceDir": ".agents/skills", "skills": ["create-pr", ...] }
//     ],
//     "lastSyncedCommit": ""
//   }
//
// 終了コード:
//   --check  : 0 = 差分なし / 1 = 差分あり(未適用) / 2 = エラー(マニフェスト不正・clone 失敗など)
//   通常実行 : 0 = 成功(差分の有無を問わず) / 2 = エラー
//     ※ 通常実行は適用に成功すれば差分の有無に関わらず 0 を返す。
//        `node sync.mjs && ...` のようなシェル連結・CI で「成功」を誤って失敗扱いしないため。

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const EXIT_NO_DIFF = 0;
const EXIT_DIFF = 1;
const EXIT_ERROR = 2;
const ALLOWED_SOURCE_DIRS = new Set(['.claude/skills', '.agents/skills']);
const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class SyncError extends Error {}

function fail(message) {
  throw new SyncError(message);
}

function git(args, opts = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', shell: false, ...opts });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} が失敗しました: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return res.stdout.trim();
}

function assertContained(base, target, label, allowEqual = false) {
  const rel = relative(base, target);
  const contained = (allowEqual || rel !== '')
    && rel !== '..'
    && !rel.startsWith(`..${sep}`)
    && !isAbsolute(rel);
  if (!contained) fail(`${label} が許可された範囲外を指しています: ${target}`);
}

function assertNoSymlinkInPath(base, target, label) {
  assertContained(base, target, label, true);
  let current = base;
  for (const part of relative(base, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      fail(`${label} に symlink を使用できません: ${current}`);
    }
  }
}

// dir 配下のファイルを相対パスのソート済み配列で返す(ディレクトリは含めない)。
function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (cur, rel) => {
    for (const name of readdirSync(cur).sort()) {
      const full = join(cur, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) fail(`スキル配下に symlink を使用できません: ${full}`);
      if (stat.isDirectory()) walk(full, relPath);
      else if (stat.isFile()) out.push(relPath);
      else fail(`スキル配下には通常ファイルとディレクトリだけを配置できます: ${full}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('マニフェストのルートはオブジェクトである必要があります');
  }
  if (typeof manifest.repository !== 'string' || manifest.repository.trim() === '') {
    fail('マニフェストの repository は空でない文字列である必要があります');
  }
  if (manifest.ref !== undefined && (typeof manifest.ref !== 'string' || manifest.ref.trim() === '')) {
    fail('マニフェストの ref は空でない文字列である必要があります');
  }
  if (manifest.lastSyncedCommit !== undefined && typeof manifest.lastSyncedCommit !== 'string') {
    fail('マニフェストの lastSyncedCommit は文字列である必要があります');
  }
  if (!Array.isArray(manifest.sync) || manifest.sync.length === 0) {
    fail('マニフェストの sync は空でない配列である必要があります');
  }

  const targets = new Set();
  for (const [index, entry] of manifest.sync.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`sync[${index}] はオブジェクトである必要があります`);
    }
    if (!ALLOWED_SOURCE_DIRS.has(entry.sourceDir)) {
      fail(`sync[${index}].sourceDir は .claude/skills または .agents/skills だけを指定できます`);
    }
    if (!Array.isArray(entry.skills) || entry.skills.length === 0) {
      fail(`sync[${index}].skills は空でない配列である必要があります`);
    }
    for (const [skillIndex, name] of entry.skills.entries()) {
      if (typeof name !== 'string' || !SAFE_SKILL_NAME.test(name)) {
        fail(`sync[${index}].skills[${skillIndex}] は安全な単一スキル名ではありません`);
      }
      const target = `${entry.sourceDir}/${name}`;
      if (targets.has(target)) fail(`同期先が重複しています: ${target}`);
      targets.add(target);
    }
  }
}

// 2 つのディレクトリの中身(ファイル一覧＋各ファイルのバイト列)が完全一致するか。
function dirsEqual(a, b) {
  const fa = listFiles(a);
  const fb = listFiles(b);
  if (fa.length !== fb.length || fa.some((f, i) => f !== fb[i])) return false;
  for (const f of fa) {
    if (!readFileSync(join(a, f)).equals(readFileSync(join(b, f)))) return false;
  }
  return true;
}

function replaceDirectorySafely(src, dest, repoRoot) {
  const parent = dirname(dest);
  assertNoSymlinkInPath(repoRoot, parent, '同期先の親ディレクトリ');
  mkdirSync(parent, { recursive: true });
  const token = randomUUID();
  const staged = join(parent, `.sync-skill-books-stage-${token}`);
  const backup = join(parent, `.sync-skill-books-backup-${token}`);
  let movedOld = false;
  let installed = false;

  try {
    // 既存スキルを動かす前にコピーを完了させる。
    cpSync(src, staged, { recursive: true, errorOnExist: true });
    if (!dirsEqual(src, staged)) throw new Error('一時コピーの検証に失敗しました');
    if (existsSync(dest)) {
      renameSync(dest, backup);
      movedOld = true;
    }
    renameSync(staged, dest);
    installed = true;
  } catch (error) {
    try {
      if (installed && existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      if (movedOld && existsSync(backup)) renameSync(backup, dest);
    } catch (rollbackError) {
      fail(`置換に失敗し、ロールバックにも失敗しました: ${error.message}; ${rollbackError.message}`);
    }
    fail(`既存スキルを保持したまま置換に失敗しました: ${error.message}`);
  } finally {
    if (existsSync(staged)) rmSync(staged, { recursive: true, force: true });
  }
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
}

function assertCleanRepository(repoRoot) {
  const topLevel = resolve(git(['rev-parse', '--show-toplevel'], { cwd: repoRoot }));
  if (topLevel !== repoRoot) fail(`リポジトリルートで実行してください: ${topLevel}`);
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot });
  if (dirty) fail('作業ツリーに未コミットの変更があります。commit または退避してから再実行してください');
}

function parseArgs(argv) {
  const args = { check: false, manifest: 'scripts/skill-books.manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--manifest') {
      args.manifest = argv[++i];
      if (!args.manifest) fail('--manifest にはパスを指定してください');
    } else if (a === '--help' || a === '-h') {
      console.log('使い方: node .agents/skills/sync-skill-books/sync.mjs [--check] [--manifest <path>]');
      process.exit(EXIT_NO_DIFF);
    } else {
      fail(`不明な引数: ${a}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(process.cwd());
  assertCleanRepository(repoRoot);
  const manifestPath = resolve(repoRoot, args.manifest);
  assertContained(repoRoot, manifestPath, 'マニフェスト');
  assertNoSymlinkInPath(repoRoot, manifestPath, 'マニフェスト');

  if (!existsSync(manifestPath)) {
    fail(`マニフェストが見つかりません: ${args.manifest}`);
  }
  if (!lstatSync(manifestPath).isFile()) fail('マニフェストは通常ファイルである必要があります');

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return fail(`マニフェストの JSON パースに失敗しました: ${e.message}`);
  }

  validateManifest(manifest);
  const { repository, ref = 'main', sync } = manifest;

  let tmp;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'skill-books-'));
  } catch (e) {
    return fail(`一時ディレクトリの作成に失敗しました: ${e.message}`);
  }

  const changes = []; // { sourceDir, name, status: 'new' | 'updated' }
  let headSha = '';

  try {
    try {
      // `--` で位置引数を終端し、repository/tmp が `-` 始まりでもオプション扱いされないようにする。
      git(['clone', '--depth', '1', '--branch', ref, '--', repository, tmp]);
    } catch (e) {
      return fail(e.message);
    }
    headSha = git(['rev-parse', 'HEAD'], { cwd: tmp });

    for (const entry of sync) {
      const { sourceDir, skills } = entry;
      for (const name of skills) {
        const sourceBase = resolve(tmp, sourceDir);
        const destBase = resolve(repoRoot, sourceDir);
        const src = resolve(sourceBase, name);
        const dest = resolve(destBase, name);
        assertContained(tmp, sourceBase, '同期元ディレクトリ');
        assertContained(repoRoot, destBase, '同期先ディレクトリ');
        assertContained(sourceBase, src, '同期元スキル');
        assertContained(destBase, dest, '同期先スキル');
        assertNoSymlinkInPath(tmp, src, '同期元スキル');
        assertNoSymlinkInPath(repoRoot, dest, '同期先スキル');
        if (!existsSync(src)) {
          fail(`${sourceDir}/${name} は skill-books 側に存在しません`);
        }
        listFiles(src);
        let status;
        if (!existsSync(dest)) status = 'new';
        else if (!dirsEqual(src, dest)) status = 'updated';
        else status = 'unchanged';

        if (status === 'unchanged') continue;
        changes.push({ sourceDir, name, status });

        if (!args.check) {
          replaceDirectorySafely(src, dest, repoRoot);
        }
      }
    }

    // 差分(ファイル変更)があった通常実行のときだけ lastSyncedCommit を更新する。
    // lastSyncedCommit は同期判定には使わない(判定は dirsEqual による内容比較)。
    // 最後に同期した skill-books の commit を記録する情報表示・追跡用の値。
    if (!args.check && changes.length > 0) {
      manifest.lastSyncedCommit = headSha;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }

  // レポート
  console.log(`[sync-skill-books] repository: ${repository} (ref: ${ref})`);
  console.log(`[sync-skill-books] commit: ${manifest.lastSyncedCommit || '(未記録)'} -> ${headSha}`);
  if (changes.length === 0) {
    console.log('[sync-skill-books] 差分なし(対象スキルはすべて最新です)');
  } else {
    console.log(`[sync-skill-books] ${args.check ? '差分あり(未適用):' : '同期しました:'}`);
    for (const c of changes) {
      const label = c.status === 'new' ? '新規' : '更新';
      console.log(`  - [${label}] ${c.sourceDir}/${c.name}`);
    }
  }

  // --check は「差分あり」を 1 で通知する(git diff --exit-code 相当)。
  // 通常実行は適用の成否だけを表し、成功なら差分の有無に関わらず 0 を返す。
  if (args.check) {
    process.exit(changes.length > 0 ? EXIT_DIFF : EXIT_NO_DIFF);
  }
  process.exit(EXIT_NO_DIFF);
}

try {
  main();
} catch (error) {
  const message = error instanceof SyncError ? error.message : `予期しない失敗: ${error.message}`;
  console.error(`[sync-skill-books] エラー: ${message}`);
  process.exitCode = EXIT_ERROR;
}

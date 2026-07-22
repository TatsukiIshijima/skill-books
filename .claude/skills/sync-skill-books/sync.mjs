#!/usr/bin/env node
// skill-books から消費側リポジトリへスキルをベンダリング(実コピー)する同期スクリプト。
//
// - Node.js の組み込みモジュールのみ使用(外部 npm 依存ゼロ)。
// - 外部プロセスは `git` のみを `spawnSync(..., { shell: false })` で呼び出す
//   (シェルコマンド・パイプは使わない)。Windows / macOS / Linux で同一挙動。
// - 消費側リポジトリのルートで実行する想定:
//     node .claude/skills/sync-skill-books/sync.mjs [--check] [--manifest <path>]
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
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const EXIT_NO_DIFF = 0;
const EXIT_DIFF = 1;
const EXIT_ERROR = 2;

function fail(message) {
  console.error(`[sync-skill-books] エラー: ${message}`);
  process.exit(EXIT_ERROR);
}

function git(args, opts = {}) {
  const res = spawnSync('git', args, { encoding: 'utf8', shell: false, ...opts });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} が失敗しました: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return res.stdout.trim();
}

// dir 配下のファイルを相対パスのソート済み配列で返す(ディレクトリは含めない)。
function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (cur, rel) => {
    for (const name of readdirSync(cur).sort()) {
      const full = join(cur, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else out.push(relPath);
    }
  };
  walk(dir, '');
  return out.sort();
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

function parseArgs(argv) {
  const args = { check: false, manifest: 'scripts/skill-books.manifest.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--manifest') {
      args.manifest = argv[++i];
      if (!args.manifest) fail('--manifest にはパスを指定してください');
    } else if (a === '--help' || a === '-h') {
      console.log('使い方: node .claude/skills/sync-skill-books/sync.mjs [--check] [--manifest <path>]');
      process.exit(EXIT_NO_DIFF);
    } else {
      fail(`不明な引数: ${a}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  if (!existsSync(args.manifest)) {
    fail(`マニフェストが見つかりません: ${args.manifest}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
  } catch (e) {
    return fail(`マニフェストの JSON パースに失敗しました: ${e.message}`);
  }

  const { repository, ref = 'main', sync } = manifest;
  if (!repository) fail('マニフェストに repository がありません');
  if (!Array.isArray(sync) || sync.length === 0) fail('マニフェストの sync が空です');

  let tmp;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'skill-books-'));
  } catch (e) {
    return fail(`一時ディレクトリの作成に失敗しました: ${e.message}`);
  }

  const changes = []; // { sourceDir, name, status: 'new' | 'updated' }
  const warnings = [];
  let headSha = '';

  try {
    try {
      git(['clone', '--depth', '1', '--branch', ref, repository, tmp]);
    } catch (e) {
      return fail(e.message);
    }
    headSha = git(['rev-parse', 'HEAD'], { cwd: tmp });

    for (const entry of sync) {
      const { sourceDir, skills } = entry;
      if (!sourceDir || !Array.isArray(skills)) {
        warnings.push(`sync エントリの形式が不正です(sourceDir / skills): ${JSON.stringify(entry)}`);
        continue;
      }
      for (const name of skills) {
        const src = join(tmp, sourceDir, name);
        const dest = join(repoRoot, sourceDir, name);
        if (!existsSync(src)) {
          warnings.push(`${sourceDir}/${name} は skill-books 側に存在しません(スキップ・ローカルは変更しない)`);
          continue;
        }
        let status;
        if (!existsSync(dest)) status = 'new';
        else if (!dirsEqual(src, dest)) status = 'updated';
        else status = 'unchanged';

        if (status === 'unchanged') continue;
        changes.push({ sourceDir, name, status });

        if (!args.check) {
          rmSync(dest, { recursive: true, force: true });
          cpSync(src, dest, { recursive: true });
        }
      }
    }

    // 差分(ファイル変更)があった通常実行のときだけ lastSyncedCommit を更新する。
    if (!args.check && changes.length > 0) {
      manifest.lastSyncedCommit = headSha;
      writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
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
  for (const w of warnings) console.warn(`[sync-skill-books] 警告: ${w}`);

  // --check は「差分あり」を 1 で通知する(git diff --exit-code 相当)。
  // 通常実行は適用の成否だけを表し、成功なら差分の有無に関わらず 0 を返す。
  if (args.check) {
    process.exit(changes.length > 0 ? EXIT_DIFF : EXIT_NO_DIFF);
  }
  process.exit(EXIT_NO_DIFF);
}

main();

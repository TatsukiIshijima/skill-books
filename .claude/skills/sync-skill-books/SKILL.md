---
name: sync-skill-books
description: skill-books の最新スキルを、導入先(消費側)リポジトリにベンダリング(実コピー)して同期し、差分があれば同期用ブランチに PR を作成する。マニフェスト(scripts/skill-books.manifest.json)で対象スキルを管理する。「スキルを同期して」「skill-books を取り込んで」「skill-books を更新して」のような依頼、または定期実行ルーチンから使う。
---

# skill-books の同期

skill-books のスキルを、導入先リポジトリの `.claude/skills/` / `.agents/skills/` に
**実ファイルとしてコピー(ベンダリング)** して同期する。Claude Code on the web のように
毎回リポジトリを fresh clone する環境でも、スキルが実体として存在するので確実に discover される。

同梱の `sync.mjs`(Node.js・組み込みモジュールのみ)がコピーを担う。このスキルは差分を確認し、
変更があれば同期用ブランチに commit / push して **PR を作成** するところまでを行う。マージは人間が判断する。

---

## 役割

- 対象スキルの一覧・取得元は導入先の **マニフェスト**(既定 `scripts/skill-books.manifest.json`)で管理する。
- マニフェストに列挙されたスキルだけを上書き・追加し、**列挙されていないローカル固有スキルには一切触れない**。
- 差分があるときのみ PR を作る。差分が無ければ何もせず「対象なし」で終了する(空 PR を作らない)。

このスキルの責務は **同期と PR 作成のみ**。スキルの中身の設計・改修は skill-books 側で行う。

---

## 引数

- `$ARGUMENTS` = 任意。`--manifest <path>` でマニフェストの場所を上書きできる(既定 `scripts/skill-books.manifest.json`)。
- 引数が無ければ既定のマニフェストで同期する。

---

## 前提条件

- 導入先リポジトリのルートで実行する。
- マニフェスト(`scripts/skill-books.manifest.json`)が存在し、`repository` / `ref` / `sync[]` を持つこと。
- `git` が利用可能で、対象の skill-books リポジトリを clone できること。
- PR 作成には `gh` を使う。`gh auth status` で認証を確認できること。

---

## ワークフロー

### 1. 差分の確認(未適用のドライラン)

まず差分の有無だけを確認する(この時点ではファイルを書き換えない)。

```bash
node .claude/skills/sync-skill-books/sync.mjs --check
```

終了コードで判定する:

- 🟢 `0`(差分なし) → **何もせず「対象なし」で報告して終了**(PR は作らない)。
- 🟡 `1`(差分あり) → ステップ2へ進む。
- 🔴 `2`(エラー) → 出力の理由を添えて停止・報告する。

### 2. 同期用ブランチの作成

デフォルトブランチを検出し(`<base>`)、そこから同期用ブランチを切る。**`<base>` 上で直接作業しない。**

```bash
git remote show origin | sed -n 's/.*HEAD branch: //p'   # <base> を検出
git fetch origin <base>
git checkout -b claude/sync-skills/$(date +%Y%m%d) origin/<base>
```

### 3. 同期の適用

`--check` なしで実行し、実際にスキルをコピー・`lastSyncedCommit` を更新する。

```bash
node .claude/skills/sync-skill-books/sync.mjs
```

出力の変更サマリ(新規 / 更新スキル・旧→新 commit)を控えておく。

### 4. 差分レビュー

commit する前に `git status` / `git diff` で変更を確認し、次を要約する:

- 追加・更新されたスキル(`.claude/skills` / `.agents/skills` 別)
- **削除されたスキル**(skill-books 側から消えたものは `sync.mjs` が警告する。ローカルは自動削除しないので、必要なら手動対応)
- 破壊的変更や、`SKILL.md` の `name` / `description` frontmatter の欠落が無いか

マニフェストに列挙していないローカル固有スキル(例: 導入先の `fix-*`)が変更されていないことも確認する。

### 5. commit と push

日本語のコミットメッセージで、同期された差分とマニフェスト(`lastSyncedCommit`)をまとめて commit し push する。

```bash
git add -A
git commit -m "chore: skill-books のスキルを同期"
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
```

### 6. PR の作成

- **base**: 検出した `<base>`(`main` と決め打ちしない)。
- **タイトル**: 変更を端的に表す日本語。
- **本文**: 導入先の PR テンプレートがあればその構成に沿い、同期した commit(旧→新)・追加/更新/削除スキルの一覧を含める。
- 本文は一時ファイルに書き `--body-file` で渡す。

```bash
gh pr create --base <base> --title "<日本語タイトル>" --body-file <本文の一時ファイル>
```

作成した PR の URL を報告して完了。

---

## 停止・報告ポイント

次の場合は、それまでの結果を添えて明確に報告し停止する:

- `sync.mjs --check` がエラー(終了コード 2)を返した(マニフェスト不正・clone 失敗など)
- デフォルトブランチの検出に失敗した / `<base>` 上から離れられない
- `git push` の失敗(認証など)/ `gh pr create` の失敗
- 差分レビューで、削除・破壊的変更など**人間の判断が要る**と考えられる変更を検知した(PR は作らず内容を報告してエスカレーションする)

---

## 注意

- **`<base>`(デフォルトブランチ)への直接 push は禁止**。push してよいのは `claude/sync-skills/*` のみ。
- **PR のマージはしない**(マージ判断は人間が行う)。
- **マニフェストの `sync[].skills[]` に列挙されていないスキルは変更しない**。ローカル固有スキルの保護はこのルールに依存する。
- スキルの中身を導入先で手編集しない。修正は skill-books 側で行い、次回同期で反映する。
- 差分が無ければ **PR を作らない**(空 PR を作らない)。
- 導入先固有のコマンド(例: `pnpm run sync-skills` のようなラッパー)がある場合はそれを使ってもよいが、スクリプト自体は `node` 単体で動く。

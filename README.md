# skill-books

Claude Code / Codex で使うスキルを管理するリポジトリ。
各エージェントがホームディレクトリで期待する配置(`~/.claude/skills/`、`~/.agents/skills/`)を
そのままリポジトリ内にミラーしているため、クローンしてリンクを張るだけで使える。

## 構成

```
skill-books/
├── .claude/
│   └── skills/          # Claude Code 向けスキル
│       ├── create-pr/
│       ├── multi-agent-code-review/
│       ├── pr-review-triage/
│       ├── spec-to-plan/
│       └── sync-skill-books/
└── .agents/
    └── skills/          # Codex 向けスキル
        ├── create-pr/
        ├── multi-agent-code-review/
        ├── pr-review-triage/
        ├── spec-to-plan/
        └── sync-skill-books/
```

## セットアップ

クローン後、スキル単位でシンボリックリンクを張る:

```bash
# Claude Code
ln -s "$(pwd)/.claude/skills/create-pr" ~/.claude/skills/create-pr
ln -s "$(pwd)/.claude/skills/pr-review-triage" ~/.claude/skills/pr-review-triage
ln -s "$(pwd)/.claude/skills/multi-agent-code-review" ~/.claude/skills/multi-agent-code-review
ln -s "$(pwd)/.claude/skills/spec-to-plan" ~/.claude/skills/spec-to-plan
ln -s "$(pwd)/.claude/skills/sync-skill-books" ~/.claude/skills/sync-skill-books

# Codex
ln -s "$(pwd)/.agents/skills/create-pr" ~/.agents/skills/create-pr
ln -s "$(pwd)/.agents/skills/pr-review-triage" ~/.agents/skills/pr-review-triage
ln -s "$(pwd)/.agents/skills/multi-agent-code-review" ~/.agents/skills/multi-agent-code-review
ln -s "$(pwd)/.agents/skills/spec-to-plan" ~/.agents/skills/spec-to-plan
ln -s "$(pwd)/.agents/skills/sync-skill-books" ~/.agents/skills/sync-skill-books
```

`~/.claude/skills/`(または `~/.agents/skills/`)をまだ何にも使っていない場合は、
ディレクトリごとリンクしてもよい。

なお、このリポジトリ内で各エージェントを開いた場合は、Claude Code は
`.claude/skills/`、Codex は `.agents/skills/` をプロジェクトスキルとして自動発見するため、
リンクなしでも使える。

## スキル一覧

| スキル | 説明 | Claude Code | Codex |
|---|---|---|---|
| create-pr | 現在のブランチを push し、日本語のタイトル・本文で GitHub PR を作成する | ✅ | ✅ |
| multi-agent-code-review | 複数観点のサブエージェントを並列起動してコードレビューする(プロジェクト固有ルールは導入先の `.claude/code-review/` または `.agents/code-review/` で設定) | ✅ | ✅ |
| pr-review-triage | PRに人間によるレビューが必要かを判定し、結果をPRコメントとして投稿する | ✅ | ✅ |
| spec-to-plan | 機能・タスクの要望を1問ずつ質問で詰めて仕様書・ADR・実装計画を作成する(プロジェクト固有の観点・基準は導入先の `.claude/spec-to-plan/` または `.agents/spec-to-plan/` で設定) | ✅ | ✅ |
| sync-skill-books | skill-books のスキルを導入先リポジトリにベンダリング(実コピー)して同期し、差分があれば環境別の `claude/sync-skills/*` または `codex/sync-skills/*` に PR を作成する | ✅ | ✅ |

## 別リポジトリへの取り込み(ベンダリング同期)

Claude Code on the web のように**毎回リポジトリを fresh clone する環境**では、シンボリックリンクや
submodule は解決に失敗しうる。この場合は `sync-skill-books` スキルで、必要なスキルを導入先リポジトリに
**実ファイルとしてコピー(ベンダリング)** してコミットする。取り込んだスキルは実体として存在するため、
どの環境でも確実に discover される。skill-books の更新は再同期(PR 自動作成)で追随する。

導入手順(導入先リポジトリ側):

1. 使用する環境に応じて `.claude/skills/sync-skill-books/manifest.template.json` または
   `.agents/skills/sync-skill-books/manifest.template.json` を導入先の
   `scripts/skill-books.manifest.json` にコピーし、`sync[].skills[]` に取り込みたいスキル名を列挙する。
2. 導入先のルートで初回同期を実行する。

   ```bash
   # Claude Code
   node .claude/skills/sync-skill-books/sync.mjs

   # Codex
   node .agents/skills/sync-skill-books/sync.mjs
   ```

   `sync-skill-books` 自体を含めてベンダリングしておくと、以降は導入先内でこのスキルを使って自己更新できる。
3. 取り込んだスキル一式と `scripts/skill-books.manifest.json` をコミットする。
4. 以降の更新は `sync-skill-books` スキル、または使用環境側の `sync.mjs` で行う。
   定期実行ルーチンから呼べば、差分があるときだけ同期 PR が自動作成される。

`sync.mjs` は Node.js の組み込みモジュールのみで書かれており(外部 npm 依存ゼロ)、`git` のみを
シェルを介さず呼ぶため Windows / macOS / Linux で動作する。`--check` で差分の有無だけを終了コードで返す
(0=差分なし / 1=差分あり / 2=エラー)。

## スキルの追加方法

1. Claude Code 向けは `.claude/skills/<スキル名>/SKILL.md`、Codex 向けは `.agents/skills/<スキル名>/SKILL.md` を作成する(frontmatter に `name` と `description` が必須)
2. 補助資料は各スキルの `references/` に置く
3. 各エージェントの仕様差を反映し、両方のスキルを同じ機能に保つ
4. 他の環境で使う場合は上記と同様にシンボリックリンクを張る

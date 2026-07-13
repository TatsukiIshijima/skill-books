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
│       └── pr-review-triage/
└── .agents/
    └── skills/          # Codex 向けスキル
        ├── create-pr/
        └── pr-review-triage/
```

## セットアップ

クローン後、スキル単位でシンボリックリンクを張る:

```bash
# Claude Code
ln -s "$(pwd)/.claude/skills/create-pr" ~/.claude/skills/create-pr
ln -s "$(pwd)/.claude/skills/pr-review-triage" ~/.claude/skills/pr-review-triage

# Codex
ln -s "$(pwd)/.agents/skills/create-pr" ~/.agents/skills/create-pr
ln -s "$(pwd)/.agents/skills/pr-review-triage" ~/.agents/skills/pr-review-triage
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
| pr-review-triage | PRに人間によるレビューが必要かを判定し、結果をPRコメントとして投稿する | ✅ | ✅ |

## スキルの追加方法

1. Claude Code 向けは `.claude/skills/<スキル名>/SKILL.md`、Codex 向けは `.agents/skills/<スキル名>/SKILL.md` を作成する(frontmatter に `name` と `description` が必須)
2. 補助資料は各スキルの `references/` に置く
3. 各エージェントの仕様差を反映し、両方のスキルを同じ機能に保つ
4. 他の環境で使う場合は上記と同様にシンボリックリンクを張る

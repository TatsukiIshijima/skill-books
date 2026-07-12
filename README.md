# skill-books

Claude Code / Codex で使うスキルを管理するリポジトリ。
各エージェントがホームディレクトリで期待する配置(`~/.claude/skills/`、`~/.agents/skills/`)を
そのままリポジトリ内にミラーしているため、クローンしてリンクを張るだけで使える。

## 構成

```
skill-books/
├── .claude/
│   └── skills/          # Claude Code 向けスキル
│       └── pr-review-triage/
└── .agents/
    └── skills/          # Codex 向けスキル
        └── pr-review-triage/
```

## セットアップ

クローン後、スキル単位でシンボリックリンクを張る:

```bash
# Claude Code
ln -s "$(pwd)/.claude/skills/pr-review-triage" ~/.claude/skills/pr-review-triage

# Codex
ln -s "$(pwd)/.agents/skills/pr-review-triage" ~/.agents/skills/pr-review-triage
```

`~/.claude/skills/`(または `~/.agents/skills/`)をまだ何にも使っていない場合は、
ディレクトリごとリンクしてもよい。

なお、このリポジトリ内で Claude Code を開いた場合は `.claude/skills/` が
プロジェクトスキルとして自動発見されるため、リンクなしでも使える。

## スキル一覧

| スキル | 説明 | Claude Code | Codex |
|---|---|---|---|
| pr-review-triage | PRに人間によるレビューが必要かを判定し、結果をPRコメントとして投稿する | ✅ | ✅ |

## スキルの追加方法

1. `.claude/skills/<スキル名>/SKILL.md` を作成する(frontmatterに `name` と `description` が必須)
2. 補助資料は `.claude/skills/<スキル名>/references/` に置く
3. 他の環境で使う場合は上記と同様にシンボリックリンクを張る

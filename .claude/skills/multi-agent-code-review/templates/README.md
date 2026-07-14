# プロジェクトへの導入手順

multi-agent-code-review スキルは、プロジェクト固有のルールを
**導入先プロジェクトの `.claude/code-review/` ディレクトリ**から読む。
このディレクトリの雛形が `templates/` にある。

## セットアップ

導入先プロジェクトのルートで:

```bash
mkdir -p .claude/code-review
cp <このスキルのディレクトリ>/templates/architecture.md .claude/code-review/architecture.md
# 必要に応じて任意の設定もコピー
cp <このスキルのディレクトリ>/templates/maintainability.md .claude/code-review/maintainability.md
cp <このスキルのディレクトリ>/templates/testing.md .claude/code-review/testing.md
```

コピーした雛形の `<!-- ... -->` コメントの指示に従って、プロジェクトのルール・制約・
推奨事項を書き込む。書き込みが終わったらコメントは削除してよい。

## 設定ファイル一覧

| ファイル | 対応する観点 | 必須? | 未設定時の動作 |
|---|---|---|---|
| `architecture.md` | architecture | **必須** | architecture 観点はスキップされ、レポートに「未設定」と明記される |
| `maintainability.md` | maintainability | 任意 | 汎用チェックリストのみでレビュー |
| `testing.md` | testing | 任意 | 汎用チェックリストのみでレビュー |
| `security.md` | security | 任意 | 汎用チェックリストのみでレビュー(雛形なし。追加ルールを自由書式で書けば読まれる) |
| `correctness.md` | correctness | 任意 | 汎用チェックリストのみでレビュー(同上) |
| `custom-<名前>.md` | プロジェクト独自観点 | 任意 | 存在するファイルごとに独自観点が追加される |

## 独自観点(custom-*.md)の追加

汎用6観点でカバーできないプロジェクト固有の観点(例: Unity のアセット変更、
DB マイグレーション、多言語リソースの整合)は、`custom-<名前>.md` として追加できる。
書き方は `templates/custom-example.md`(Unity アセット観点の実例)を参照。

各ファイルには以下を必ず書く:

- **役割**: この観点が何を守るのか
- **起動条件**: どんな変更が diff に含まれるときにこの観点を起動するか(パスパターン等)
- **チェックリスト**: 見るポイント
- **判定基準**: どんな発見をどの重要度にするか

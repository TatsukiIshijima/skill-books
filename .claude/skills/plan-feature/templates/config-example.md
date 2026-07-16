# plan-feature プロジェクト設定の例

このファイルを導入先リポジトリの `.claude/plan-feature/config.md` にコピーして編集する。
すべてのセクションは任意。不要なセクションは削除してよい。

以下は Unity プロジェクトでの記入例。

## 質問観点(追加)

- 対象レイヤーと責務分担(Domain は純粋 C# / UnityEngine 非依存。Unity 固有は Data・Presentation・App)
- 調整値の ScriptableObject 化の要否
- 当たり判定(Physics2D Trigger)への影響

## 完了条件の品質ゲート(既定)

- TDD(Red → Green → Refactor)で進める
- EditMode の全テストがグリーン
- 対象コードのカバレッジ 80% 以上

## 計画テンプレートへの追記

### 留意点(固定)

- `.meta` を削除しない
- `Library/` `Temp/` `Logs/` `obj/` は触らない

## 保存先

- 仕様書: docs/specs/
- ADR: docs/adr/
- 計画: docs/plans/

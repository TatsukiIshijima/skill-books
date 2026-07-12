# Android固有ルール

Androidプロジェクト(`AndroidManifest.xml` / `build.gradle(.kts)` / `src/main/java|kotlin` を含むPR)に適用する。
共通ルール(`../common/rules.md`)に上乗せして評価する。

## 人間レビュー必要パターン

| ルール名 | パターン / 条件 | 理由 |
|---|---|---|
| マニフェスト | `**/AndroidManifest.xml`(特にpermission・exported・intent-filterの変更) | 権限・公開コンポーネントの変更はセキュリティ審査とストア審査に直結する |
| ProGuard / R8 | `**/proguard-rules.pro`, `**/consumer-rules.pro`, minify設定の変更 | 難読化ルールのミスはリリースビルドでのみクラッシュとして発覚する |
| 署名・リリース設定 | signingConfig、versionCode/versionName、`**/*.keystore` 関連 | リリース事故に直結する |
| ビルドバリアント・フレーバー | productFlavors / buildTypes の追加・変更 | 全バリアントへの影響確認が必要 |
| データ永続化のスキーマ | Room の `@Entity`・`Migration`、SharedPreferences/DataStore のキー変更 | アップデート時のデータ移行不備は復旧が難しい |

## 人間レビュー不要候補パターン

| ルール名 | パターン / 条件 | 確認ポイント |
|---|---|---|
| リソース文言のみ | `**/res/values*/strings.xml` の文言修正のみ | プレースホルダ(`%1$s` 等)の増減がないか |
| lint設定の緩和なし変更 | `lint.xml` 等でチェックを厳しくする方向のみの変更 | チェックの無効化・緩和が混ざっていれば不要候補から外す |

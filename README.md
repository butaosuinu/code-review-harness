# code-review-harness

コーディングエージェントが生成した PR のリスクを静的解析 + AI で自動分類し、低リスクは auto-merge、高リスクは人間レビューへ誘導する汎用ハーネス。

## 構成

pnpm workspaces のモノレポ。

```
packages/
  shared/       — 型定義 + config スキーマ (@butaosuinu/harness-shared)
  classifier/   — 静的解析ベースのリスク分類 (@butaosuinu/harness-classifier)
  cli/          — harness CLI (@butaosuinu/harness-cli)
templates/
  configs/      — .harness/config.yml のスタック別雛形
```

詳細な仕様は [plan.md](./plan.md) を参照。

## 要件

- Node.js 20+
- pnpm 9+

## セットアップ

```bash
pnpm install
pnpm build
pnpm test
```

## 実装フェーズ

| Phase | 内容                                       | 状態 |
| ----- | ------------------------------------------ | ---- |
| 1     | `packages/shared` (型 + config スキーマ)   | WIP  |
| 2     | `packages/classifier` (静的解析エンジン)   | WIP  |
| 3     | `packages/cli` (init / classify / rules)   | WIP  |
| 4     | `actions/` composite actions + templates   | TBD  |
| 5     | `packages/reviewer` (AI Review)            | TBD  |
| 6     | auto-merge + polish                        | TBD  |

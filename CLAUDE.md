# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリ概要

コーディングエージェントが生成した PR のリスクを静的解析 + AI で自動分類し、低リスクは auto-merge、高リスクは人間レビューへ誘導するハーネス。pnpm workspaces のモノレポ。完全な仕様書は `plan.md` にあり、本ファイルは Claude が作業を始めるための最小情報だけ扱う。

実装は Phase ベースで進行中:

- Phase 1 (`packages/shared`) / Phase 2 (`packages/classifier`) / Phase 3 (`packages/cli`) — 実装済みで WIP
- Phase 4 (`actions/*/action.yml` + `templates/workflows/`) / Phase 5 (`packages/reviewer`) / Phase 6 (auto-merge) — まだディレクトリ自体が無い。新規作成する場合は `plan.md` のレイアウトに従う

## 主要コマンド (リポルートから)

- `pnpm install` — 初回 / 依存更新時
- `pnpm -r build` — 全パッケージを tsup で dist へ出力
- `pnpm -r test` — 全パッケージの vitest 実行
- `pnpm -r test:types` — 全パッケージの `tsc --noEmit` (型チェック)。`lint` スクリプトも同じく `tsc --noEmit` で、実質 linter は型チェックのみ

### 単一テスト / 単一パッケージ

- 1 パッケージだけ動かす: `pnpm --filter @butaosuinu/harness-classifier test`
- 1 テストファイルだけ動かす: パッケージ配下で `pnpm exec vitest run src/__tests__/pipeline.test.ts`
- 特定テスト名で絞る: `pnpm exec vitest run -t "pattern match"`

### CLI をローカルで試す

- `pnpm --filter @butaosuinu/harness-cli build` 後に `node packages/cli/dist/index.js <subcommand>` で起動
- サブコマンド: `init` (対話で `.harness/config.yml` 生成 / `-y` で無対話) / `classify` (`--base-sha` 必須、`--output json` で機械可読) / `rules validate` / `rules test <file>`

## 環境要件

- Node.js 20+ (`.node-version` = 20) / pnpm 10.28.2 (`packageManager` 固定)
- `tree-sitter` 系は `packages/classifier/package.json` の **optionalDependencies**。native ビルド失敗時は AST engine が自動でスキップされるため、ネイティブビルド環境が無くても `pnpm install` 自体は通ること

## アーキテクチャ (big picture)

### パッケージ依存方向

```
shared  ←  classifier  ←  cli
           (optionalDep: tree-sitter*)
```

- `@butaosuinu/harness-shared` — 型 (`DiffFile` / `ClassifyResult` / `MatchedRule` …) と zod config スキーマ (`HarnessConfigSchema`)。副作用なし・依存は zod のみ
- `@butaosuinu/harness-classifier` — **純粋関数のみ**。GitHub API / fs 読み込みは一切呼ばない。呼び出し側から `readFile: (filename) => Promise<string>` を渡してもらう構造 (`packages/classifier/src/pipeline.ts:15`)
- `@butaosuinu/harness-cli` — I/O 層。`commander` でサブコマンドを登録し、diff 収集 (`git diff` or Octokit)・config 読み込み・結果出力を担当

### classify pipeline (`packages/classifier/src/pipeline.ts`)

**fail-fast**。`high` が確定した時点で後続 Step をスキップ:

1. `engines/file-pattern.ts` — minimatch で glob 照合
2. `engines/ast.ts` — tree-sitter で S 式クエリ実行。parser は拡張子ごとに遅延ロード + キャッシュ
3. `engines/dependency.ts` — `package.json` 等の patch から追加パッケージ名を抽出し blocklist 照合
4. `engines/diff-size.ts` — ファイル数 / 総変更行数の上限
5. (low-risk override) 全ファイルが `risk_rules.low.file_patterns` に収まれば LOW 確定

Step 1–4 全通過 → LOW (後続 AI review へ回す想定)

### 設定ファイル

- `.harness/config.yml` — ユーザープロジェクトに生成される実行時設定。本リポ内には雛形だけ置いてある (`templates/configs/{base,prisma-auth0,drizzle-supabase,typeorm-nextauth}.yml`)
- `packages/cli/src/templates.ts` はビルド後 (`dist/`) からも src 実行時 (vitest) からも templates ディレクトリを解決できるよう複数候補を試す。CLI パッケージの `package.json` で `files: ["dist", "../../templates"]` を含めて配布することに注意 — templates のパスを変える時はここも要更新

## 実装上の非自明な制約 (plan.md 由来)

- **classifier は pure に保つ**。GitHub API / fs / ネットワークを触らない。CLI レイヤーにのみ副作用を閉じ込める
- **tree-sitter query エラーはスキップして継続**。ユーザー記述のカスタム AST クエリが不正でも全体をクラッシュさせない (`engines/ast.ts` の try/catch パターンを維持する)
- **ファイル glob は GHA の `@actions/glob` 解釈に合わせる**。現状は minimatch を `{ dot: true }` で使用
- **PR コメントは必ず更新投稿** (HTML コメントマーカー `harness[classify]` / `harness[ai-review]` 経由)。新規投稿を繰り返す実装にしない (Phase 4 で守る)
- **`ANTHROPIC_API_KEY` 未設定時は reviewer フェーズをスキップし GHA を fail**。panic しない (Phase 5 以降)

## CI

`.github/workflows/ci.yml` — `pnpm install --frozen-lockfile` → `pnpm -r build` → `pnpm -r test:types` → `pnpm -r test`。pnpm は v10 を `pnpm/action-setup@v4` で固定している。

## テスト運用

- classifier のテストは `packages/classifier/src/__tests__/` に engine ごとのユニット + `pipeline.test.ts` (エンドツーエンド)
- diff fixture は `__tests__/fixtures/diffs/*.diff` に置き、`parseUnifiedDiff` で `DiffFile[]` に変換して流す
- reviewer 実装時は Anthropic SDK をモック化し、本物の API を叩く E2E は CI から分離する

## 多段ステップ実装時の規約

Phase 単位 / engine 単位など複数ステップに分かれる実装では、step ごとに `git commit` を打つ (一つにまとめない)。履歴を細かく保って revert しやすくする方針。

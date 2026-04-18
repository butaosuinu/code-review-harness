# harness — Claude Code Project Specification

## プロジェクト概要

コーディングエージェント（Claude Code等）が生成したコードの評価に特化した、汎用ハーネスエンジニアリングツール。
PRのリスクを静的解析＋AIで自動分類し、低リスクは自動マージ・高リスクは人間レビューへ誘導する。

---

## 実装言語・技術スタック

- **言語**: TypeScript (strict mode)
- **パッケージマネージャ**: pnpm workspaces (モノレポ)
- **ランタイム**: Node.js 20+
- **主要依存ライブラリ**:
  - `tree-sitter` + `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-ruby` — AST解析
  - `@anthropic-ai/sdk` — AI review
  - `@octokit/rest` — GitHub API
  - `commander` — CLI
  - `inquirer` — インタラクティブプロンプト
  - `glob` — ファイルパターンマッチ
  - `js-yaml` — YAML設定ファイル読み書き
  - `zod` — 設定スキーマバリデーション
  - `vitest` — テスト
  - `tsup` — ビルド

---

## モノレポ構成

```
harness/
├── CLAUDE.md                      # このファイル
├── package.json                   # ルートworkspace定義
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .github/
│   └── workflows/
│       └── ci.yml                 # harness自身のCI
├── packages/
│   ├── shared/                    # @harness/shared
│   │   ├── src/
│   │   │   ├── types.ts           # 全パッケージ共通の型定義
│   │   │   ├── schema.ts          # config.yml zodスキーマ
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── classifier/                # @harness/classifier
│   │   ├── src/
│   │   │   ├── index.ts           # classify() エントリポイント
│   │   │   ├── engines/
│   │   │   │   ├── file-pattern.ts
│   │   │   │   ├── ast.ts
│   │   │   │   ├── dependency.ts
│   │   │   │   └── diff-size.ts
│   │   │   └── pipeline.ts        # 評価パイプライン（Step 1-5）
│   │   ├── src/__tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── reviewer/                  # @harness/reviewer
│   │   ├── src/
│   │   │   ├── index.ts           # review() エントリポイント
│   │   │   ├── prompt.ts          # Claude APIプロンプト構築
│   │   │   ├── splitter.ts        # diffのトークン分割
│   │   │   └── github.ts          # PRコメント・Reviewの投稿
│   │   ├── src/__tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/                       # @harness/cli
│       ├── src/
│       │   ├── index.ts           # CLIエントリポイント
│       │   └── commands/
│       │       ├── init.ts
│       │       ├── classify.ts
│       │       ├── review.ts
│       │       └── rules.ts
│       ├── package.json
│       └── tsconfig.json
├── actions/
│   ├── classify/
│   │   └── action.yml             # Composite GHA action
│   ├── ai-review/
│   │   └── action.yml
│   └── auto-merge/
│       └── action.yml
└── templates/
    ├── workflows/
    │   └── harness-check.yml      # ユーザープロジェクトへコピーするGHA
    └── configs/
        ├── prisma-auth0.yml       # スタック別config雛形
        ├── drizzle-supabase.yml
        ├── typeorm-nextauth.yml
        └── base.yml               # 最小構成
```

---

## 実装順序（この順番で実装すること）

### Phase 1: 共通基盤
`packages/shared` を先に完成させる。他パッケージが型に依存するため。

### Phase 2: 分類エンジン
`packages/classifier` を実装。純粋関数で副作用なし。vitestでユニットテストを必ず書く。

### Phase 3: CLI基礎コマンド
`packages/cli` の `init` と `classify` コマンドを実装。

### Phase 4: GitHub Actions
`actions/` 配下のcomposite actionsと `templates/workflows/harness-check.yml` を実装。

### Phase 5: AI Review
`packages/reviewer` を実装。Anthropic SDK統合とGitHub Review API連携。

### Phase 6: Auto-merge & ポリッシュ
`actions/auto-merge` の実装。エラーハンドリング・observability強化。

---

## 型定義（packages/shared/src/types.ts）

```typescript
export type RiskLevel = 'high' | 'low'

export interface ClassifyResult {
  riskLevel: RiskLevel
  matchedRules: MatchedRule[]
  summary: string
}

export interface MatchedRule {
  ruleId: string
  ruleType: 'file_pattern' | 'ast' | 'dependency' | 'diff_size'
  description: string
  matches: RuleMatch[]
}

export interface RuleMatch {
  file: string
  line?: number
  snippet?: string
}

export interface ReviewResult {
  score: number               // 0-100
  summary: string
  concerns: ReviewConcern[]
  recommendation: 'approve' | 'request_changes'
}

export interface ReviewConcern {
  file: string
  line: number
  severity: 'low' | 'medium' | 'high'
  message: string
}

export interface DiffFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  patch?: string
  previousFilename?: string
}
```

## 設定スキーマ（packages/shared/src/schema.ts）

zodを使い `.harness/config.yml` のスキーマを定義する。以下が完全なスキーマ:

```typescript
import { z } from 'zod'

const AstRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  query: z.string(),  // tree-sitter S式クエリ
})

const RiskRulesSchema = z.object({
  file_patterns: z.array(z.string()).default([]),
  ast_rules: z.array(AstRuleSchema).default([]),
  dependency_rules: z.object({
    added_packages: z.array(z.string()).default([]),
  }).default({}),
  diff_size: z.object({
    max_files: z.number().default(20),
    max_lines: z.number().default(500),
  }).default({}),
})

export const HarnessConfigSchema = z.object({
  harness: z.object({
    version: z.literal('1'),
    stack: z.object({
      databases: z.array(z.object({
        type: z.string(),
        orm: z.string().optional(),
        migration_paths: z.array(z.string()),
      })).default([]),
      auth: z.array(z.object({
        provider: z.string(),
        config_paths: z.array(z.string()),
      })).default([]),
      infrastructure: z.array(z.object({
        type: z.string(),
        paths: z.array(z.string()),
      })).default([]),
    }).default({}),
    risk_rules: z.object({
      high: RiskRulesSchema,
      low: z.object({
        file_patterns: z.array(z.string()).default([]),
      }).default({}),
    }),
    auto_merge: z.object({
      enabled: z.boolean().default(false),
      require_ci_pass: z.boolean().default(true),
      ai_score_threshold: z.number().min(0).max(100).default(75),
      strategy: z.enum(['squash', 'merge', 'rebase']).default('squash'),
      labels: z.object({
        high_risk: z.string().default('harness:high-risk'),
        low_risk: z.string().default('harness:low-risk'),
        auto_merged: z.string().default('harness:auto-merged'),
      }).default({}),
    }).default({}),
    ai_review: z.object({
      focus_areas: z.array(z.string()).default([
        'security vulnerabilities',
        'logic errors',
        'performance regressions',
        'breaking API changes',
      ]),
      max_diff_tokens: z.number().default(8000),
    }).default({}),
  }),
})

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>
```

---

## 分類パイプライン（packages/classifier/src/pipeline.ts）

評価は以下の順序で行い、highが確定した時点で後続Stepをスキップする。

```
Step 1: file_pattern matching (glob)
  → match → HIGH確定、即リターン

Step 2: AST analysis (tree-sitter)
  → match → HIGH確定、即リターン

Step 3: dependency manifest diff
  → blocklist該当パッケージが追加 → HIGH確定、即リターン

Step 4: diff size check
  → max_files or max_lines超過 → HIGH確定、即リターン

Step 5: low-risk override
  → 全ファイルが low.file_patterns にマッチ → LOW確定

Step 1-4通過 → LOW → AI Reviewフェーズへ
```

**実装上の注意点**:
- tree-sitterのparserは言語ごとに遅延ロードし、対象ファイルの拡張子で切り替える
- `packages/classifier/src/__tests__/` にfixture diffファイルを置き、各Stepを独立してテストする
- ASTクエリは `config.yml` の `ast_rules[].query` をそのまま tree-sitter の `Language.query()` に渡す

---

## CLIコマンド仕様

### `harness init`

inquirerを使った対話型セットアップ。収集する情報:

```
1. DB種別（複数選択可）: PostgreSQL / MySQL / SQLite / MongoDB / Redis / その他
2. ORM: Prisma / Drizzle / TypeORM / Sequelize / なし
3. 認証基盤（複数選択可）: Auth0 / Supabase Auth / NextAuth / Clerk / Firebase Auth / なし
4. インフラ管理（複数選択可）: Terraform / Pulumi / CDK / Kubernetes/Helm / なし
5. 主要言語: TypeScript / JavaScript / Python / Go / Ruby
6. AI auto-mergeを有効にするか（デフォルト: No）
7. AIスコア閾値（auto-merge有効時のみ、デフォルト: 75）
8. diffサイズ上限（ファイル数・行数、デフォルト: 20 / 500）
```

入力完了後に行う処理:
- `templates/configs/` から最も近いスタック雛形を選択してマージ
- `.harness/config.yml` を生成（既存ファイルは上書き前に確認）
- `.github/workflows/harness-check.yml` を生成（`templates/workflows/harness-check.yml` からコピー）
- `.harness/` を `.gitignore` に追加しない（コミット対象）
- 完了メッセージと次のステップを表示

### `harness classify`

GHA内部から呼ばれる想定。引数でGitHub contextを受け取る。

```
Options:
  --config <path>        config.ymlのパス (default: .harness/config.yml)
  --base-sha <sha>       比較元コミット
  --head-sha <sha>       比較先コミット（現在のHEAD）
  --github-token <token> GitHub API token
  --output json          結果をJSON出力（GHA outputs用）
```

stdout出力形式（`--output json`）:
```json
{
  "riskLevel": "high",
  "matchedRules": [...],
  "summary": "prisma/schema.prisma が変更されています"
}
```

### `harness rules test <file>`

指定ファイルを全ルールで評価してデバッグ出力する。ルール追加時の動作確認用。

### `harness rules validate`

`.harness/config.yml` をzodスキーマで検証してエラーを表示する。

---

## GitHub Actions仕様

### `actions/classify/action.yml`

```yaml
name: Harness Classify
description: Classifies PR risk level using static analysis
inputs:
  config-path:
    description: Path to .harness/config.yml
    required: false
    default: .harness/config.yml
  github-token:
    description: GitHub token
    required: true
outputs:
  risk-level:
    description: 'high or low'
  match-summary:
    description: 'Human-readable summary of matched rules'
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npx @harness/cli@latest classify --output json ...
      shell: bash
```

classify actionが行うGitHub API操作:
- PR labelsの付与・削除（high-risk / low-risk）
- PRコメントへのマッチ理由の投稿（同一コメントを更新、重複投稿しない）
- GitHub Step Summaryへの結果出力
- CODEOWNERSを参照してhigh-risk時に該当レビュアーをリクエスト

### `actions/ai-review/action.yml`

```yaml
inputs:
  anthropic-api-key:
    required: true
  github-token:
    required: true
  score-threshold:
    required: false
    default: '75'
outputs:
  score:
    description: '0-100 numeric score'
  recommendation:
    description: 'approve or request_changes'
```

### `templates/workflows/harness-check.yml`

```yaml
name: Harness Check
on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: harness-${{ github.ref }}
  cancel-in-progress: true

jobs:
  classify:
    runs-on: ubuntu-latest
    outputs:
      risk-level: ${{ steps.classify.outputs.risk-level }}
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: your-org/harness/.github/actions/classify@main
        id: classify
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

  ai-review:
    needs: classify
    if: needs.classify.outputs.risk-level == 'low'
    runs-on: ubuntu-latest
    outputs:
      score: ${{ steps.review.outputs.score }}
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/harness/.github/actions/ai-review@main
        id: review
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

  auto-merge:
    needs: [classify, ai-review]
    if: |
      needs.classify.outputs.risk-level == 'low' &&
      fromJSON(needs.ai-review.outputs.score) >= 75
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: your-org/harness/.github/actions/auto-merge@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## AI Reviewプロンプト設計（packages/reviewer/src/prompt.ts）

### システムプロンプト

```
You are a code reviewer for an automated CI pipeline.
Your role is to evaluate whether the code changes in this PR are safe to auto-merge.

Evaluate the diff and respond ONLY with a JSON object (no markdown, no explanation):
{
  "score": <integer 0-100>,
  "summary": "<one sentence overall assessment>",
  "concerns": [
    {
      "file": "<filename>",
      "line": <line number or 0 if not applicable>,
      "severity": "low" | "medium" | "high",
      "message": "<specific actionable concern>"
    }
  ],
  "recommendation": "approve" | "request_changes"
}

Scoring guide:
- 90-100: Clean, well-tested, no concerns
- 75-89: Minor issues, safe to auto-merge
- 50-74: Notable concerns, human review recommended
- 0-49: Significant issues, do not auto-merge

Focus areas (from config):
{focus_areas}

Note: This diff has already passed static analysis (no schema changes, no auth changes, no secrets).
```

### diffのトークン分割戦略（packages/reviewer/src/splitter.ts）

`max_diff_tokens` を超えるdiffは以下のルールで分割:
1. ファイル単位で分割（ファイルをまたがないようにする）
2. 1ファイルが上限を超える場合は先頭からチャンク分割し、各チャンクを独立してスコアリング
3. 複数チャンクのスコアは加重平均（変更行数で重み付け）

---

## スタック別config雛形（templates/configs/）

### base.yml（最小構成）

```yaml
harness:
  version: "1"
  stack: {}
  risk_rules:
    high:
      file_patterns:
        - ".env*"
        - "**/secrets/**"
        - "**/*.pem"
        - "**/*.key"
      ast_rules: []
      dependency_rules:
        added_packages: []
      diff_size:
        max_files: 20
        max_lines: 500
    low:
      file_patterns:
        - "**/*.test.ts"
        - "**/*.spec.ts"
        - "**/*.test.js"
        - "**/*.spec.js"
        - "**/*.md"
        - "**/*.mdx"
  auto_merge:
    enabled: false
    require_ci_pass: true
    ai_score_threshold: 75
    strategy: squash
  ai_review:
    focus_areas:
      - "security vulnerabilities"
      - "logic errors"
      - "performance regressions"
      - "breaking API changes"
    max_diff_tokens: 8000
```

### prisma-auth0.yml（Prisma + Auth0スタック）

base.ymlをマージした上で以下を追加:

```yaml
stack:
  databases:
    - type: postgresql
      orm: prisma
      migration_paths:
        - "prisma/migrations/**"
        - "prisma/schema.prisma"
  auth:
    - provider: auth0
      config_paths:
        - "src/auth/**"
        - "middleware/auth*"
        - "pages/api/auth/**"

risk_rules:
  high:
    file_patterns:
      # base.ymlのパターンに追加
      - "prisma/migrations/**"
      - "prisma/schema.prisma"
      - "src/auth/**"
      - "middleware/auth*"
      - "pages/api/auth/**"
    ast_rules:
      - id: raw_sql_ddl
        description: "Raw SQL DDL statements in template literals"
        query: |
          (tagged_template_expression
            tag: (identifier) @tag
            (#match? @tag "^(sql|db|query|prisma)$")
            string: (template_string) @content
            (#match? @content "(DROP|ALTER|CREATE|TRUNCATE)\\s+TABLE"))
      - id: prisma_migrate_reset
        description: "prisma migrate reset invocation"
        query: |
          (call_expression
            function: (member_expression
              property: (property_identifier) @method
              (#match? @method "^(reset|drop)$")))
    dependency_rules:
      added_packages:
        - "prisma"
        - "@prisma/client"
        - "auth0"
        - "@auth0/*"
        - "jsonwebtoken"
        - "passport*"
```

---

## テスト戦略

### classifier のテスト

`packages/classifier/src/__tests__/` にfixtureを配置する:

```
__tests__/
├── fixtures/
│   ├── diffs/
│   │   ├── schema-change.diff      # Prismaスキーマ変更（high-riskケース）
│   │   ├── auth-change.diff        # 認証ミドルウェア変更（high-riskケース）
│   │   ├── test-only.diff          # テストファイルのみ（low-riskケース）
│   │   ├── readme-update.diff      # ドキュメントのみ（low-riskケース）
│   │   └── large-change.diff       # diff size超過（high-riskケース）
│   └── configs/
│       └── test-config.yml
├── file-pattern.test.ts
├── ast.test.ts
├── dependency.test.ts
├── diff-size.test.ts
└── pipeline.test.ts                # エンドツーエンド
```

### reviewerのテスト

Anthropic SDKはモック化してunit testを書く。`ANTHROPIC_API_KEY` を使った実際のAPI呼び出しはE2Eテストとして分離し、CIでは実行しない。

---

## CI（.github/workflows/ci.yml — harness自身のCI）

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r lint
      - run: pnpm -r test
      - run: pnpm -r test:types
```

---

## 重要な実装上の制約・注意事項

1. **pure functions first**: `@harness/classifier` は副作用ゼロで実装する。GitHub APIの呼び出しはCLIレイヤーに閉じ込める

2. **ファイルパターンはGHAのglob仕様に合わせる**: `minimatch` ではなく `@actions/glob` と同じ解釈になるようにする

3. **tree-sitterのqueryエラーハンドリング**: ユーザーが書いたカスタムクエリが不正な場合、クラッシュではなくエラーを記録してそのルールをスキップし、他のルールは継続評価する

4. **GitHub APIのレート制限対応**: `@octokit/rest` のretryプラグインを使い、403/429は自動リトライ

5. **PRコメントの重複防止**: classifyとAI reviewのコメントは `harness[classify]` / `harness[ai-review]` というマーカーをHTMLコメントとして埋め込み、次回実行時に既存コメントを更新する（新規投稿しない）

6. **環境変数のフォールバック**: `ANTHROPIC_API_KEY` が未設定の場合は reviewer フェーズをスキップしてGHAをfailにする（パニックしない）

7. **`harness init` の冪等性**: 再実行しても安全。既存 `.harness/config.yml` がある場合はマージするか上書きするかをユーザーに確認する

---

## 最初に確認すること

実装を始める前に以下を確認してください:

- `node --version` が 20.0.0 以上であること
- `pnpm --version` が 9.0.0 以上であること
- tree-sitterのnative moduleがビルドできる環境（`node-gyp` の依存）であること

ルートの `package.json` から始めてモノレポを初期化し、Phase 1（`packages/shared`）から順番に実装してください。

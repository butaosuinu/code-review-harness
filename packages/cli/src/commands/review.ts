import { readFile } from 'node:fs'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import jsYaml from 'js-yaml'
import {
  HarnessConfigSchema,
  type HarnessConfig,
  type ReviewResult,
} from '@butaosuinu/harness-shared'
import {
  MissingApiKeyError,
  review as defaultReview,
  type ReviewInput,
} from '@butaosuinu/harness-reviewer'
import { ZodError } from 'zod'
import {
  AI_REVIEW_COMMENT_MARKER,
  defaultOctokitFactory,
  getGitHubDiff,
  type OctokitFactory,
  type OctokitLike,
  type PullRequestContext,
  resolvePullRequestContext,
  upsertAiReviewComment,
} from '../github.js'
import { writeReviewStepSummary } from '../step-summary.js'

const readFileAsync = promisify(readFile)

const DEFAULT_SCORE_THRESHOLD = 75
const MAX_COMMENT_CONCERNS = 10

interface ReviewOptions {
  config: string
  githubToken: string
  anthropicApiKey?: string
  scoreThreshold: string
  model?: string
  output?: string
  cwd: string
  postComment: boolean
}

export type ReviewFn = (input: ReviewInput) => Promise<ReviewResult>

export interface ReviewCommandDeps {
  octokitFactory?: OctokitFactory
  reviewFn?: ReviewFn
  env?: NodeJS.ProcessEnv
}

function formatZodError(e: ZodError): string {
  return e.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
}

function parseThreshold(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`--score-threshold must be a number, got: ${raw}`)
  }
  return n
}

function renderCommentBody(result: ReviewResult, threshold: number): string {
  const verdict = result.score >= threshold ? 'PASS' : 'BELOW THRESHOLD'
  const lines: string[] = []
  lines.push(AI_REVIEW_COMMENT_MARKER)
  lines.push(
    `## Harness AI review: score \`${result.score}\` / threshold \`${threshold}\` — ${verdict}`,
  )
  lines.push('')
  lines.push(`**Recommendation:** \`${result.recommendation}\``)
  lines.push('')
  lines.push(result.summary)
  if (result.concerns.length > 0) {
    lines.push('')
    lines.push('### Concerns')
    const shown = result.concerns.slice(0, MAX_COMMENT_CONCERNS)
    for (const c of shown) {
      const loc = c.line > 0 ? `${c.file}:${c.line}` : c.file
      lines.push(`- **[${c.severity}]** \`${loc}\` — ${c.message}`)
    }
    if (result.concerns.length > MAX_COMMENT_CONCERNS) {
      lines.push(`- _(+${result.concerns.length - MAX_COMMENT_CONCERNS} more)_`)
    }
  }
  return lines.join('\n')
}

export function registerReviewCommand(
  program: Command,
  deps: ReviewCommandDeps = {},
): void {
  const octokitFactory = deps.octokitFactory ?? defaultOctokitFactory
  const reviewFn = deps.reviewFn ?? defaultReview
  const env = deps.env ?? process.env

  program
    .command('review')
    .description('low-risk PR に対して AI レビューを実行する')
    .option('--config <path>', 'config.yml のパス', '.harness/config.yml')
    .requiredOption('--github-token <token>', 'GitHub API トークン')
    .option(
      '--anthropic-api-key <key>',
      'Anthropic API key (未指定時は env.ANTHROPIC_API_KEY を参照)',
    )
    .option(
      '--score-threshold <number>',
      'auto-merge の閾値 (表示のみ、recommendation は上書きしない)',
      String(DEFAULT_SCORE_THRESHOLD),
    )
    .option('--model <model>', 'reviewer の model override')
    .option('--output <format>', '出力フォーマット: human | json', 'human')
    .option('--cwd <path>', '作業ディレクトリ', process.cwd())
    .option('--no-post-comment', 'PR コメント投稿をスキップする')
    .action(async (opts: ReviewOptions) => {
      const cwd = resolve(opts.cwd)
      const configPath = resolve(cwd, opts.config)

      let threshold: number
      try {
        threshold = parseThreshold(opts.scoreThreshold)
      } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
      }

      const apiKey = opts.anthropicApiKey ?? env.ANTHROPIC_API_KEY ?? ''
      if (!apiKey || apiKey.trim() === '') {
        console.error('ANTHROPIC_API_KEY is not set')
        process.exit(1)
      }

      let rawConfig: string
      try {
        rawConfig = await readFileAsync(configPath, 'utf8')
      } catch {
        console.error(`config.yml が見つかりません: ${configPath}`)
        process.exit(1)
      }

      let config: HarnessConfig
      try {
        config = HarnessConfigSchema.parse(jsYaml.load(rawConfig))
      } catch (e) {
        if (e instanceof ZodError) {
          console.error('config.yml のバリデーションに失敗:')
          console.error(formatZodError(e))
        } else {
          console.error(`config.yml のパースに失敗: ${(e as Error).message}`)
        }
        process.exit(1)
      }

      let octokit: OctokitLike
      let ctx: PullRequestContext
      try {
        ctx = resolvePullRequestContext(env)
        octokit = await octokitFactory(opts.githubToken)
      } catch (e) {
        console.error(`PR コンテキストの解決に失敗: ${(e as Error).message}`)
        process.exit(2)
      }

      let files
      try {
        files = await getGitHubDiff(octokit, ctx)
      } catch (e) {
        console.error(`diff の取得に失敗: ${(e as Error).message}`)
        process.exit(2)
      }

      let result: ReviewResult
      try {
        const input: ReviewInput = {
          diff: files,
          config,
          apiKey,
          ...(opts.model !== undefined ? { model: opts.model } : {}),
        }
        result = await reviewFn(input)
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          console.error('ANTHROPIC_API_KEY is not set')
          process.exit(1)
        }
        throw e
      }

      if (opts.output === 'json') {
        process.stdout.write(JSON.stringify(result))
        process.stdout.write('\n')
      } else {
        console.log(`Score: ${result.score} / threshold ${threshold}`)
        console.log(`Recommendation: ${result.recommendation}`)
        console.log(`Summary: ${result.summary}`)
        if (result.concerns.length > 0) {
          console.log('')
          console.log('Concerns:')
          for (const c of result.concerns.slice(0, MAX_COMMENT_CONCERNS)) {
            const loc = c.line > 0 ? `${c.file}:${c.line}` : c.file
            console.log(`  [${c.severity}] ${loc} — ${c.message}`)
          }
        }
      }

      try {
        writeReviewStepSummary(result, threshold, env)
      } catch (e) {
        console.error(`step summary の書き込みに失敗: ${(e as Error).message}`)
      }

      if (opts.postComment) {
        try {
          await upsertAiReviewComment(
            octokit,
            ctx,
            renderCommentBody(result, threshold),
          )
        } catch (e) {
          console.error(`コメント投稿に失敗: ${(e as Error).message}`)
        }
      }
    })
}

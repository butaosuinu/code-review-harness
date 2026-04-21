import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { Command } from 'commander'
import jsYaml from 'js-yaml'
import {
  HarnessConfigSchema,
  type ClassifyResult,
  type DiffFile,
  type HarnessConfig,
} from '@butaosuinu/harness-shared'
import { classify, parseUnifiedDiff } from '@butaosuinu/harness-classifier'
import { ZodError } from 'zod'
import {
  applyLabels,
  CLASSIFY_COMMENT_MARKER,
  defaultOctokitFactory,
  getGitHubDiff,
  type OctokitFactory,
  type OctokitLike,
  type PullRequestContext,
  requestCodeownerReviewers,
  resolvePullRequestContext,
  upsertMatchedReasonComment,
} from '../github.js'
import { collectReviewersForFiles, loadCodeowners } from '../codeowners.js'
import { writeStepSummary } from '../step-summary.js'

const readFileAsync = promisify(readFile)

interface ClassifyOptions {
  config: string
  baseSha?: string
  headSha?: string
  githubToken?: string
  output?: string
  cwd: string
  labels: boolean
  postComment: boolean
}

function getLocalDiff(baseSha: string, headSha: string, cwd: string): DiffFile[] {
  const diff = execFileSync('git', ['diff', `${baseSha}..${headSha}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return parseUnifiedDiff(diff)
}

function formatZodError(e: ZodError): string {
  return e.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
}

function renderCommentBody(result: ClassifyResult): string {
  const lines: string[] = []
  lines.push(CLASSIFY_COMMENT_MARKER)
  lines.push(`## Harness classify: \`${result.riskLevel.toUpperCase()}\``)
  lines.push('')
  lines.push(result.summary)
  lines.push('')
  if (result.matchedRules.length > 0) {
    lines.push('### Matched rules')
    for (const rule of result.matchedRules) {
      lines.push(`- **[${rule.ruleType}] ${rule.ruleId}** — ${rule.description}`)
      for (const m of rule.matches.slice(0, 5)) {
        const lineInfo = m.line !== undefined ? `:${m.line}` : ''
        lines.push(`  - \`${m.file}${lineInfo}\``)
      }
      if (rule.matches.length > 5) {
        lines.push(`  - _(+${rule.matches.length - 5} more)_`)
      }
    }
  }
  return lines.join('\n')
}

export interface ClassifyCommandDeps {
  octokitFactory?: OctokitFactory
  env?: NodeJS.ProcessEnv
}

async function runGithubSideEffects(
  octokit: OctokitLike,
  ctx: PullRequestContext,
  opts: ClassifyOptions,
  config: HarnessConfig,
  result: ClassifyResult,
  files: DiffFile[],
  cwd: string,
): Promise<void> {
  if (opts.labels) {
    try {
      await applyLabels(octokit, ctx, {
        highRiskLabel: config.harness.auto_merge.labels.high_risk,
        lowRiskLabel: config.harness.auto_merge.labels.low_risk,
      }, result.riskLevel)
    } catch (e) {
      console.error(`label の更新に失敗: ${(e as Error).message}`)
    }
  }

  if (opts.postComment) {
    try {
      await upsertMatchedReasonComment(octokit, ctx, renderCommentBody(result))
    } catch (e) {
      console.error(`コメント投稿に失敗: ${(e as Error).message}`)
    }
  }

  if (result.riskLevel === 'high') {
    try {
      const rules = loadCodeowners(cwd)
      if (rules.length > 0) {
        const reviewers = collectReviewersForFiles(
          rules,
          files.map((f) => f.filename),
        )
        await requestCodeownerReviewers(octokit, ctx, reviewers)
      }
    } catch (e) {
      console.error(`reviewer リクエストに失敗: ${(e as Error).message}`)
    }
  }
}

export function registerClassifyCommand(
  program: Command,
  deps: ClassifyCommandDeps = {},
): void {
  const octokitFactory = deps.octokitFactory ?? defaultOctokitFactory
  const env = deps.env ?? process.env

  program
    .command('classify')
    .description('diff を分類して結果を出力する')
    .option('--config <path>', 'config.yml のパス', '.harness/config.yml')
    .option('--base-sha <sha>', '比較元コミット')
    .option('--head-sha <sha>', '比較先コミット (既定: HEAD)', 'HEAD')
    .option('--github-token <token>', 'GitHub API トークン (PR モード)')
    .option('--output <format>', '出力フォーマット: human | json', 'human')
    .option('--cwd <path>', '作業ディレクトリ', process.cwd())
    .option('--no-labels', 'PR の risk ラベル付与をスキップする')
    .option('--no-post-comment', 'PR コメント投稿をスキップする')
    .action(async (opts: ClassifyOptions) => {
      const cwd = resolve(opts.cwd)
      const configPath = resolve(cwd, opts.config)

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

      let files: DiffFile[]
      let octokit: OctokitLike | null = null
      let ctx: PullRequestContext | null = null

      try {
        if (opts.githubToken) {
          ctx = resolvePullRequestContext(env)
          octokit = await octokitFactory(opts.githubToken)
          files = await getGitHubDiff(octokit, ctx)
        } else {
          if (!opts.baseSha) {
            console.error('--base-sha は --github-token 未指定時に必須です')
            process.exit(1)
          }
          files = getLocalDiff(opts.baseSha, opts.headSha ?? 'HEAD', cwd)
        }
      } catch (e) {
        console.error(`diff の取得に失敗: ${(e as Error).message}`)
        process.exit(2)
      }

      const result = await classify({
        files,
        config,
        readFile: (p) => readFileAsync(join(cwd, p), 'utf8'),
      })

      if (opts.output === 'json') {
        process.stdout.write(JSON.stringify(result))
        process.stdout.write('\n')
      } else {
        console.log(`Risk level: ${result.riskLevel.toUpperCase()}`)
        console.log(`Summary: ${result.summary}`)
        if (result.matchedRules.length > 0) {
          console.log('')
          console.log('Matched rules:')
          for (const rule of result.matchedRules) {
            console.log(`  [${rule.ruleType}] ${rule.ruleId}: ${rule.description}`)
            for (const m of rule.matches.slice(0, 5)) {
              const lineInfo = m.line !== undefined ? `:${m.line}` : ''
              console.log(`    - ${m.file}${lineInfo}`)
            }
            if (rule.matches.length > 5) {
              console.log(`    ... (+${rule.matches.length - 5} more)`)
            }
          }
        }
      }

      try {
        writeStepSummary(result, env)
      } catch (e) {
        console.error(`step summary の書き込みに失敗: ${(e as Error).message}`)
      }

      if (octokit && ctx) {
        await runGithubSideEffects(octokit, ctx, opts, config, result, files, cwd)
      }
    })
}

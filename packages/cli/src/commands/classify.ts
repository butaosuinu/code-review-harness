import { execFileSync } from 'node:child_process'
import { readFile, readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { Command } from 'commander'
import jsYaml from 'js-yaml'
import {
  HarnessConfigSchema,
  type DiffFile,
} from '@butaosuinu/harness-shared'
import { classify, parseUnifiedDiff } from '@butaosuinu/harness-classifier'
import { ZodError } from 'zod'

const readFileAsync = promisify(readFile)

interface ClassifyOptions {
  config: string
  baseSha?: string
  headSha?: string
  githubToken?: string
  output?: string
  cwd: string
}

function getLocalDiff(baseSha: string, headSha: string, cwd: string): DiffFile[] {
  const diff = execFileSync('git', ['diff', `${baseSha}..${headSha}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return parseUnifiedDiff(diff)
}

async function getGitHubDiff(token: string): Promise<DiffFile[]> {
  const repo = process.env.GITHUB_REPOSITORY
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set')
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set')

  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error(`invalid GITHUB_REPOSITORY: ${repo}`)

  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: { number: number }
  }
  const prNumber = event.pull_request?.number
  if (!prNumber) throw new Error('event payload has no pull_request.number')

  const { Octokit } = await import('@octokit/rest')
  const octokit = new Octokit({ auth: token })
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo: name,
    pull_number: prNumber,
    per_page: 100,
  })

  return files.map((f) => {
    const entry: DiffFile = {
      filename: f.filename,
      status: f.status === 'renamed' ? 'renamed' : (f.status as DiffFile['status']),
      additions: f.additions,
      deletions: f.deletions,
    }
    if (f.patch !== undefined) entry.patch = f.patch
    if (f.previous_filename !== undefined) entry.previousFilename = f.previous_filename
    return entry
  })
}

function formatZodError(e: ZodError): string {
  return e.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
}

export function registerClassifyCommand(program: Command): void {
  program
    .command('classify')
    .description('diff を分類して結果を出力する')
    .option('--config <path>', 'config.yml のパス', '.harness/config.yml')
    .option('--base-sha <sha>', '比較元コミット')
    .option('--head-sha <sha>', '比較先コミット (既定: HEAD)', 'HEAD')
    .option('--github-token <token>', 'GitHub API トークン (PR モード)')
    .option('--output <format>', '出力フォーマット: human | json', 'human')
    .option('--cwd <path>', '作業ディレクトリ', process.cwd())
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

      let config
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
      try {
        if (opts.githubToken) {
          files = await getGitHubDiff(opts.githubToken)
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
    })
}

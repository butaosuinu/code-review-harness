import { readFileSync } from 'node:fs'
import { autoMerge } from './auto-merge.js'

interface WorkflowEventPayload {
  pull_request?: { number: number }
  number?: number
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`)
  }
  return value
}

function parseStrategy(raw: string | undefined): 'squash' | 'merge' | 'rebase' {
  const value = (raw ?? 'squash').trim().toLowerCase()
  if (value === 'squash' || value === 'merge' || value === 'rebase') return value
  throw new Error(`invalid strategy: ${raw} (expected squash|merge|rebase)`)
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no' || v === '') return false
  throw new Error(`invalid boolean: ${raw}`)
}

function resolvePullNumber(): number {
  const explicit = process.env.INPUT_PULL_NUMBER
  if (explicit) {
    const n = Number.parseInt(explicit, 10)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid INPUT_PULL_NUMBER: ${explicit}`)
    return n
  }
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set')
  const payload = JSON.parse(readFileSync(eventPath, 'utf8')) as WorkflowEventPayload
  const num = payload.pull_request?.number ?? payload.number
  if (typeof num !== 'number') throw new Error('event payload has no pull_request.number')
  return num
}

async function main(): Promise<void> {
  const token = required('INPUT_GITHUB_TOKEN')
  const strategy = parseStrategy(process.env.INPUT_STRATEGY)
  const requireCiPass = parseBool(process.env.INPUT_REQUIRE_CI_PASS, true)
  const autoMergedLabel = process.env.INPUT_AUTO_MERGED_LABEL?.trim() || 'harness:auto-merged'

  const repoSlug = required('GITHUB_REPOSITORY')
  const [owner, repo] = repoSlug.split('/')
  if (!owner || !repo) throw new Error(`invalid GITHUB_REPOSITORY: ${repoSlug}`)

  const pullNumber = resolvePullNumber()

  const { Octokit } = await import('@octokit/rest')
  const octokit = new Octokit({ auth: token })

  const result = await autoMerge({
    octokit,
    owner,
    repo,
    pullNumber,
    strategy,
    requireCiPass,
    autoMergedLabel,
  })

  if (result.status === 'merged') {
    console.log(`auto-merge: merged ${owner}/${repo}#${pullNumber} (sha=${result.sha})`)
    return
  }
  console.error(`auto-merge: blocked — ${result.reason}`)
  process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})

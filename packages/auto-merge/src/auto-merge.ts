export interface OctokitLike {
  rest: {
    pulls: {
      get(params: {
        owner: string
        repo: string
        pull_number: number
      }): Promise<{ data: PullRequestData }>
      merge(params: {
        owner: string
        repo: string
        pull_number: number
        merge_method: 'squash' | 'merge' | 'rebase'
      }): Promise<{ data: { sha: string; merged: boolean } }>
    }
    repos: {
      getCombinedStatusForRef(params: {
        owner: string
        repo: string
        ref: string
      }): Promise<{ data: CombinedStatus }>
    }
    checks: {
      listForRef(params: {
        owner: string
        repo: string
        ref: string
      }): Promise<{ data: CheckRunsResponse }>
    }
    issues: {
      addLabels(params: {
        owner: string
        repo: string
        issue_number: number
        labels: string[]
      }): Promise<unknown>
      createComment(params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }): Promise<unknown>
    }
  }
}

interface PullRequestData {
  head: { sha: string }
  mergeable: boolean | null
  mergeable_state: string
  state: string
  draft?: boolean
}

interface CombinedStatus {
  state: 'success' | 'pending' | 'failure' | string
  statuses: Array<{ context: string; state: string }>
}

interface CheckRunsResponse {
  check_runs: Array<{
    name: string
    status: string
    conclusion: string | null
  }>
}

export interface AutoMergeInput {
  octokit: OctokitLike
  owner: string
  repo: string
  pullNumber: number
  strategy: 'squash' | 'merge' | 'rebase'
  requireCiPass: boolean
  autoMergedLabel: string
}

export type AutoMergeResult =
  | { status: 'merged'; sha: string }
  | { status: 'blocked'; reason: string }

const COMMENT_MARKER = '<!-- harness[auto-merge] -->'

export async function autoMerge(input: AutoMergeInput): Promise<AutoMergeResult> {
  const { octokit, owner, repo, pullNumber, strategy, requireCiPass, autoMergedLabel } = input

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  })

  if (pr.state !== 'open') {
    return blocked(octokit, owner, repo, pullNumber, `PR is not open (state=${pr.state}).`)
  }
  if (pr.draft === true) {
    return blocked(octokit, owner, repo, pullNumber, 'PR is in draft state.')
  }
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    return blocked(
      octokit,
      owner,
      repo,
      pullNumber,
      `PR has merge conflicts (mergeable_state=${pr.mergeable_state}).`,
    )
  }

  if (requireCiPass) {
    const ciFailure = await checkCiStatus(octokit, owner, repo, pr.head.sha)
    if (ciFailure) {
      return blocked(octokit, owner, repo, pullNumber, ciFailure)
    }
  }

  let mergeSha: string
  try {
    const { data } = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: strategy,
    })
    if (!data.merged) {
      return blocked(octokit, owner, repo, pullNumber, 'GitHub reported merge=false without error.')
    }
    mergeSha = data.sha
  } catch (err) {
    const msg = formatMergeError(err)
    return blocked(octokit, owner, repo, pullNumber, `Merge API rejected: ${msg}`)
  }

  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: pullNumber,
    labels: [autoMergedLabel],
  })

  return { status: 'merged', sha: mergeSha }
}

async function checkCiStatus(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  const [{ data: combined }, { data: checks }] = await Promise.all([
    octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
    octokit.rest.checks.listForRef({ owner, repo, ref: sha }),
  ])

  if (combined.state === 'failure') {
    const failing = combined.statuses
      .filter((s) => s.state === 'failure' || s.state === 'error')
      .map((s) => s.context)
    return `Combined CI status is failing (${failing.join(', ') || 'unknown contexts'}).`
  }
  if (combined.state === 'pending' && combined.statuses.length > 0) {
    return 'Combined CI status is still pending.'
  }

  const unfinished = checks.check_runs.filter((c) => c.status !== 'completed')
  if (unfinished.length > 0) {
    return `Check runs still in progress: ${unfinished.map((c) => c.name).join(', ')}.`
  }
  const failed = checks.check_runs.filter(
    (c) =>
      c.conclusion !== null &&
      c.conclusion !== 'success' &&
      c.conclusion !== 'skipped' &&
      c.conclusion !== 'neutral',
  )
  if (failed.length > 0) {
    return `Check runs failed: ${failed.map((c) => `${c.name} (${c.conclusion})`).join(', ')}.`
  }

  return null
}

async function blocked(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  pullNumber: number,
  reason: string,
): Promise<AutoMergeResult> {
  const body = `${COMMENT_MARKER}\n:robot: **harness auto-merge blocked.**\n\n${reason}`
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  })
  return { status: 'blocked', reason }
}

function formatMergeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; message?: string }
    const status = e.status !== undefined ? `${e.status} ` : ''
    const message = e.message ?? String(err)
    return `${status}${message}`.trim()
  }
  return String(err)
}

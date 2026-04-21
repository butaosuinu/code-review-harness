import { readFileSync as nodeReadFileSync } from 'node:fs'
import type { RiskLevel } from '@butaosuinu/harness-shared'

export const CLASSIFY_COMMENT_MARKER = '<!-- harness[classify] -->'

export interface PullRequestContext {
  owner: string
  repo: string
  prNumber: number
}

export interface OctokitLike {
  paginate: (fn: unknown, opts: unknown) => Promise<unknown[]>
  rest: {
    pulls: {
      listFiles: unknown
      requestReviewers: (opts: {
        owner: string
        repo: string
        pull_number: number
        reviewers?: string[]
        team_reviewers?: string[]
      }) => Promise<unknown>
    }
    issues: {
      addLabels: (opts: {
        owner: string
        repo: string
        issue_number: number
        labels: string[]
      }) => Promise<unknown>
      removeLabel: (opts: {
        owner: string
        repo: string
        issue_number: number
        name: string
      }) => Promise<unknown>
      listComments: unknown
      createComment: (opts: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<unknown>
      updateComment: (opts: {
        owner: string
        repo: string
        comment_id: number
        body: string
      }) => Promise<unknown>
    }
  }
}

export type OctokitFactory = (token: string) => Promise<OctokitLike>

export const defaultOctokitFactory: OctokitFactory = async (token) => {
  const { Octokit } = await import('@octokit/rest')
  return new Octokit({ auth: token }) as unknown as OctokitLike
}

export function resolvePullRequestContext(
  env: NodeJS.ProcessEnv = process.env,
  readFileSync: (path: string, encoding: 'utf8') => string = nodeReadFileSync,
): PullRequestContext {
  const repoSlug = env.GITHUB_REPOSITORY
  const eventPath = env.GITHUB_EVENT_PATH
  if (!repoSlug) throw new Error('GITHUB_REPOSITORY is not set')
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set')

  const [owner, repo] = repoSlug.split('/')
  if (!owner || !repo) throw new Error(`invalid GITHUB_REPOSITORY: ${repoSlug}`)

  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: { number: number }
  }
  const prNumber = event.pull_request?.number
  if (!prNumber) throw new Error('event payload has no pull_request.number')

  return { owner, repo, prNumber }
}

export async function applyLabels(
  octokit: OctokitLike,
  ctx: PullRequestContext,
  cfg: { highRiskLabel: string; lowRiskLabel: string },
  riskLevel: RiskLevel,
): Promise<void> {
  const toAdd = riskLevel === 'high' ? cfg.highRiskLabel : cfg.lowRiskLabel
  const toRemove = riskLevel === 'high' ? cfg.lowRiskLabel : cfg.highRiskLabel

  await octokit.rest.issues.addLabels({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.prNumber,
    labels: [toAdd],
  })

  try {
    await octokit.rest.issues.removeLabel({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.prNumber,
      name: toRemove,
    })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status !== 404) throw e
  }
}

interface IssueComment {
  id: number
  body?: string
}

export async function upsertMatchedReasonComment(
  octokit: OctokitLike,
  ctx: PullRequestContext,
  body: string,
): Promise<void> {
  const comments = (await octokit.paginate(octokit.rest.issues.listComments, {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.prNumber,
    per_page: 100,
  })) as IssueComment[]

  const existing = comments.find((c) =>
    (c.body ?? '').includes(CLASSIFY_COMMENT_MARKER),
  )

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existing.id,
      body,
    })
  } else {
    await octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.prNumber,
      body,
    })
  }
}

export async function requestCodeownerReviewers(
  octokit: OctokitLike,
  ctx: PullRequestContext,
  reviewers: { users: string[]; teams: string[] },
): Promise<void> {
  const users = dedupe(reviewers.users)
  const teams = dedupe(reviewers.teams)
  if (users.length === 0 && teams.length === 0) return

  const payload: {
    owner: string
    repo: string
    pull_number: number
    reviewers?: string[]
    team_reviewers?: string[]
  } = {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
  }
  if (users.length > 0) payload.reviewers = users
  if (teams.length > 0) payload.team_reviewers = teams

  await octokit.rest.pulls.requestReviewers(payload)
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

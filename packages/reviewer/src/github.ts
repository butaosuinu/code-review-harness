import type { DiffFile, ReviewConcern, ReviewResult } from '@butaosuinu/harness-shared'

export const AI_REVIEW_COMMENT_MARKER = '<!-- harness[ai-review] -->'

export interface PullRequestContext {
  owner: string
  repo: string
  prNumber: number
  headSha: string
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export interface InlineComment {
  path: string
  position: number
  body: string
}

export interface OctokitLike {
  paginate: (fn: unknown, opts: unknown) => Promise<unknown[]>
  rest: {
    pulls: {
      listReviews: unknown
      createReview: (opts: {
        owner: string
        repo: string
        pull_number: number
        commit_id?: string
        body: string
        event: ReviewEvent
        comments?: InlineComment[]
      }) => Promise<unknown>
      updateReview: (opts: {
        owner: string
        repo: string
        pull_number: number
        review_id: number
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

export interface PostReviewInput {
  octokit: OctokitLike
  ctx: PullRequestContext
  diff: readonly DiffFile[]
  result: ReviewResult
}

export interface MappedComments {
  comments: InlineComment[]
  unresolved: ReviewConcern[]
}

export function computePosition(
  patch: string | undefined,
  targetLine: number,
): number | null {
  if (!patch) return null

  const lines = patch.split('\n')
  let position = 0
  let newLine = 0
  let seenFirstHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      if (match) newLine = Number.parseInt(match[1]!, 10) - 1
      if (seenFirstHunk) position += 1
      seenFirstHunk = true
      continue
    }
    if (!seenFirstHunk) continue

    position += 1
    if (line.startsWith('-')) continue
    newLine += 1
    if (newLine === targetLine) return position
  }

  return null
}

export function toReviewComments(
  diff: readonly DiffFile[],
  concerns: readonly ReviewConcern[],
): MappedComments {
  const byFilename = new Map<string, DiffFile>()
  for (const file of diff) byFilename.set(file.filename, file)

  const comments: InlineComment[] = []
  const unresolved: ReviewConcern[] = []

  for (const concern of concerns) {
    const file = byFilename.get(concern.file)
    if (!file || !file.patch) {
      unresolved.push(concern)
      continue
    }
    const position = computePosition(file.patch, concern.line)
    if (position === null) {
      unresolved.push(concern)
      continue
    }
    comments.push({
      path: concern.file,
      position,
      body: renderConcernBody(concern),
    })
  }

  return { comments, unresolved }
}

function renderConcernBody(concern: ReviewConcern): string {
  return `**[${concern.severity}]** ${concern.message}`
}

function renderReviewBody(
  result: ReviewResult,
  unresolved: readonly ReviewConcern[],
): string {
  const lines: string[] = [AI_REVIEW_COMMENT_MARKER, '', '## AI Review', '']
  lines.push(`**Score:** ${result.score}`)
  lines.push(`**Recommendation:** ${result.recommendation}`)
  lines.push('', result.summary)

  if (unresolved.length > 0) {
    lines.push('', '### Concerns without resolvable diff position', '')
    for (const concern of unresolved) {
      lines.push(
        `- \`${concern.file}:${concern.line}\` **[${concern.severity}]** ${concern.message}`,
      )
    }
  }

  return lines.join('\n')
}

function recommendationToEvent(
  recommendation: ReviewResult['recommendation'],
): ReviewEvent {
  return recommendation === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES'
}

interface ExistingReview {
  id: number
  body?: string | null
}

async function findExistingReview(
  octokit: OctokitLike,
  ctx: PullRequestContext,
): Promise<ExistingReview | null> {
  const reviews = (await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    per_page: 100,
  })) as ExistingReview[]

  for (const review of reviews) {
    if ((review.body ?? '').includes(AI_REVIEW_COMMENT_MARKER)) {
      return review
    }
  }
  return null
}

export async function postReview(input: PostReviewInput): Promise<void> {
  const { octokit, ctx, diff, result } = input
  const { comments, unresolved } = toReviewComments(diff, result.concerns)
  const body = renderReviewBody(result, unresolved)

  const existing = await findExistingReview(octokit, ctx)

  if (existing) {
    await octokit.rest.pulls.updateReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.prNumber,
      review_id: existing.id,
      body,
    })
    return
  }

  await octokit.rest.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    commit_id: ctx.headSha,
    body,
    event: recommendationToEvent(result.recommendation),
    comments: comments.length > 0 ? comments : undefined,
  })
}

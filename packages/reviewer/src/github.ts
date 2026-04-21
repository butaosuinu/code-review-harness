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

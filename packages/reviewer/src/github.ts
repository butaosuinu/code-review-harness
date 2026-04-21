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

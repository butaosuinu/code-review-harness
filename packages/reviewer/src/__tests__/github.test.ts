import { describe, expect, it, vi } from 'vitest'
import type { DiffFile, ReviewConcern, ReviewResult } from '@butaosuinu/harness-shared'

import {
  AI_REVIEW_COMMENT_MARKER,
  computePosition,
  postReview,
  toReviewComments,
  type OctokitLike,
  type PullRequestContext,
} from '../github.js'

describe('computePosition', () => {
  it('resolves an added line in a single hunk', () => {
    const patch = '@@ -1,2 +1,3 @@\n a\n+b\n c'
    expect(computePosition(patch, 2)).toBe(2)
  })

  it('resolves a context line after additions and deletions', () => {
    const patch = '@@ -1,3 +1,3 @@\n a\n-b\n+x\n c'
    expect(computePosition(patch, 1)).toBe(1)
    expect(computePosition(patch, 2)).toBe(3)
    expect(computePosition(patch, 3)).toBe(4)
  })

  it('returns null when the target line never appears on the new side', () => {
    const patch = '@@ -1,2 +1,1 @@\n a\n-b'
    expect(computePosition(patch, 2)).toBeNull()
  })

  it('returns null for a line outside the hunk range', () => {
    const patch = '@@ -1,2 +1,3 @@\n a\n+b\n c'
    expect(computePosition(patch, 99)).toBeNull()
  })

  it('returns null for empty or undefined patches', () => {
    expect(computePosition('', 1)).toBeNull()
    expect(computePosition(undefined, 1)).toBeNull()
  })

  it('handles multiple hunks and counts subsequent hunk headers', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' a',
      '+x',
      '-b',
      '@@ -10,2 +10,3 @@',
      ' d',
      '+y',
      ' e',
    ].join('\n')

    expect(computePosition(patch, 1)).toBe(1)
    expect(computePosition(patch, 2)).toBe(2)
    expect(computePosition(patch, 10)).toBe(5)
    expect(computePosition(patch, 11)).toBe(6)
    expect(computePosition(patch, 12)).toBe(7)
  })
})

describe('toReviewComments', () => {
  const diff: DiffFile[] = [
    {
      filename: 'src/a.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1,2 +1,3 @@\n a\n+b\n c',
    },
    {
      filename: 'src/b.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
    },
  ]

  const concern = (
    file: string,
    line: number,
    severity: ReviewConcern['severity'],
    message: string,
  ): ReviewConcern => ({ file, line, severity, message })

  it('maps resolvable concerns to inline comments with severity-tagged bodies', () => {
    const { comments, unresolved } = toReviewComments(diff, [
      concern('src/a.ts', 2, 'low', 'extract constant'),
    ])

    expect(unresolved).toEqual([])
    expect(comments).toEqual([
      { path: 'src/a.ts', position: 2, body: '**[low]** extract constant' },
    ])
  })

  it('marks concerns on files absent from the diff as unresolved', () => {
    const c = concern('src/missing.ts', 1, 'high', 'what?')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('marks concerns on files with no patch as unresolved', () => {
    const c = concern('src/b.ts', 1, 'medium', 'new file no patch')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('marks concerns whose line is outside any hunk as unresolved', () => {
    const c = concern('src/a.ts', 99, 'low', 'out of range')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('splits resolvable and unresolvable concerns correctly', () => {
    const resolvable = concern('src/a.ts', 2, 'low', 'm1')
    const unresolved1 = concern('src/b.ts', 1, 'medium', 'm2')
    const unresolved2 = concern('src/a.ts', 99, 'high', 'm3')

    const result = toReviewComments(diff, [resolvable, unresolved1, unresolved2])
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]!.path).toBe('src/a.ts')
    expect(result.unresolved).toEqual([unresolved1, unresolved2])
  })
})

describe('postReview', () => {
  const ctx: PullRequestContext = {
    owner: 'acme',
    repo: 'widgets',
    prNumber: 42,
    headSha: 'deadbeef',
  }

  const diff: DiffFile[] = [
    {
      filename: 'src/a.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1,2 +1,3 @@\n a\n+b\n c',
    },
    {
      filename: 'src/b.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
    },
  ]

  const result: ReviewResult = {
    score: 85,
    summary: 'Mostly fine, a few nits.',
    concerns: [
      { file: 'src/a.ts', line: 2, severity: 'low', message: 'rename this' },
      { file: 'src/b.ts', line: 1, severity: 'medium', message: 'no patch available' },
    ],
    recommendation: 'request_changes',
  }

  function makeOctokit(reviews: Array<{ id: number; body: string }>): {
    octokit: OctokitLike
    paginate: ReturnType<typeof vi.fn>
    createReview: ReturnType<typeof vi.fn>
    updateReview: ReturnType<typeof vi.fn>
  } {
    const paginate = vi.fn().mockResolvedValue(reviews)
    const createReview = vi.fn().mockResolvedValue({})
    const updateReview = vi.fn().mockResolvedValue({})
    const listReviews = { __tag: 'listReviews' } as unknown
    const octokit: OctokitLike = {
      paginate: paginate as unknown as OctokitLike['paginate'],
      rest: {
        pulls: {
          listReviews,
          createReview: createReview as unknown as OctokitLike['rest']['pulls']['createReview'],
          updateReview: updateReview as unknown as OctokitLike['rest']['pulls']['updateReview'],
        },
      },
    }
    return { octokit, paginate, createReview, updateReview }
  }

  it('creates a new review with inline comments when none exists', async () => {
    const { octokit, paginate, createReview, updateReview } = makeOctokit([])

    await postReview({ octokit, ctx, diff, result })

    expect(paginate).toHaveBeenCalledTimes(1)
    expect(paginate.mock.calls[0]![1]).toEqual({
      owner: 'acme',
      repo: 'widgets',
      pull_number: 42,
      per_page: 100,
    })

    expect(updateReview).not.toHaveBeenCalled()
    expect(createReview).toHaveBeenCalledTimes(1)

    const payload = createReview.mock.calls[0]![0]
    expect(payload.owner).toBe('acme')
    expect(payload.repo).toBe('widgets')
    expect(payload.pull_number).toBe(42)
    expect(payload.commit_id).toBe('deadbeef')
    expect(payload.event).toBe('REQUEST_CHANGES')
    expect(payload.body).toContain(AI_REVIEW_COMMENT_MARKER)
    expect(payload.body).toContain('Mostly fine, a few nits.')
    expect(payload.body).toContain('**Score:** 85')
    expect(payload.body).toContain('Concerns without resolvable diff position')
    expect(payload.body).toContain('`src/b.ts:1`')

    expect(payload.comments).toEqual([
      { path: 'src/a.ts', position: 2, body: '**[low]** rename this' },
    ])
  })

  it('maps approve recommendation to APPROVE event', async () => {
    const { octokit, createReview } = makeOctokit([])
    await postReview({
      octokit,
      ctx,
      diff,
      result: { ...result, recommendation: 'approve', concerns: [] },
    })
    expect(createReview).toHaveBeenCalledTimes(1)
    expect(createReview.mock.calls[0]![0].event).toBe('APPROVE')
    expect(createReview.mock.calls[0]![0].comments).toBeUndefined()
  })

  it('updates an existing review body when one carries the marker', async () => {
    const existing = {
      id: 99,
      body: `prior\n${AI_REVIEW_COMMENT_MARKER}\nolder content`,
    }
    const { octokit, createReview, updateReview } = makeOctokit([
      { id: 1, body: 'unrelated review' },
      existing,
    ])

    await postReview({ octokit, ctx, diff, result })

    expect(createReview).not.toHaveBeenCalled()
    expect(updateReview).toHaveBeenCalledTimes(1)
    const payload = updateReview.mock.calls[0]![0]
    expect(payload.owner).toBe('acme')
    expect(payload.repo).toBe('widgets')
    expect(payload.pull_number).toBe(42)
    expect(payload.review_id).toBe(99)
    expect(payload.body).toContain(AI_REVIEW_COMMENT_MARKER)
    expect(payload.body).toContain('Mostly fine, a few nits.')
  })

  it('omits comments field entirely when no concern is resolvable', async () => {
    const { octokit, createReview } = makeOctokit([])
    await postReview({
      octokit,
      ctx,
      diff,
      result: {
        ...result,
        concerns: [
          { file: 'src/missing.ts', line: 1, severity: 'high', message: 'ghost' },
        ],
      },
    })

    const payload = createReview.mock.calls[0]![0]
    expect(payload.comments).toBeUndefined()
    expect(payload.body).toContain('`src/missing.ts:1`')
  })
})

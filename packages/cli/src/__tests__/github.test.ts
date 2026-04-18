import { describe, expect, it, vi } from 'vitest'
import {
  applyLabels,
  CLASSIFY_COMMENT_MARKER,
  requestCodeownerReviewers,
  resolvePullRequestContext,
  upsertMatchedReasonComment,
  type OctokitLike,
  type PullRequestContext,
} from '../github.js'

function makeOctokit(): OctokitLike & {
  paginate: ReturnType<typeof vi.fn>
  rest: {
    pulls: {
      listFiles: unknown
      requestReviewers: ReturnType<typeof vi.fn>
    }
    issues: {
      addLabels: ReturnType<typeof vi.fn>
      removeLabel: ReturnType<typeof vi.fn>
      listComments: unknown
      createComment: ReturnType<typeof vi.fn>
      updateComment: ReturnType<typeof vi.fn>
    }
  }
} {
  return {
    paginate: vi.fn().mockResolvedValue([]),
    rest: {
      pulls: {
        listFiles: vi.fn(),
        requestReviewers: vi.fn().mockResolvedValue({}),
      },
      issues: {
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        listComments: vi.fn(),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  }
}

const ctx: PullRequestContext = { owner: 'foo', repo: 'bar', prNumber: 42 }

describe('resolvePullRequestContext', () => {
  it('extracts owner, repo, and prNumber from env + event file', () => {
    const env = {
      GITHUB_REPOSITORY: 'foo/bar',
      GITHUB_EVENT_PATH: '/tmp/event.json',
    } as NodeJS.ProcessEnv
    const readFileSync = vi.fn(
      () => JSON.stringify({ pull_request: { number: 42 } }),
    )
    const result = resolvePullRequestContext(env, readFileSync)
    expect(result).toEqual({ owner: 'foo', repo: 'bar', prNumber: 42 })
  })

  it('throws when GITHUB_REPOSITORY is missing', () => {
    expect(() =>
      resolvePullRequestContext({} as NodeJS.ProcessEnv, () => ''),
    ).toThrow(/GITHUB_REPOSITORY/)
  })

  it('throws when event payload has no pull_request.number', () => {
    const env = {
      GITHUB_REPOSITORY: 'a/b',
      GITHUB_EVENT_PATH: '/tmp/e.json',
    } as NodeJS.ProcessEnv
    expect(() =>
      resolvePullRequestContext(env, () => JSON.stringify({})),
    ).toThrow(/pull_request/)
  })
})

describe('applyLabels', () => {
  const cfg = { highRiskLabel: 'harness:high-risk', lowRiskLabel: 'harness:low-risk' }

  it('adds high label and removes low label on high risk', async () => {
    const octokit = makeOctokit()
    await applyLabels(octokit, ctx, cfg, 'high')
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'foo',
      repo: 'bar',
      issue_number: 42,
      labels: ['harness:high-risk'],
    })
    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: 'foo',
      repo: 'bar',
      issue_number: 42,
      name: 'harness:low-risk',
    })
  })

  it('adds low label and removes high label on low risk', async () => {
    const octokit = makeOctokit()
    await applyLabels(octokit, ctx, cfg, 'low')
    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['harness:low-risk'] }),
    )
    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'harness:high-risk' }),
    )
  })

  it('swallows 404 when removing a label that is not present', async () => {
    const octokit = makeOctokit()
    const notFound = Object.assign(new Error('Not Found'), { status: 404 })
    octokit.rest.issues.removeLabel.mockRejectedValueOnce(notFound)
    await expect(applyLabels(octokit, ctx, cfg, 'high')).resolves.toBeUndefined()
  })

  it('re-throws non-404 errors on removeLabel', async () => {
    const octokit = makeOctokit()
    const boom = Object.assign(new Error('Server error'), { status: 500 })
    octokit.rest.issues.removeLabel.mockRejectedValueOnce(boom)
    await expect(applyLabels(octokit, ctx, cfg, 'high')).rejects.toThrow(
      /Server error/,
    )
  })
})

describe('upsertMatchedReasonComment', () => {
  it('creates a new comment when none has the marker', async () => {
    const octokit = makeOctokit()
    octokit.paginate.mockResolvedValueOnce([
      { id: 1, body: 'unrelated comment' },
    ])
    await upsertMatchedReasonComment(octokit, ctx, 'hello')
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'foo',
      repo: 'bar',
      issue_number: 42,
      body: 'hello',
    })
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('updates the existing marker comment', async () => {
    const octokit = makeOctokit()
    octokit.paginate.mockResolvedValueOnce([
      { id: 100, body: 'something' },
      { id: 200, body: `${CLASSIFY_COMMENT_MARKER}\nprevious body` },
    ])
    await upsertMatchedReasonComment(octokit, ctx, 'updated body')
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'foo',
      repo: 'bar',
      comment_id: 200,
      body: 'updated body',
    })
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })
})

describe('requestCodeownerReviewers', () => {
  it('sends deduped users and teams', async () => {
    const octokit = makeOctokit()
    await requestCodeownerReviewers(octokit, ctx, {
      users: ['alice', 'bob', 'alice'],
      teams: ['frontend', 'frontend'],
    })
    expect(octokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
      owner: 'foo',
      repo: 'bar',
      pull_number: 42,
      reviewers: ['alice', 'bob'],
      team_reviewers: ['frontend'],
    })
  })

  it('omits empty reviewer arrays', async () => {
    const octokit = makeOctokit()
    await requestCodeownerReviewers(octokit, ctx, {
      users: [],
      teams: ['ops'],
    })
    const call = octokit.rest.pulls.requestReviewers.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(call.reviewers).toBeUndefined()
    expect(call.team_reviewers).toEqual(['ops'])
  })

  it('skips the API call when there are no reviewers at all', async () => {
    const octokit = makeOctokit()
    await requestCodeownerReviewers(octokit, ctx, { users: [], teams: [] })
    expect(octokit.rest.pulls.requestReviewers).not.toHaveBeenCalled()
  })
})

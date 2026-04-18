import { describe, it, expect, vi } from 'vitest'
import { autoMerge, type OctokitLike } from '../auto-merge.js'

interface PullOverrides {
  state?: string
  mergeable?: boolean | null
  mergeable_state?: string
  draft?: boolean
  sha?: string
}

function buildOctokit(opts: {
  pull?: PullOverrides
  combinedState?: 'success' | 'pending' | 'failure'
  combinedStatuses?: Array<{ context: string; state: string }>
  checkRuns?: Array<{ name: string; status: string; conclusion: string | null }>
  mergeResponse?: { sha: string; merged: boolean }
  mergeError?: { status?: number; message?: string }
}) {
  const pull = {
    head: { sha: opts.pull?.sha ?? 'deadbeef' },
    state: opts.pull?.state ?? 'open',
    mergeable: opts.pull?.mergeable ?? true,
    mergeable_state: opts.pull?.mergeable_state ?? 'clean',
    draft: opts.pull?.draft ?? false,
  }

  const getCombinedStatusForRef = vi.fn(async () => ({
    data: {
      state: opts.combinedState ?? 'success',
      statuses: opts.combinedStatuses ?? [],
    },
  }))
  const listForRef = vi.fn(async () => ({
    data: { check_runs: opts.checkRuns ?? [] },
  }))
  const merge = vi.fn(async () => {
    if (opts.mergeError) {
      throw Object.assign(new Error(opts.mergeError.message ?? 'merge failed'), {
        status: opts.mergeError.status,
      })
    }
    return { data: opts.mergeResponse ?? { sha: 'merged-sha', merged: true } }
  })
  const get = vi.fn(async () => ({ data: pull }))
  const addLabels = vi.fn(async () => ({}))
  const createComment = vi.fn(async () => ({}))

  const octokit: OctokitLike = {
    rest: {
      pulls: { get, merge },
      repos: { getCombinedStatusForRef },
      checks: { listForRef },
      issues: { addLabels, createComment },
    },
  }

  return { octokit, spies: { get, merge, addLabels, createComment, getCombinedStatusForRef, listForRef } }
}

const baseInput = {
  owner: 'octo',
  repo: 'harness',
  pullNumber: 42,
  strategy: 'squash' as const,
  requireCiPass: true,
  autoMergedLabel: 'harness:auto-merged',
}

describe('autoMerge', () => {
  it('merges the PR and applies the auto-merged label when CI is green', async () => {
    const { octokit, spies } = buildOctokit({
      combinedState: 'success',
      checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      mergeResponse: { sha: 'final-sha', merged: true },
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result).toEqual({ status: 'merged', sha: 'final-sha' })
    expect(spies.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'octo',
        repo: 'harness',
        pull_number: 42,
        merge_method: 'squash',
      }),
    )
    expect(spies.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        labels: ['harness:auto-merged'],
      }),
    )
    expect(spies.createComment).not.toHaveBeenCalled()
  })

  it('blocks and comments when combined CI status is failing', async () => {
    const { octokit, spies } = buildOctokit({
      combinedState: 'failure',
      combinedStatuses: [
        { context: 'lint', state: 'failure' },
        { context: 'test', state: 'success' },
      ],
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result.status).toBe('blocked')
    expect(spies.merge).not.toHaveBeenCalled()
    expect(spies.addLabels).not.toHaveBeenCalled()
    expect(spies.createComment).toHaveBeenCalledTimes(1)
    const [{ body }] = spies.createComment.mock.calls[0] as [{ body: string }]
    expect(body).toContain('<!-- harness[auto-merge] -->')
    expect(body).toContain('lint')
  })

  it('blocks when a check run is still in progress', async () => {
    const { octokit, spies } = buildOctokit({
      combinedState: 'success',
      checkRuns: [
        { name: 'slow-check', status: 'in_progress', conclusion: null },
      ],
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/slow-check/)
    expect(spies.merge).not.toHaveBeenCalled()
  })

  it('blocks and comments when the merge API rejects with a conflict', async () => {
    const { octokit, spies } = buildOctokit({
      mergeError: { status: 409, message: 'Merge conflict' },
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/409/)
    expect((result as { reason: string }).reason).toMatch(/Merge conflict/)
    expect(spies.addLabels).not.toHaveBeenCalled()
    expect(spies.createComment).toHaveBeenCalledTimes(1)
  })

  it('blocks without calling merge when the PR has unresolved conflicts (mergeable=false)', async () => {
    const { octokit, spies } = buildOctokit({
      pull: { mergeable: false, mergeable_state: 'dirty' },
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/dirty/)
    expect(spies.merge).not.toHaveBeenCalled()
    expect(spies.getCombinedStatusForRef).not.toHaveBeenCalled()
  })

  it('skips CI status checks when requireCiPass is false', async () => {
    const { octokit, spies } = buildOctokit({
      combinedState: 'failure',
      mergeResponse: { sha: 'skip-ci-sha', merged: true },
    })

    const result = await autoMerge({
      octokit,
      ...baseInput,
      requireCiPass: false,
    })

    expect(result).toEqual({ status: 'merged', sha: 'skip-ci-sha' })
    expect(spies.getCombinedStatusForRef).not.toHaveBeenCalled()
    expect(spies.listForRef).not.toHaveBeenCalled()
    expect(spies.merge).toHaveBeenCalled()
    expect(spies.addLabels).toHaveBeenCalled()
  })

  it('respects the configured merge strategy', async () => {
    const { octokit, spies } = buildOctokit({})

    await autoMerge({
      octokit,
      ...baseInput,
      strategy: 'rebase',
      requireCiPass: false,
    })

    expect(spies.merge).toHaveBeenCalledWith(
      expect.objectContaining({ merge_method: 'rebase' }),
    )
  })

  it('blocks when the PR is a draft', async () => {
    const { octokit, spies } = buildOctokit({
      pull: { draft: true },
    })

    const result = await autoMerge({ octokit, ...baseInput })

    expect(result.status).toBe('blocked')
    expect((result as { reason: string }).reason).toMatch(/draft/)
    expect(spies.merge).not.toHaveBeenCalled()
  })
})

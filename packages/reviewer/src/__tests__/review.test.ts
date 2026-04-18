import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffFile, HarnessConfig, ReviewResult } from '@butaosuinu/harness-shared'
import { HarnessConfigSchema } from '@butaosuinu/harness-shared'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: createMock }
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic }
})

import { DEFAULT_MODEL, MissingApiKeyError, review } from '../index.js'

const baseConfig: HarnessConfig = HarnessConfigSchema.parse({
  harness: {
    version: '1',
    risk_rules: {
      high: {
        file_patterns: [],
        ast_rules: [],
        dependency_rules: { added_packages: [] },
        diff_size: { max_files: 20, max_lines: 500 },
      },
      low: { file_patterns: [] },
    },
    ai_review: {
      focus_areas: ['security vulnerabilities', 'logic errors'],
    },
  },
})

const diff: DiffFile[] = [
  {
    filename: 'src/a.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-a\n+b',
  },
]

const validReview: ReviewResult = {
  score: 92,
  summary: 'Looks clean.',
  concerns: [
    { file: 'src/a.ts', line: 10, severity: 'low', message: 'consider a comment' },
  ],
  recommendation: 'approve',
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] }
}

beforeEach(() => {
  createMock.mockReset()
})

describe('review()', () => {
  it('returns parsed ReviewResult on happy path', async () => {
    createMock.mockResolvedValueOnce(textResponse(JSON.stringify(validReview)))

    const result = await review({
      diff,
      config: baseConfig,
      apiKey: 'sk-test',
    })

    expect(result).toEqual(validReview)
    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0]![0]
    expect(call.model).toBe(DEFAULT_MODEL)
    expect(call.temperature).toBe(0)
    expect(call.system).toContain('- security vulnerabilities')
    expect(call.system).toContain('- logic errors')
    expect(call.messages).toEqual([
      { role: 'user', content: expect.stringContaining('src/a.ts') },
    ])
  })

  it('retries once with a corrective user turn when JSON is broken, then succeeds', async () => {
    createMock
      .mockResolvedValueOnce(textResponse('not json at all'))
      .mockResolvedValueOnce(textResponse(JSON.stringify(validReview)))

    const result = await review({
      diff,
      config: baseConfig,
      apiKey: 'sk-test',
    })

    expect(result).toEqual(validReview)
    expect(createMock).toHaveBeenCalledTimes(2)
    const secondCall = createMock.mock.calls[1]![0]
    expect(secondCall.messages).toHaveLength(3)
    expect(secondCall.messages[1]).toEqual({
      role: 'assistant',
      content: 'not json at all',
    })
    expect(secondCall.messages[2].role).toBe('user')
    expect(secondCall.messages[2].content).toMatch(/not valid JSON/i)
  })

  it('falls back to request_changes when both attempts return broken JSON', async () => {
    createMock
      .mockResolvedValueOnce(textResponse('nope'))
      .mockResolvedValueOnce(textResponse('{still not valid'))

    const result = await review({
      diff,
      config: baseConfig,
      apiKey: 'sk-test',
    })

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(result.score).toBe(0)
    expect(result.recommendation).toBe('request_changes')
    expect(result.concerns).toEqual([])
    expect(result.summary.toLowerCase()).toContain('retry')
  })

  it('falls back when response JSON fails shape validation', async () => {
    createMock
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ score: 'high', summary: 'x', concerns: [], recommendation: 'approve' })),
      )
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ score: 80, summary: 'x', concerns: [], recommendation: 'merge' })),
      )

    const result = await review({
      diff,
      config: baseConfig,
      apiKey: 'sk-test',
    })

    expect(result.score).toBe(0)
    expect(result.recommendation).toBe('request_changes')
  })

  it('uses input.model override when provided', async () => {
    createMock.mockResolvedValueOnce(textResponse(JSON.stringify(validReview)))

    await review({
      diff,
      config: baseConfig,
      apiKey: 'sk-test',
      model: 'claude-opus-4-7',
    })

    expect(createMock.mock.calls[0]![0].model).toBe('claude-opus-4-7')
  })

  it('throws MissingApiKeyError for empty apiKey', async () => {
    await expect(
      review({ diff, config: baseConfig, apiKey: '' }),
    ).rejects.toBeInstanceOf(MissingApiKeyError)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('throws MissingApiKeyError for whitespace-only apiKey', async () => {
    await expect(
      review({ diff, config: baseConfig, apiKey: '   ' }),
    ).rejects.toBeInstanceOf(MissingApiKeyError)
    expect(createMock).not.toHaveBeenCalled()
  })
})

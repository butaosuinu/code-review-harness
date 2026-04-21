import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import type { ReviewResult } from '@butaosuinu/harness-shared'
import { MissingApiKeyError, type ReviewInput } from '@butaosuinu/harness-reviewer'
import { registerReviewCommand, type ReviewFn } from '../commands/review.js'
import type { OctokitLike } from '../github.js'

const configYaml = `
harness:
  version: "1"
  risk_rules:
    high:
      file_patterns:
        - "prisma/schema.prisma"
    low:
      file_patterns:
        - "**/*.md"
  ai_review:
    focus_areas:
      - "security"
      - "logic"
`

const diffFile = {
  filename: 'src/a.ts',
  status: 'modified',
  additions: 5,
  deletions: 2,
  patch: '@@\n+export const x = 1\n',
}

const defaultReviewResult: ReviewResult = {
  score: 88,
  summary: 'looks fine',
  concerns: [
    { file: 'src/a.ts', line: 3, severity: 'low', message: 'minor nit' },
  ],
  recommendation: 'approve',
}

function makeOctokit(listFilesResponse: unknown[], listCommentsResponse: unknown[] = []) {
  const octokit: OctokitLike & {
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
  } = {
    paginate: vi.fn(),
    rest: {
      pulls: {
        listFiles: { marker: 'listFiles' },
        requestReviewers: vi.fn().mockResolvedValue({}),
      },
      issues: {
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        listComments: { marker: 'listComments' },
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  }
  octokit.paginate.mockImplementation(async (fn: unknown) => {
    if (fn === octokit.rest.pulls.listFiles) return listFilesResponse
    if (fn === octokit.rest.issues.listComments) return listCommentsResponse
    return []
  })
  return octokit
}

let tmpDir: string
let summaryFile: string
let eventFile: string
const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'harness-review-'))
  mkdirSync(join(tmpDir, '.harness'))
  writeFileSync(join(tmpDir, '.harness', 'config.yml'), configYaml, 'utf8')
  eventFile = join(tmpDir, 'event.json')
  writeFileSync(
    eventFile,
    JSON.stringify({ pull_request: { number: 42 } }),
    'utf8',
  )
  summaryFile = join(tmpDir, 'step-summary.md')
  stdoutSpy.mockClear()
  stderrSpy.mockClear()
  consoleErrorSpy.mockClear()
  consoleLogSpy.mockClear()
})

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

function env(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    ...overrides,
  } as NodeJS.ProcessEnv
}

async function runReview(
  octokit: OctokitLike,
  reviewFn: ReviewFn,
  extraArgs: string[] = [],
  envOverrides: NodeJS.ProcessEnv = env({ ANTHROPIC_API_KEY: 'sk-test' }),
): Promise<void> {
  const program = new Command()
  program.exitOverride()
  registerReviewCommand(program, {
    octokitFactory: async () => octokit,
    reviewFn,
    env: envOverrides,
  })
  await program.parseAsync(
    [
      'review',
      '--github-token',
      'fake',
      '--output',
      'json',
      '--cwd',
      tmpDir,
      ...extraArgs,
    ],
    { from: 'user' },
  )
}

describe('review command', () => {
  it('writes JSON to stdout, appends step summary, and upserts a marker comment', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn

    await runReview(octokit, reviewFn)

    expect(reviewFn).toHaveBeenCalledTimes(1)
    const input = (reviewFn as unknown as {
      mock: { calls: [ReviewInput][] }
    }).mock.calls[0]![0]
    expect(input.diff).toHaveLength(1)
    expect(input.diff[0]!.filename).toBe('src/a.ts')
    expect(input.apiKey).toBe('sk-test')

    const stdoutCalls = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    const parsed = JSON.parse(stdoutCalls.trim()) as ReviewResult
    expect(parsed.score).toBe(88)
    expect(parsed.recommendation).toBe('approve')

    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1)
    const commentBody = (
      octokit.rest.issues.createComment.mock.calls[0]![0] as { body: string }
    ).body
    expect(commentBody).toContain('<!-- harness[ai-review] -->')
    expect(commentBody).toContain('score `88`')
    expect(commentBody).toContain('threshold `75`')
    expect(commentBody).toContain('approve')

    const summary = readFileSync(summaryFile, 'utf8')
    expect(summary).toContain('## Harness AI review')
    expect(summary).toContain('`88`')
  })

  it('reads ANTHROPIC_API_KEY from the flag when env is unset', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn

    await runReview(
      octokit,
      reviewFn,
      ['--anthropic-api-key', 'sk-from-flag'],
      env({}),
    )
    const input = (reviewFn as unknown as {
      mock: { calls: [ReviewInput][] }
    }).mock.calls[0]![0]
    expect(input.apiKey).toBe('sk-from-flag')
  })

  it('exits 1 when neither flag nor env provide the API key', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number | null) => {
        throw new Error(`__exit_${code ?? 0}__`)
      }) as (code?: number | null) => never)

    try {
      await expect(runReview(octokit, reviewFn, [], env({}))).rejects.toThrow(
        /__exit_1__/,
      )
      expect(reviewFn).not.toHaveBeenCalled()
      const stderr = consoleErrorSpy.mock.calls
        .map((c) => String(c[0]))
        .join('\n')
      expect(stderr).toMatch(/ANTHROPIC_API_KEY/)
    } finally {
      exitSpy.mockRestore()
    }
  })

  it('exits 1 when the reviewer throws MissingApiKeyError', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => {
      throw new MissingApiKeyError()
    }) as ReviewFn
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number | null) => {
        throw new Error(`__exit_${code ?? 0}__`)
      }) as (code?: number | null) => never)

    try {
      await expect(runReview(octokit, reviewFn)).rejects.toThrow(/__exit_1__/)
      const stderr = consoleErrorSpy.mock.calls
        .map((c) => String(c[0]))
        .join('\n')
      expect(stderr).toMatch(/ANTHROPIC_API_KEY/)
    } finally {
      exitSpy.mockRestore()
    }
  })

  it('respects --no-post-comment', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn

    await runReview(octokit, reviewFn, ['--no-post-comment'])
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('updates an existing harness[ai-review] comment instead of creating a new one', async () => {
    const octokit = makeOctokit(
      [diffFile],
      [
        { id: 11, body: 'unrelated' },
        { id: 99, body: '<!-- harness[ai-review] -->\nold body' },
        { id: 200, body: '<!-- harness[classify] -->\nclassify comment (must not touch)' },
      ],
    )
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn

    await runReview(octokit, reviewFn)

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledTimes(1)
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 99 }),
    )
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('passes --model through to the reviewer', async () => {
    const octokit = makeOctokit([diffFile])
    const reviewFn = vi.fn(async () => defaultReviewResult) as ReviewFn

    await runReview(octokit, reviewFn, ['--model', 'claude-opus-4-7'])
    const input = (reviewFn as unknown as {
      mock: { calls: [ReviewInput][] }
    }).mock.calls[0]![0]
    expect(input.model).toBe('claude-opus-4-7')
  })
})

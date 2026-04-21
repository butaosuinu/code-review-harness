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
import { registerClassifyCommand } from '../commands/classify.js'
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
  auto_merge:
    labels:
      high_risk: "harness:high-risk"
      low_risk: "harness:low-risk"
`

function makeOctokit(listFilesResponse: unknown[], listCommentsResponse: unknown[] = []) {
  const paginate = vi.fn(async (fn: unknown) => {
    if (fn === octokit.rest.pulls.listFiles) return listFilesResponse
    if (fn === octokit.rest.issues.listComments) return listCommentsResponse
    return []
  })
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
    paginate,
    rest: {
      pulls: {
        listFiles: { marker: 'listFiles' },
        requestReviewers: vi.fn().mockResolvedValue({}),
      },
      issues: {
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockRejectedValue(
          Object.assign(new Error('Not Found'), { status: 404 }),
        ),
        listComments: { marker: 'listComments' },
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  }
  return octokit
}

let tmpDir: string
let summaryFile: string
let eventFile: string
const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'harness-classify-gh-'))
  mkdirSync(join(tmpDir, '.harness'))
  writeFileSync(join(tmpDir, '.harness', 'config.yml'), configYaml, 'utf8')
  eventFile = join(tmpDir, 'event.json')
  writeFileSync(
    eventFile,
    JSON.stringify({ pull_request: { number: 7 } }),
    'utf8',
  )
  summaryFile = join(tmpDir, 'step-summary.md')
  stdoutSpy.mockClear()
})

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

function env(): NodeJS.ProcessEnv {
  return {
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_STEP_SUMMARY: summaryFile,
  } as NodeJS.ProcessEnv
}

async function runClassify(
  octokit: OctokitLike,
  extraArgs: string[] = [],
  envOverrides: NodeJS.ProcessEnv = env(),
): Promise<void> {
  const program = new Command()
  program.exitOverride()
  registerClassifyCommand(program, {
    octokitFactory: async () => octokit,
    env: envOverrides,
  })
  await program.parseAsync(
    [
      'classify',
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

describe('classify command — GitHub integration', () => {
  it('applies high-risk label, posts new comment, requests codeowner reviewers on high risk', async () => {
    writeFileSync(
      join(tmpDir, 'CODEOWNERS'),
      'prisma/** @acme/db @alice\n',
      'utf8',
    )
    const octokit = makeOctokit([
      {
        filename: 'prisma/schema.prisma',
        status: 'modified',
        additions: 5,
        deletions: 1,
        patch: '@@\n+model User {}\n',
      },
    ])
    await runClassify(octokit)

    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      issue_number: 7,
      labels: ['harness:high-risk'],
    })
    expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'harness:low-risk' }),
    )
    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1)
    const commentCall = octokit.rest.issues.createComment.mock.calls[0]![0] as {
      body: string
    }
    expect(commentCall.body).toContain('<!-- harness[classify] -->')
    expect(commentCall.body).toContain('HIGH')

    expect(octokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      pull_number: 7,
      reviewers: ['alice'],
      team_reviewers: ['db'],
    })

    const summary = readFileSync(summaryFile, 'utf8')
    expect(summary).toContain('## Harness classify')
    expect(summary).toContain('HIGH')
  })

  it('applies low-risk label and skips reviewer request on low risk', async () => {
    const octokit = makeOctokit([
      {
        filename: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '',
      },
    ])
    await runClassify(octokit)

    expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['harness:low-risk'] }),
    )
    expect(octokit.rest.pulls.requestReviewers).not.toHaveBeenCalled()
  })

  it('updates an existing marker comment instead of creating a new one', async () => {
    const octokit = makeOctokit(
      [
        {
          filename: 'prisma/schema.prisma',
          status: 'modified',
          additions: 1,
          deletions: 0,
        },
      ],
      [
        { id: 11, body: 'old unrelated' },
        { id: 99, body: '<!-- harness[classify] -->\nprevious run' },
      ],
    )
    await runClassify(octokit)
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 99 }),
    )
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('respects --no-labels and --no-post-comment', async () => {
    const octokit = makeOctokit([
      {
        filename: 'prisma/schema.prisma',
        status: 'modified',
        additions: 1,
        deletions: 0,
      },
    ])
    await runClassify(octokit, ['--no-labels', '--no-post-comment'])
    expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled()
    expect(octokit.rest.issues.removeLabel).not.toHaveBeenCalled()
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })
})

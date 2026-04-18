import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jsYaml from 'js-yaml'

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}))

import inquirer from 'inquirer'
import { Command } from 'commander'
import { registerInitCommand } from '../commands/init.js'

const promptMock = inquirer.prompt as unknown as ReturnType<typeof vi.fn>

function runInit(cwd: string, yes = false) {
  const program = new Command()
  program.exitOverride()
  registerInitCommand(program)
  return program.parseAsync(
    ['init', ...(yes ? ['--yes'] : []), '--cwd', cwd],
    { from: 'user' },
  )
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'harness-init-test-'))
  return () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
})

describe('harness init', () => {
  it('writes base config with --yes', async () => {
    await runInit(tmpDir, true)
    const path = join(tmpDir, '.harness', 'config.yml')
    expect(existsSync(path)).toBe(true)
    const parsed = jsYaml.load(readFileSync(path, 'utf8')) as {
      harness: { version: string; auto_merge: { enabled: boolean } }
    }
    expect(parsed.harness.version).toBe('1')
    expect(parsed.harness.auto_merge.enabled).toBe(false)
  })

  it('uses prisma-auth0 template when Prisma + Auth0 selected', async () => {
    promptMock.mockResolvedValueOnce({
      databases: ['PostgreSQL'],
      orm: 'Prisma',
      auth: ['Auth0'],
      infrastructure: [],
      primaryLanguage: 'TypeScript',
      autoMergeEnabled: true,
      aiScoreThreshold: 80,
      maxFiles: 25,
      maxLines: 600,
    })

    await runInit(tmpDir)
    const path = join(tmpDir, '.harness', 'config.yml')
    const parsed = jsYaml.load(readFileSync(path, 'utf8')) as {
      harness: {
        auto_merge: { enabled: boolean; ai_score_threshold: number }
        risk_rules: {
          high: {
            file_patterns: string[]
            diff_size: { max_files: number; max_lines: number }
          }
        }
      }
    }
    expect(parsed.harness.auto_merge.enabled).toBe(true)
    expect(parsed.harness.auto_merge.ai_score_threshold).toBe(80)
    expect(parsed.harness.risk_rules.high.file_patterns).toContain(
      'prisma/schema.prisma',
    )
    expect(parsed.harness.risk_rules.high.diff_size.max_files).toBe(25)
    expect(parsed.harness.risk_rules.high.diff_size.max_lines).toBe(600)
  })
})

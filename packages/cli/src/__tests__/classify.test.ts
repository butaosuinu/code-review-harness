import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cliEntry = resolve(here, '..', '..', 'dist', 'index.js')

function runCli(args: string[], cwd: string): string {
  return execFileSync('node', [cliEntry, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function initRepo(cwd: string) {
  git(['init', '--initial-branch=main'], cwd)
  git(['config', 'user.email', 'test@example.com'], cwd)
  git(['config', 'user.name', 'test'], cwd)
  git(['config', 'commit.gpgsign', 'false'], cwd)
}

const baseConfig = `
harness:
  version: "1"
  risk_rules:
    high:
      file_patterns:
        - "prisma/schema.prisma"
        - ".env*"
      diff_size:
        max_files: 20
        max_lines: 500
    low:
      file_patterns:
        - "**/*.test.ts"
        - "**/*.md"
`

describe('harness classify (local mode)', () => {
  beforeAll(() => {
    if (!existsSync(cliEntry)) {
      throw new Error(
        `CLI entry not found at ${cliEntry}. Run \`pnpm --filter @butaosuinu/harness-cli build\` first.`,
      )
    }
  })

  it('classifies test-only changes as low', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-classify-low-'))
    try {
      initRepo(dir)
      mkdirSync(join(dir, '.harness'), { recursive: true })
      writeFileSync(join(dir, '.harness', 'config.yml'), baseConfig, 'utf8')
      writeFileSync(join(dir, 'a.md'), 'initial\n', 'utf8')
      git(['add', '.'], dir)
      git(['commit', '-m', 'initial'], dir)

      writeFileSync(join(dir, 'foo.test.ts'), "export const x = 1\n", 'utf8')
      git(['add', '.'], dir)
      git(['commit', '-m', 'add test'], dir)

      const out = runCli(
        [
          'classify',
          '--base-sha',
          'HEAD~1',
          '--head-sha',
          'HEAD',
          '--output',
          'json',
          '--cwd',
          dir,
        ],
        dir,
      )
      const parsed = JSON.parse(out) as { riskLevel: string }
      expect(parsed.riskLevel).toBe('low')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('classifies prisma schema changes as high', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-classify-high-'))
    try {
      initRepo(dir)
      mkdirSync(join(dir, '.harness'), { recursive: true })
      writeFileSync(join(dir, '.harness', 'config.yml'), baseConfig, 'utf8')
      mkdirSync(join(dir, 'prisma'), { recursive: true })
      writeFileSync(join(dir, 'prisma', 'schema.prisma'), 'datasource db {}\n', 'utf8')
      git(['add', '.'], dir)
      git(['commit', '-m', 'initial'], dir)

      writeFileSync(
        join(dir, 'prisma', 'schema.prisma'),
        'datasource db {}\nmodel User {}\n',
        'utf8',
      )
      git(['add', '.'], dir)
      git(['commit', '-m', 'modify'], dir)

      const out = runCli(
        [
          'classify',
          '--base-sha',
          'HEAD~1',
          '--head-sha',
          'HEAD',
          '--output',
          'json',
          '--cwd',
          dir,
        ],
        dir,
      )
      const parsed = JSON.parse(out) as {
        riskLevel: string
        matchedRules: Array<{ ruleType: string }>
      }
      expect(parsed.riskLevel).toBe('high')
      expect(parsed.matchedRules[0]?.ruleType).toBe('file_pattern')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

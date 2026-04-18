import { describe, expect, it } from 'vitest'
import type { DiffFile, HarnessConfig } from '@butaosuinu/harness-shared'
import { HarnessConfigSchema } from '@butaosuinu/harness-shared'
import { classify } from '../pipeline.js'
import { loadDiffFixture } from './helpers.js'

const baseConfig: HarnessConfig = HarnessConfigSchema.parse({
  harness: {
    version: '1',
    risk_rules: {
      high: {
        file_patterns: ['prisma/schema.prisma', '.env*'],
        ast_rules: [],
        dependency_rules: { added_packages: ['prisma', '@prisma/*'] },
        diff_size: { max_files: 20, max_lines: 500 },
      },
      low: {
        file_patterns: ['**/*.test.ts', '**/*.md', '**/*.spec.ts'],
      },
    },
  },
})

const noopReadFile = async () => ''

function makeManyFiles(count: number): DiffFile[] {
  return Array.from({ length: count }, (_, i) => ({
    filename: `src/generated/file${i}.ts`,
    status: 'modified' as const,
    additions: 3,
    deletions: 0,
  }))
}

describe('classify pipeline', () => {
  it('returns HIGH on file_pattern match (Step 1 short-circuit)', async () => {
    const files = loadDiffFixture('schema-change.diff')
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('high')
    expect(result.matchedRules[0]?.ruleType).toBe('file_pattern')
  })

  it('returns HIGH on dependency match (Step 3)', async () => {
    const files = loadDiffFixture('dep-add.diff')
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('high')
    expect(result.matchedRules[0]?.ruleType).toBe('dependency')
  })

  it('returns HIGH on diff size (Step 4)', async () => {
    const files = makeManyFiles(25)
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('high')
    expect(result.matchedRules[0]?.ruleType).toBe('diff_size')
  })

  it('returns LOW via low.file_patterns override (Step 5)', async () => {
    const files = loadDiffFixture('test-only.diff')
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('low')
    expect(result.summary).toContain('low-risk')
  })

  it('returns LOW for README-only changes', async () => {
    const files = loadDiffFixture('readme-update.diff')
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('low')
  })

  it('returns LOW with empty matched rules for mixed app changes', async () => {
    const files = loadDiffFixture('mixed.diff')
    const result = await classify({
      files,
      config: baseConfig,
      readFile: noopReadFile,
    })
    expect(result.riskLevel).toBe('low')
    expect(result.matchedRules).toEqual([])
    expect(result.summary).toBe('no high-risk signals detected')
  })
})

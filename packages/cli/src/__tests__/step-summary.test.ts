import { describe, expect, it, vi } from 'vitest'
import type { ClassifyResult } from '@butaosuinu/harness-shared'
import { renderStepSummary, writeStepSummary } from '../step-summary.js'

const highRiskResult: ClassifyResult = {
  riskLevel: 'high',
  summary: 'migration files touched',
  matchedRules: [
    {
      ruleId: 'prisma-schema',
      ruleType: 'file_pattern',
      description: 'Prisma schema changed',
      matches: [{ file: 'prisma/schema.prisma' }],
    },
  ],
}

describe('renderStepSummary', () => {
  it('includes risk level, summary, and rules', () => {
    const md = renderStepSummary(highRiskResult)
    expect(md).toContain('## Harness classify')
    expect(md).toContain('**Risk level:** `HIGH`')
    expect(md).toContain('**Summary:** migration files touched')
    expect(md).toContain('### Matched rules')
    expect(md).toContain('prisma-schema')
    expect(md).toContain('prisma/schema.prisma')
  })

  it('truncates matches beyond 5 per rule', () => {
    const many: ClassifyResult = {
      riskLevel: 'low',
      summary: 'big',
      matchedRules: [
        {
          ruleId: 'r',
          ruleType: 'diff_size',
          description: 'too many files',
          matches: Array.from({ length: 9 }, (_, i) => ({
            file: `f${i}.ts`,
          })),
        },
      ],
    }
    const md = renderStepSummary(many)
    expect(md).toContain('(+4 more)')
  })
})

describe('writeStepSummary', () => {
  it('appends rendered markdown when GITHUB_STEP_SUMMARY is set', () => {
    const append = vi.fn()
    writeStepSummary(
      highRiskResult,
      { GITHUB_STEP_SUMMARY: '/tmp/summary.md' } as NodeJS.ProcessEnv,
      append,
    )
    expect(append).toHaveBeenCalledTimes(1)
    const [path, data] = append.mock.calls[0]!
    expect(path).toBe('/tmp/summary.md')
    expect(data).toContain('## Harness classify')
    expect(data.endsWith('\n')).toBe(true)
  })

  it('no-ops when GITHUB_STEP_SUMMARY is unset', () => {
    const append = vi.fn()
    writeStepSummary(highRiskResult, {} as NodeJS.ProcessEnv, append)
    expect(append).not.toHaveBeenCalled()
  })

  it('no-ops when GITHUB_STEP_SUMMARY is empty', () => {
    const append = vi.fn()
    writeStepSummary(
      highRiskResult,
      { GITHUB_STEP_SUMMARY: '   ' } as NodeJS.ProcessEnv,
      append,
    )
    expect(append).not.toHaveBeenCalled()
  })
})

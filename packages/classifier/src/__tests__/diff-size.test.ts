import { describe, expect, it } from 'vitest'
import type { DiffFile } from '@butaosuinu/harness-shared'
import { evaluateDiffSize } from '../engines/diff-size.js'

function makeFiles(count: number, linesPerFile = 5): DiffFile[] {
  return Array.from({ length: count }, (_, i) => ({
    filename: `src/generated/file${i}.ts`,
    status: 'modified' as const,
    additions: linesPerFile,
    deletions: 0,
  }))
}

describe('evaluateDiffSize', () => {
  it('does not flag when within limits', () => {
    const files = makeFiles(5, 10)
    const matches = evaluateDiffSize(files, { max_files: 20, max_lines: 500 })
    expect(matches).toEqual([])
  })

  it('flags when file count exceeds max_files', () => {
    const files = makeFiles(25, 1)
    const matches = evaluateDiffSize(files, { max_files: 20, max_lines: 500 })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.ruleId).toBe('diff_size:max_files')
    expect(matches[0]?.description).toContain('25 files')
  })

  it('flags when line count exceeds max_lines', () => {
    const files = makeFiles(3, 300)
    const matches = evaluateDiffSize(files, { max_files: 20, max_lines: 500 })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.ruleId).toBe('diff_size:max_lines')
    expect(matches[0]?.description).toContain('900 lines')
  })

  it('flags both when both exceeded', () => {
    const files = makeFiles(25, 100)
    const matches = evaluateDiffSize(files, { max_files: 20, max_lines: 500 })
    expect(matches).toHaveLength(2)
  })
})

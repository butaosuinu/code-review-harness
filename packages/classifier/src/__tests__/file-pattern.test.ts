import { describe, it, expect } from 'vitest'
import {
  evaluateFilePatterns,
  allFilesMatchLowRisk,
} from '../engines/file-pattern.js'
import { loadDiffFixture } from './helpers.js'

describe('evaluateFilePatterns', () => {
  it('matches prisma schema changes as high-risk', () => {
    const files = loadDiffFixture('schema-change.diff')
    const matches = evaluateFilePatterns(files, [
      'prisma/schema.prisma',
      '.env*',
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.ruleId).toBe('file_pattern:prisma/schema.prisma')
    expect(matches[0]?.matches[0]?.file).toBe('prisma/schema.prisma')
  })

  it('returns empty when no patterns match', () => {
    const files = loadDiffFixture('mixed.diff')
    const matches = evaluateFilePatterns(files, ['prisma/schema.prisma'])
    expect(matches).toEqual([])
  })

  it('returns empty for empty patterns', () => {
    const files = loadDiffFixture('mixed.diff')
    expect(evaluateFilePatterns(files, [])).toEqual([])
  })
})

describe('allFilesMatchLowRisk', () => {
  const lowPatterns = ['**/*.test.ts', '**/*.md', '**/*.spec.ts']

  it('returns true when every file matches a low pattern', () => {
    const files = loadDiffFixture('test-only.diff')
    expect(allFilesMatchLowRisk(files, lowPatterns)).toBe(true)
  })

  it('returns true for README-only changes', () => {
    const files = loadDiffFixture('readme-update.diff')
    expect(allFilesMatchLowRisk(files, lowPatterns)).toBe(true)
  })

  it('returns false when non-low files are present', () => {
    const files = loadDiffFixture('mixed.diff')
    expect(allFilesMatchLowRisk(files, lowPatterns)).toBe(false)
  })

  it('returns false when patterns list is empty', () => {
    const files = loadDiffFixture('test-only.diff')
    expect(allFilesMatchLowRisk(files, [])).toBe(false)
  })
})

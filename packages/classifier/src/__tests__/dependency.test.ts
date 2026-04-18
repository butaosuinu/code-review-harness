import { describe, expect, it } from 'vitest'
import { evaluateDependencyAdditions } from '../engines/dependency.js'
import { loadDiffFixture } from './helpers.js'

describe('evaluateDependencyAdditions', () => {
  it('flags when blocklisted package appears as added', () => {
    const files = loadDiffFixture('dep-add.diff')
    const matches = evaluateDependencyAdditions(files, ['prisma', '@prisma/*'])
    const ids = matches.map((m) => m.ruleId).sort()
    expect(ids).toEqual(['dependency:@prisma/*', 'dependency:prisma'])
  })

  it('supports exact-name blocklist', () => {
    const files = loadDiffFixture('dep-add.diff')
    const matches = evaluateDependencyAdditions(files, ['@prisma/client'])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.matches[0]?.snippet).toBe('@prisma/client')
  })

  it('ignores non-manifest files', () => {
    const files = loadDiffFixture('schema-change.diff')
    const matches = evaluateDependencyAdditions(files, ['prisma'])
    expect(matches).toEqual([])
  })

  it('returns empty for empty blocklist', () => {
    const files = loadDiffFixture('dep-add.diff')
    expect(evaluateDependencyAdditions(files, [])).toEqual([])
  })
})

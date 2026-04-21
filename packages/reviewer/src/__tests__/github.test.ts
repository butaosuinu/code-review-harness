import { describe, expect, it } from 'vitest'
import type { DiffFile, ReviewConcern } from '@butaosuinu/harness-shared'

import { computePosition, toReviewComments } from '../github.js'

describe('computePosition', () => {
  it('resolves an added line in a single hunk', () => {
    const patch = '@@ -1,2 +1,3 @@\n a\n+b\n c'
    expect(computePosition(patch, 2)).toBe(2)
  })

  it('resolves a context line after additions and deletions', () => {
    const patch = '@@ -1,3 +1,3 @@\n a\n-b\n+x\n c'
    expect(computePosition(patch, 1)).toBe(1)
    expect(computePosition(patch, 2)).toBe(3)
    expect(computePosition(patch, 3)).toBe(4)
  })

  it('returns null when the target line never appears on the new side', () => {
    const patch = '@@ -1,2 +1,1 @@\n a\n-b'
    expect(computePosition(patch, 2)).toBeNull()
  })

  it('returns null for a line outside the hunk range', () => {
    const patch = '@@ -1,2 +1,3 @@\n a\n+b\n c'
    expect(computePosition(patch, 99)).toBeNull()
  })

  it('returns null for empty or undefined patches', () => {
    expect(computePosition('', 1)).toBeNull()
    expect(computePosition(undefined, 1)).toBeNull()
  })

  it('handles multiple hunks and counts subsequent hunk headers', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' a',
      '+x',
      '-b',
      '@@ -10,2 +10,3 @@',
      ' d',
      '+y',
      ' e',
    ].join('\n')

    expect(computePosition(patch, 1)).toBe(1)
    expect(computePosition(patch, 2)).toBe(2)
    expect(computePosition(patch, 10)).toBe(5)
    expect(computePosition(patch, 11)).toBe(6)
    expect(computePosition(patch, 12)).toBe(7)
  })
})

describe('toReviewComments', () => {
  const diff: DiffFile[] = [
    {
      filename: 'src/a.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1,2 +1,3 @@\n a\n+b\n c',
    },
    {
      filename: 'src/b.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
    },
  ]

  const concern = (
    file: string,
    line: number,
    severity: ReviewConcern['severity'],
    message: string,
  ): ReviewConcern => ({ file, line, severity, message })

  it('maps resolvable concerns to inline comments with severity-tagged bodies', () => {
    const { comments, unresolved } = toReviewComments(diff, [
      concern('src/a.ts', 2, 'low', 'extract constant'),
    ])

    expect(unresolved).toEqual([])
    expect(comments).toEqual([
      { path: 'src/a.ts', position: 2, body: '**[low]** extract constant' },
    ])
  })

  it('marks concerns on files absent from the diff as unresolved', () => {
    const c = concern('src/missing.ts', 1, 'high', 'what?')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('marks concerns on files with no patch as unresolved', () => {
    const c = concern('src/b.ts', 1, 'medium', 'new file no patch')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('marks concerns whose line is outside any hunk as unresolved', () => {
    const c = concern('src/a.ts', 99, 'low', 'out of range')
    const { comments, unresolved } = toReviewComments(diff, [c])
    expect(comments).toEqual([])
    expect(unresolved).toEqual([c])
  })

  it('splits resolvable and unresolvable concerns correctly', () => {
    const resolvable = concern('src/a.ts', 2, 'low', 'm1')
    const unresolved1 = concern('src/b.ts', 1, 'medium', 'm2')
    const unresolved2 = concern('src/a.ts', 99, 'high', 'm3')

    const result = toReviewComments(diff, [resolvable, unresolved1, unresolved2])
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]!.path).toBe('src/a.ts')
    expect(result.unresolved).toEqual([unresolved1, unresolved2])
  })
})

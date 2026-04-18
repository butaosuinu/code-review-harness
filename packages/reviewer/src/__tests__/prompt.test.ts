import { describe, expect, it } from 'vitest'
import type { DiffFile } from '@butaosuinu/harness-shared'
import {
  SYSTEM_PROMPT_TEMPLATE,
  buildSystemPrompt,
  serializeDiff,
} from '../prompt.js'

describe('buildSystemPrompt', () => {
  it('injects focus areas as a bullet list', () => {
    const prompt = buildSystemPrompt([
      'security vulnerabilities',
      'logic errors',
    ])
    expect(prompt).toContain('- security vulnerabilities')
    expect(prompt).toContain('- logic errors')
    expect(prompt).not.toContain('{focus_areas}')
  })

  it('uses "(none specified)" placeholder when focus areas are empty', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('- (none specified)')
    expect(prompt).not.toContain('{focus_areas}')
  })

  it('preserves the template around the placeholder', () => {
    const prompt = buildSystemPrompt(['x'])
    expect(prompt).toContain(
      'You are a code reviewer for an automated CI pipeline.',
    )
    expect(prompt).toContain('Scoring guide:')
    expect(prompt).toContain(
      'Note: This diff has already passed static analysis',
    )
  })

  it('only replaces the placeholder once', () => {
    const occurrences = SYSTEM_PROMPT_TEMPLATE.split('{focus_areas}').length - 1
    expect(occurrences).toBe(1)
  })
})

describe('serializeDiff', () => {
  const file: DiffFile = {
    filename: 'src/app.ts',
    status: 'modified',
    additions: 3,
    deletions: 1,
    patch: '@@ -1 +1 @@\n-old\n+new',
  }

  it('formats a single file with header and patch', () => {
    const out = serializeDiff([file])
    expect(out).toBe(
      '=== src/app.ts (modified, +3/-1) ===\n@@ -1 +1 @@\n-old\n+new',
    )
  })

  it('joins multiple files with blank line separators', () => {
    const other: DiffFile = {
      filename: 'README.md',
      status: 'added',
      additions: 10,
      deletions: 0,
      patch: '+# Title',
    }
    const out = serializeDiff([file, other])
    expect(out).toContain('=== src/app.ts (modified, +3/-1) ===')
    expect(out).toContain('=== README.md (added, +10/-0) ===')
    expect(out.split('\n\n').length).toBe(2)
  })

  it('falls back to placeholder text when patch is missing', () => {
    const noPatch: DiffFile = {
      filename: 'bin/tool',
      status: 'added',
      additions: 0,
      deletions: 0,
    }
    const out = serializeDiff([noPatch])
    expect(out).toContain('(no patch available)')
  })

  it('returns an empty string for an empty diff', () => {
    expect(serializeDiff([])).toBe('')
  })
})

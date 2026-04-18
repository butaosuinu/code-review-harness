import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { parseUnifiedDiff } from '../parse-diff.js'
import type { DiffFile } from '@butaosuinu/harness-shared'

const here = dirname(fileURLToPath(import.meta.url))

export function loadDiffFixture(name: string): DiffFile[] {
  const path = join(here, 'fixtures', 'diffs', name)
  const content = readFileSync(path, 'utf8')
  return parseUnifiedDiff(content)
}

export function fixturePath(...segments: string[]): string {
  return join(here, 'fixtures', ...segments)
}

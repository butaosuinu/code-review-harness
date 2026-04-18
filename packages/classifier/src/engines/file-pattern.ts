import type { DiffFile, MatchedRule } from '@butaosuinu/harness-shared'
import { minimatch } from 'minimatch'

export function evaluateFilePatterns(
  files: DiffFile[],
  patterns: string[],
): MatchedRule[] {
  if (patterns.length === 0) return []

  const matchesByPattern = new Map<string, { file: string }[]>()

  for (const file of files) {
    for (const pattern of patterns) {
      if (minimatch(file.filename, pattern, { dot: true })) {
        const list = matchesByPattern.get(pattern) ?? []
        list.push({ file: file.filename })
        matchesByPattern.set(pattern, list)
      }
    }
  }

  const rules: MatchedRule[] = []
  for (const [pattern, matches] of matchesByPattern) {
    rules.push({
      ruleId: `file_pattern:${pattern}`,
      ruleType: 'file_pattern',
      description: `files matching "${pattern}"`,
      matches,
    })
  }
  return rules
}

export function allFilesMatchLowRisk(
  files: DiffFile[],
  patterns: string[],
): boolean {
  if (files.length === 0) return false
  if (patterns.length === 0) return false
  return files.every((f) =>
    patterns.some((p) => minimatch(f.filename, p, { dot: true })),
  )
}

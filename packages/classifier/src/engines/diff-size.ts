import type { DiffFile, MatchedRule } from '@butaosuinu/harness-shared'

export interface DiffSizeLimits {
  max_files: number
  max_lines: number
}

export function evaluateDiffSize(
  files: DiffFile[],
  limits: DiffSizeLimits,
): MatchedRule[] {
  const fileCount = files.length
  const lineCount = files.reduce((sum, f) => sum + f.additions + f.deletions, 0)

  const matches: MatchedRule[] = []

  if (fileCount > limits.max_files) {
    matches.push({
      ruleId: 'diff_size:max_files',
      ruleType: 'diff_size',
      description: `${fileCount} files changed (limit: ${limits.max_files})`,
      matches: files.map((f) => ({ file: f.filename })),
    })
  }

  if (lineCount > limits.max_lines) {
    matches.push({
      ruleId: 'diff_size:max_lines',
      ruleType: 'diff_size',
      description: `${lineCount} lines changed (limit: ${limits.max_lines})`,
      matches: files.map((f) => ({ file: f.filename })),
    })
  }

  return matches
}

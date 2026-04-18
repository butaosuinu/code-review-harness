import type { DiffFile, MatchedRule, RuleMatch } from '@butaosuinu/harness-shared'
import { minimatch } from 'minimatch'

const MANIFEST_PATTERNS = [
  'package.json',
  '**/package.json',
  'pnpm-lock.yaml',
  '**/pnpm-lock.yaml',
  'package-lock.json',
  '**/package-lock.json',
  'yarn.lock',
  '**/yarn.lock',
]

function isManifest(filename: string): boolean {
  return MANIFEST_PATTERNS.some((p) => minimatch(filename, p, { dot: true }))
}

function extractAddedPackageNames(patch: string): string[] {
  const names: string[] = []
  const lines = patch.split('\n')
  const pkgRegex = /"([@a-zA-Z0-9_\-./]+)"\s*:/
  for (const line of lines) {
    if (!line.startsWith('+')) continue
    if (line.startsWith('+++')) continue
    const body = line.slice(1).trim()
    const m = pkgRegex.exec(body)
    if (m) names.push(m[1]!)
  }
  return names
}

function packageMatchesPattern(name: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    return minimatch(name, pattern)
  }
  return name === pattern
}

export function evaluateDependencyAdditions(
  files: DiffFile[],
  blocklist: string[],
): MatchedRule[] {
  if (blocklist.length === 0) return []

  const hitsByPattern = new Map<string, RuleMatch[]>()

  for (const file of files) {
    if (!isManifest(file.filename)) continue
    if (!file.patch) continue
    const addedNames = extractAddedPackageNames(file.patch)
    for (const name of addedNames) {
      for (const pattern of blocklist) {
        if (packageMatchesPattern(name, pattern)) {
          const list = hitsByPattern.get(pattern) ?? []
          list.push({ file: file.filename, snippet: name })
          hitsByPattern.set(pattern, list)
        }
      }
    }
  }

  const rules: MatchedRule[] = []
  for (const [pattern, matches] of hitsByPattern) {
    rules.push({
      ruleId: `dependency:${pattern}`,
      ruleType: 'dependency',
      description: `blocklisted package added: "${pattern}"`,
      matches,
    })
  }
  return rules
}

import { appendFileSync as nodeAppendFileSync } from 'node:fs'
import type { ClassifyResult } from '@butaosuinu/harness-shared'

const MAX_MATCHES_PER_RULE = 5

export function renderStepSummary(result: ClassifyResult): string {
  const lines: string[] = []
  lines.push('## Harness classify')
  lines.push('')
  lines.push(`**Risk level:** \`${result.riskLevel.toUpperCase()}\``)
  lines.push('')
  lines.push(`**Summary:** ${result.summary}`)
  lines.push('')

  if (result.matchedRules.length > 0) {
    lines.push('### Matched rules')
    lines.push('')
    for (const rule of result.matchedRules) {
      lines.push(`- **[${rule.ruleType}] ${rule.ruleId}** — ${rule.description}`)
      const shown = rule.matches.slice(0, MAX_MATCHES_PER_RULE)
      for (const m of shown) {
        const lineInfo = m.line !== undefined ? `:${m.line}` : ''
        lines.push(`  - \`${m.file}${lineInfo}\``)
      }
      if (rule.matches.length > MAX_MATCHES_PER_RULE) {
        lines.push(`  - _(+${rule.matches.length - MAX_MATCHES_PER_RULE} more)_`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function writeStepSummary(
  result: ClassifyResult,
  env: NodeJS.ProcessEnv = process.env,
  appendFileSync: (path: string, data: string) => void = nodeAppendFileSync,
): void {
  const target = env.GITHUB_STEP_SUMMARY
  if (!target || target.trim() === '') return
  appendFileSync(target, `${renderStepSummary(result)}\n`)
}

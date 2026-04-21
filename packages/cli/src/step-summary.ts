import { appendFileSync as nodeAppendFileSync } from 'node:fs'
import type { ClassifyResult, ReviewResult } from '@butaosuinu/harness-shared'

const MAX_MATCHES_PER_RULE = 5
const MAX_CONCERNS_SHOWN = 10

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

export function renderReviewStepSummary(
  result: ReviewResult,
  threshold: number,
): string {
  const verdict = result.score >= threshold ? 'PASS' : 'BELOW THRESHOLD'
  const lines: string[] = []
  lines.push('## Harness AI review')
  lines.push('')
  lines.push(`**Score:** \`${result.score}\` / threshold \`${threshold}\` — ${verdict}`)
  lines.push('')
  lines.push(`**Recommendation:** \`${result.recommendation}\``)
  lines.push('')
  lines.push(`**Summary:** ${result.summary}`)
  lines.push('')

  if (result.concerns.length > 0) {
    lines.push('### Concerns')
    lines.push('')
    const shown = result.concerns.slice(0, MAX_CONCERNS_SHOWN)
    for (const c of shown) {
      const loc = c.line > 0 ? `${c.file}:${c.line}` : c.file
      lines.push(`- **[${c.severity}]** \`${loc}\` — ${c.message}`)
    }
    if (result.concerns.length > MAX_CONCERNS_SHOWN) {
      lines.push(
        `- _(+${result.concerns.length - MAX_CONCERNS_SHOWN} more)_`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function writeReviewStepSummary(
  result: ReviewResult,
  threshold: number,
  env: NodeJS.ProcessEnv = process.env,
  appendFileSync: (path: string, data: string) => void = nodeAppendFileSync,
): void {
  const target = env.GITHUB_STEP_SUMMARY
  if (!target || target.trim() === '') return
  appendFileSync(target, `${renderReviewStepSummary(result, threshold)}\n`)
}

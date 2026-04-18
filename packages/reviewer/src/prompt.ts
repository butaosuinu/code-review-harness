import type { DiffFile } from '@butaosuinu/harness-shared'

export const SYSTEM_PROMPT_TEMPLATE = `You are a code reviewer for an automated CI pipeline.
Your role is to evaluate whether the code changes in this PR are safe to auto-merge.

Evaluate the diff and respond ONLY with a JSON object (no markdown, no explanation):
{
  "score": <integer 0-100>,
  "summary": "<one sentence overall assessment>",
  "concerns": [
    {
      "file": "<filename>",
      "line": <line number or 0 if not applicable>,
      "severity": "low" | "medium" | "high",
      "message": "<specific actionable concern>"
    }
  ],
  "recommendation": "approve" | "request_changes"
}

Scoring guide:
- 90-100: Clean, well-tested, no concerns
- 75-89: Minor issues, safe to auto-merge
- 50-74: Notable concerns, human review recommended
- 0-49: Significant issues, do not auto-merge

Focus areas (from config):
{focus_areas}

Note: This diff has already passed static analysis (no schema changes, no auth changes, no secrets).`

export function buildSystemPrompt(focusAreas: readonly string[]): string {
  const bullets =
    focusAreas.length === 0
      ? '- (none specified)'
      : focusAreas.map((area) => `- ${area}`).join('\n')
  return SYSTEM_PROMPT_TEMPLATE.replace('{focus_areas}', bullets)
}

export function serializeDiff(files: readonly DiffFile[]): string {
  return files
    .map((file) => {
      const header = `=== ${file.filename} (${file.status}, +${file.additions}/-${file.deletions}) ===`
      const body = file.patch ?? '(no patch available)'
      return `${header}\n${body}`
    })
    .join('\n\n')
}

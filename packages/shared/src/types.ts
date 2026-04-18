export type RiskLevel = 'high' | 'low'

export interface ClassifyResult {
  riskLevel: RiskLevel
  matchedRules: MatchedRule[]
  summary: string
}

export interface MatchedRule {
  ruleId: string
  ruleType: 'file_pattern' | 'ast' | 'dependency' | 'diff_size'
  description: string
  matches: RuleMatch[]
}

export interface RuleMatch {
  file: string
  line?: number
  snippet?: string
}

export interface ReviewResult {
  score: number
  summary: string
  concerns: ReviewConcern[]
  recommendation: 'approve' | 'request_changes'
}

export interface ReviewConcern {
  file: string
  line: number
  severity: 'low' | 'medium' | 'high'
  message: string
}

export interface DiffFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  additions: number
  deletions: number
  patch?: string
  previousFilename?: string
}

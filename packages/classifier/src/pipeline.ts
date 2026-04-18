import type {
  ClassifyResult,
  DiffFile,
  HarnessConfig,
  MatchedRule,
} from '@butaosuinu/harness-shared'
import { evaluateAstRules } from './engines/ast.js'
import { evaluateDependencyAdditions } from './engines/dependency.js'
import { evaluateDiffSize } from './engines/diff-size.js'
import {
  allFilesMatchLowRisk,
  evaluateFilePatterns,
} from './engines/file-pattern.js'

export interface ClassifyInput {
  files: DiffFile[]
  config: HarnessConfig
  readFile: (filename: string) => Promise<string>
}

function summarize(rules: MatchedRule[]): string {
  if (rules.length === 0) return 'no high-risk signals detected'
  const first = rules[0]!
  const more = rules.length > 1 ? ` (+${rules.length - 1} more)` : ''
  return `${first.description}${more}`
}

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const { files, config, readFile } = input
  const risk = config.harness.risk_rules

  const filePatternMatches = evaluateFilePatterns(files, risk.high.file_patterns)
  if (filePatternMatches.length > 0) {
    return {
      riskLevel: 'high',
      matchedRules: filePatternMatches,
      summary: summarize(filePatternMatches),
    }
  }

  const astMatches = await evaluateAstRules({
    files,
    rules: risk.high.ast_rules,
    readFile,
  })
  if (astMatches.length > 0) {
    return {
      riskLevel: 'high',
      matchedRules: astMatches,
      summary: summarize(astMatches),
    }
  }

  const dependencyMatches = evaluateDependencyAdditions(
    files,
    risk.high.dependency_rules.added_packages,
  )
  if (dependencyMatches.length > 0) {
    return {
      riskLevel: 'high',
      matchedRules: dependencyMatches,
      summary: summarize(dependencyMatches),
    }
  }

  const diffSizeMatches = evaluateDiffSize(files, risk.high.diff_size)
  if (diffSizeMatches.length > 0) {
    return {
      riskLevel: 'high',
      matchedRules: diffSizeMatches,
      summary: summarize(diffSizeMatches),
    }
  }

  if (allFilesMatchLowRisk(files, risk.low.file_patterns)) {
    return {
      riskLevel: 'low',
      matchedRules: [],
      summary: 'all changes match low-risk patterns',
    }
  }

  return {
    riskLevel: 'low',
    matchedRules: [],
    summary: 'no high-risk signals detected',
  }
}

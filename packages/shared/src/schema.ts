import { z } from 'zod'

const AstRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  query: z.string(),
})

export type AstRule = z.infer<typeof AstRuleSchema>

const RiskRulesSchema = z.object({
  file_patterns: z.array(z.string()).default([]),
  ast_rules: z.array(AstRuleSchema).default([]),
  dependency_rules: z
    .object({
      added_packages: z.array(z.string()).default([]),
    })
    .default({}),
  diff_size: z
    .object({
      max_files: z.number().default(20),
      max_lines: z.number().default(500),
    })
    .default({}),
})

export const HarnessConfigSchema = z.object({
  harness: z.object({
    version: z.literal('1'),
    stack: z
      .object({
        databases: z
          .array(
            z.object({
              type: z.string(),
              orm: z.string().optional(),
              migration_paths: z.array(z.string()),
            }),
          )
          .default([]),
        auth: z
          .array(
            z.object({
              provider: z.string(),
              config_paths: z.array(z.string()),
            }),
          )
          .default([]),
        infrastructure: z
          .array(
            z.object({
              type: z.string(),
              paths: z.array(z.string()),
            }),
          )
          .default([]),
      })
      .default({}),
    risk_rules: z.object({
      high: RiskRulesSchema,
      low: z
        .object({
          file_patterns: z.array(z.string()).default([]),
        })
        .default({}),
    }),
    auto_merge: z
      .object({
        enabled: z.boolean().default(false),
        require_ci_pass: z.boolean().default(true),
        ai_score_threshold: z.number().min(0).max(100).default(75),
        strategy: z.enum(['squash', 'merge', 'rebase']).default('squash'),
        labels: z
          .object({
            high_risk: z.string().default('harness:high-risk'),
            low_risk: z.string().default('harness:low-risk'),
            auto_merged: z.string().default('harness:auto-merged'),
          })
          .default({}),
      })
      .default({}),
    ai_review: z
      .object({
        focus_areas: z
          .array(z.string())
          .default([
            'security vulnerabilities',
            'logic errors',
            'performance regressions',
            'breaking API changes',
          ]),
        max_diff_tokens: z.number().default(8000),
      })
      .default({}),
  }),
})

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>

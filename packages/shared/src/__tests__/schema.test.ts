import { describe, expect, it } from 'vitest'
import { HarnessConfigSchema } from '../schema.js'

describe('HarnessConfigSchema', () => {
  it('parses a minimal config with only required fields', () => {
    const input = {
      harness: {
        version: '1',
        risk_rules: {
          high: {},
          low: {},
        },
      },
    }

    const parsed = HarnessConfigSchema.parse(input)

    expect(parsed.harness.version).toBe('1')
    expect(parsed.harness.risk_rules.high.file_patterns).toEqual([])
    expect(parsed.harness.risk_rules.high.diff_size.max_files).toBe(20)
    expect(parsed.harness.risk_rules.high.diff_size.max_lines).toBe(500)
    expect(parsed.harness.auto_merge.enabled).toBe(false)
    expect(parsed.harness.auto_merge.ai_score_threshold).toBe(75)
    expect(parsed.harness.ai_review.max_diff_tokens).toBe(8000)
  })

  it('parses a full prisma-auth0 style config', () => {
    const input = {
      harness: {
        version: '1',
        stack: {
          databases: [
            {
              type: 'postgresql',
              orm: 'prisma',
              migration_paths: ['prisma/migrations/**', 'prisma/schema.prisma'],
            },
          ],
          auth: [
            {
              provider: 'auth0',
              config_paths: ['src/auth/**'],
            },
          ],
        },
        risk_rules: {
          high: {
            file_patterns: ['.env*', 'prisma/schema.prisma'],
            ast_rules: [
              {
                id: 'raw_sql_ddl',
                description: 'Raw SQL DDL statements',
                query: '(identifier) @x',
              },
            ],
            dependency_rules: {
              added_packages: ['prisma', '@prisma/client'],
            },
            diff_size: {
              max_files: 30,
              max_lines: 1000,
            },
          },
          low: {
            file_patterns: ['**/*.test.ts', '**/*.md'],
          },
        },
        auto_merge: {
          enabled: true,
          ai_score_threshold: 80,
          strategy: 'squash',
        },
      },
    }

    const parsed = HarnessConfigSchema.parse(input)

    expect(parsed.harness.stack.databases[0]?.orm).toBe('prisma')
    expect(parsed.harness.risk_rules.high.ast_rules[0]?.id).toBe('raw_sql_ddl')
    expect(parsed.harness.risk_rules.high.diff_size.max_files).toBe(30)
    expect(parsed.harness.auto_merge.enabled).toBe(true)
    expect(parsed.harness.auto_merge.ai_score_threshold).toBe(80)
  })

  it('rejects a config missing version', () => {
    const input = {
      harness: {
        risk_rules: { high: {}, low: {} },
      },
    }
    expect(() => HarnessConfigSchema.parse(input)).toThrow()
  })

  it('rejects an ai_score_threshold outside 0-100', () => {
    const input = {
      harness: {
        version: '1',
        risk_rules: { high: {}, low: {} },
        auto_merge: { ai_score_threshold: 150 },
      },
    }
    expect(() => HarnessConfigSchema.parse(input)).toThrow()
  })
})

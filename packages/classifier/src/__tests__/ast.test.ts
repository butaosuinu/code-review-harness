import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { DiffFile } from '@butaosuinu/harness-shared'
import { evaluateAstRules } from '../engines/ast.js'
import { fixturePath } from './helpers.js'

async function canLoadTreeSitter(): Promise<boolean> {
  try {
    await import('tree-sitter')
    await import('tree-sitter-typescript')
    return true
  } catch {
    return false
  }
}

describe('evaluateAstRules', () => {
  it('matches a raw SQL DROP TABLE via tree-sitter query', async () => {
    if (!(await canLoadTreeSitter())) {
      console.warn('tree-sitter native not available, skipping')
      return
    }

    const file: DiffFile = {
      filename: fixturePath('ast', 'raw-sql.ts'),
      status: 'modified',
      additions: 4,
      deletions: 0,
    }

    const rules = [
      {
        id: 'raw_sql_ddl',
        description: 'Raw SQL DDL statements in template literals',
        query: `
          (call_expression
            function: (identifier) @tag
            (#match? @tag "^(sql|db|query|prisma)$")
            arguments: (template_string) @content
            (#match? @content "(DROP|ALTER|CREATE|TRUNCATE)\\\\s+TABLE"))
        `,
      },
    ]

    const result = await evaluateAstRules({
      files: [file],
      rules,
      readFile: (p) => readFile(p, 'utf8'),
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0]?.ruleType).toBe('ast')
    expect(result[0]?.ruleId).toBe('ast:raw_sql_ddl')
  })

  it('skips invalid queries without crashing', async () => {
    if (!(await canLoadTreeSitter())) return

    const file: DiffFile = {
      filename: fixturePath('ast', 'raw-sql.ts'),
      status: 'modified',
      additions: 1,
      deletions: 0,
    }
    const rules = [
      {
        id: 'broken',
        description: 'broken query',
        query: '(((not valid s-expr',
      },
    ]
    const result = await evaluateAstRules({
      files: [file],
      rules,
      readFile: (p) => readFile(p, 'utf8'),
    })
    expect(result).toEqual([])
  })

  it('returns empty when rule list is empty', async () => {
    const result = await evaluateAstRules({
      files: [],
      rules: [],
      readFile: async () => '',
    })
    expect(result).toEqual([])
  })
})

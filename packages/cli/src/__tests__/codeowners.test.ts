import { describe, expect, it } from 'vitest'
import {
  collectReviewersForFiles,
  ownersForFile,
  ownersToReviewerGroups,
  parseCodeowners,
} from '../codeowners.js'

describe('parseCodeowners', () => {
  it('ignores blank lines and comments', () => {
    const rules = parseCodeowners(`
# top-level comment
*.js @frontend

# next rule
/infra/ @ops-team
    `)
    expect(rules.map((r) => r.pattern)).toEqual(['*.js', '/infra/'])
    expect(rules[0]!.owners).toEqual(['@frontend'])
    expect(rules[1]!.owners).toEqual(['@ops-team'])
  })

  it('strips inline comments', () => {
    const rules = parseCodeowners(`*.ts @ts-team # default owners`)
    expect(rules).toHaveLength(1)
    expect(rules[0]!.owners).toEqual(['@ts-team'])
  })

  it('supports multiple owners', () => {
    const rules = parseCodeowners(`prisma/** @org/db @alice`)
    expect(rules[0]!.owners).toEqual(['@org/db', '@alice'])
  })
})

describe('ownersForFile', () => {
  it('matches unanchored globs at any depth', () => {
    const rules = parseCodeowners(`*.md @docs`)
    expect(ownersForFile(rules, 'README.md')).toEqual(['@docs'])
    expect(ownersForFile(rules, 'packages/foo/CHANGES.md')).toEqual(['@docs'])
    expect(ownersForFile(rules, 'src/x.ts')).toEqual([])
  })

  it('matches anchored patterns from repo root only', () => {
    const rules = parseCodeowners(`/docs/*.md @docs`)
    expect(ownersForFile(rules, 'docs/readme.md')).toEqual(['@docs'])
    expect(ownersForFile(rules, 'apps/docs/readme.md')).toEqual([])
  })

  it('matches trailing-slash patterns against any file under that dir', () => {
    const rules = parseCodeowners(`/infra/ @ops`)
    expect(ownersForFile(rules, 'infra/terraform/main.tf')).toEqual(['@ops'])
    expect(ownersForFile(rules, 'infra/README.md')).toEqual(['@ops'])
  })

  it('matches ** to any depth', () => {
    const rules = parseCodeowners(`**/migrations/** @db`)
    expect(ownersForFile(rules, 'apps/api/migrations/001.sql')).toEqual(['@db'])
    expect(ownersForFile(rules, 'migrations/x.sql')).toEqual(['@db'])
  })

  it('last matching rule wins', () => {
    const rules = parseCodeowners(`
*.ts @global
packages/cli/** @cli-team
    `)
    expect(ownersForFile(rules, 'packages/cli/src/index.ts')).toEqual([
      '@cli-team',
    ])
    expect(ownersForFile(rules, 'packages/shared/src/index.ts')).toEqual([
      '@global',
    ])
  })
})

describe('ownersToReviewerGroups', () => {
  it('separates users, teams, and discards emails', () => {
    const groups = ownersToReviewerGroups([
      '@alice',
      '@bob',
      '@my-org/frontend',
      '@my-org/backend',
      'someone@example.com',
      '@alice',
    ])
    expect(groups.users.sort()).toEqual(['alice', 'bob'])
    expect(groups.teams.sort()).toEqual(['backend', 'frontend'])
  })
})

describe('collectReviewersForFiles', () => {
  it('unions owners across all changed files', () => {
    const rules = parseCodeowners(`
*.ts @ts-team
prisma/** @org/db
    `)
    const groups = collectReviewersForFiles(rules, [
      'src/a.ts',
      'prisma/schema.prisma',
    ])
    expect(groups.users).toEqual(['ts-team'])
    expect(groups.teams).toEqual(['db'])
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CodeownersRule {
  pattern: string
  regex: RegExp
  owners: string[]
}

const CANDIDATE_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']

export function findCodeownersFile(cwd: string): string | null {
  for (const rel of CANDIDATE_PATHS) {
    const p = join(cwd, rel)
    if (existsSync(p)) return p
  }
  return null
}

export function loadCodeowners(cwd: string): CodeownersRule[] {
  const path = findCodeownersFile(cwd)
  if (!path) return []
  return parseCodeowners(readFileSync(path, 'utf8'))
}

export function parseCodeowners(contents: string): CodeownersRule[] {
  const rules: CodeownersRule[] = []
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim()
    if (line === '') continue
    const tokens = line.split(/\s+/)
    const pattern = tokens[0]
    if (!pattern) continue
    const owners = tokens.slice(1).filter((t) => t !== '')
    rules.push({ pattern, regex: patternToRegex(pattern), owners })
  }
  return rules
}

export function ownersForFile(
  rules: CodeownersRule[],
  filename: string,
): string[] {
  const normalized = filename.replace(/^\.\//, '').replace(/^\//, '')
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!
    if (rule.regex.test(normalized)) return rule.owners
  }
  return []
}

export interface ReviewerGroups {
  users: string[]
  teams: string[]
}

export function ownersToReviewerGroups(owners: string[]): ReviewerGroups {
  const users = new Set<string>()
  const teams = new Set<string>()
  for (const owner of owners) {
    if (!owner.startsWith('@')) continue
    const body = owner.slice(1)
    if (body.includes('/')) {
      const [, team] = body.split('/', 2)
      if (team) teams.add(team)
    } else if (body !== '') {
      users.add(body)
    }
  }
  return { users: [...users], teams: [...teams] }
}

export function collectReviewersForFiles(
  rules: CodeownersRule[],
  filenames: string[],
): ReviewerGroups {
  const owners = new Set<string>()
  for (const f of filenames) {
    for (const o of ownersForFile(rules, f)) owners.add(o)
  }
  return ownersToReviewerGroups([...owners])
}

function stripComment(line: string): string {
  const idx = line.indexOf('#')
  return idx === -1 ? line : line.slice(0, idx)
}

const TOKEN_GSTAR_SLASH = '\x01'
const TOKEN_SLASH_GSTAR = '\x02'
const TOKEN_GSTAR = '\x03'
const TOKEN_STAR = '\x04'
const TOKEN_QMARK = '\x05'

function patternToRegex(pattern: string): RegExp {
  let p = pattern
  const anchored = p.startsWith('/')
  if (anchored) p = p.slice(1)
  if (p.endsWith('/')) p = `${p}**`

  p = p
    .replace(/\*\*\//g, TOKEN_GSTAR_SLASH)
    .replace(/\/\*\*/g, TOKEN_SLASH_GSTAR)
    .replace(/\*\*/g, TOKEN_GSTAR)
    .replace(/\*/g, TOKEN_STAR)
    .replace(/\?/g, TOKEN_QMARK)
    .replace(/[.+^$()|{}[\]\\]/g, '\\$&')
    .replaceAll(TOKEN_GSTAR_SLASH, '(?:.*\\/)?')
    .replaceAll(TOKEN_SLASH_GSTAR, '(?:\\/.*)?')
    .replaceAll(TOKEN_GSTAR, '.*')
    .replaceAll(TOKEN_STAR, '[^/]*')
    .replaceAll(TOKEN_QMARK, '[^/]')

  return new RegExp(anchored ? `^${p}$` : `(?:^|/)${p}$`)
}

import type {
  AstRule,
  DiffFile,
  MatchedRule,
  RuleMatch,
} from '@butaosuinu/harness-shared'

type ParserCtor = new () => ParserInstance
interface ParserInstance {
  setLanguage(lang: unknown): void
  parse(source: string): { rootNode: unknown }
}
interface QueryCtor {
  new (language: unknown, source: string): QueryInstance
}
interface QueryInstance {
  captures(node: unknown): Array<{
    name: string
    node: {
      text: string
      startPosition: { row: number }
    }
  }>
}

type Loader = () => Promise<{
  Parser: ParserCtor
  Query: QueryCtor
  language: unknown
}>

const EXTENSION_TO_LOADER: Record<string, Loader> = {
  '.ts': () => loadTsLangauge('typescript'),
  '.tsx': () => loadTsLangauge('tsx'),
  '.js': () => loadTsLangauge('tsx'),
  '.jsx': () => loadTsLangauge('tsx'),
  '.mjs': () => loadTsLangauge('tsx'),
  '.cjs': () => loadTsLangauge('tsx'),
  '.py': () => loadSingleLanguage('tree-sitter-python'),
  '.go': () => loadSingleLanguage('tree-sitter-go'),
  '.rb': () => loadSingleLanguage('tree-sitter-ruby'),
}

async function loadTreeSitter(): Promise<{
  Parser: ParserCtor
  Query: QueryCtor
} | null> {
  try {
    const mod = (await import('tree-sitter')) as unknown as
      | ParserCtor
      | { default: ParserCtor }
    const Parser: ParserCtor = typeof mod === 'function' ? mod : mod.default
    const Query = (Parser as unknown as { Query: QueryCtor }).Query
    return { Parser, Query }
  } catch {
    return null
  }
}

function unwrapDefault<T>(mod: unknown): T {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: T }).default
  }
  return mod as T
}

async function loadTsLangauge(which: 'typescript' | 'tsx') {
  const ts = await loadTreeSitter()
  if (!ts) throw new Error('tree-sitter native binding unavailable')
  const raw = await import('tree-sitter-typescript')
  const mod = unwrapDefault<{ typescript: unknown; tsx: unknown }>(raw)
  return { Parser: ts.Parser, Query: ts.Query, language: mod[which] }
}

async function loadSingleLanguage(pkg: string) {
  const ts = await loadTreeSitter()
  if (!ts) throw new Error('tree-sitter native binding unavailable')
  const raw = await import(pkg)
  const language = unwrapDefault<unknown>(raw)
  return { Parser: ts.Parser, Query: ts.Query, language }
}

function extensionOf(filename: string): string | undefined {
  const idx = filename.lastIndexOf('.')
  if (idx < 0) return undefined
  return filename.slice(idx)
}

export interface AstRuleEvaluationInput {
  files: DiffFile[]
  rules: AstRule[]
  readFile: (filename: string) => Promise<string>
}

export async function evaluateAstRules({
  files,
  rules,
  readFile,
}: AstRuleEvaluationInput): Promise<MatchedRule[]> {
  if (rules.length === 0) return []

  const cache = new Map<
    string,
    { Parser: ParserCtor; Query: QueryCtor; language: unknown } | null
  >()

  async function getLanguageFor(ext: string) {
    if (cache.has(ext)) return cache.get(ext) ?? null
    const loader = EXTENSION_TO_LOADER[ext]
    if (!loader) {
      cache.set(ext, null)
      return null
    }
    try {
      const mod = await loader()
      cache.set(ext, mod)
      return mod
    } catch (err) {
      console.warn(
        `[classifier] failed to load tree-sitter parser for ${ext}: ${(err as Error).message}`,
      )
      cache.set(ext, null)
      return null
    }
  }

  const matchesByRule = new Map<
    string,
    { description: string; matches: RuleMatch[] }
  >()

  for (const file of files) {
    if (file.status === 'removed') continue
    const ext = extensionOf(file.filename)
    if (!ext) continue
    const langMod = await getLanguageFor(ext)
    if (!langMod) continue

    let source: string
    try {
      source = await readFile(file.filename)
    } catch {
      continue
    }

    const parser = new langMod.Parser()
    parser.setLanguage(langMod.language)
    const tree = parser.parse(source)

    for (const rule of rules) {
      let query: QueryInstance
      try {
        query = new langMod.Query(langMod.language, rule.query)
      } catch (err) {
        console.warn(
          `[classifier] ast rule "${rule.id}" skipped for ${file.filename}: ${(err as Error).message}`,
        )
        continue
      }

      let captures
      try {
        captures = query.captures(tree.rootNode)
      } catch (err) {
        console.warn(
          `[classifier] ast rule "${rule.id}" capture failed for ${file.filename}: ${(err as Error).message}`,
        )
        continue
      }

      if (captures.length === 0) continue

      const entry = matchesByRule.get(rule.id) ?? {
        description: rule.description,
        matches: [],
      }
      for (const cap of captures) {
        entry.matches.push({
          file: file.filename,
          line: cap.node.startPosition.row + 1,
          snippet: cap.node.text.slice(0, 120),
        })
      }
      matchesByRule.set(rule.id, entry)
    }
  }

  const out: MatchedRule[] = []
  for (const [ruleId, { description, matches }] of matchesByRule) {
    out.push({
      ruleId: `ast:${ruleId}`,
      ruleType: 'ast',
      description,
      matches,
    })
  }
  return out
}

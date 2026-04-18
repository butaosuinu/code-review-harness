import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function findTemplatesDir(): string {
  // dist/index.js からは ../../../templates
  // src から実行する (vitest 等) 場合は ../../../templates
  const candidates = [
    resolve(here, '..', '..', '..', 'templates'),
    resolve(here, '..', '..', 'templates'),
    resolve(here, '..', 'templates'),
  ]
  for (const c of candidates) {
    try {
      readFileSync(join(c, 'configs', 'base.yml'), 'utf8')
      return c
    } catch {
      continue
    }
  }
  throw new Error(
    `templates directory not found. searched: ${candidates.join(', ')}`,
  )
}

export const templatesDir = findTemplatesDir()

export function loadConfigTemplate(name: string): string {
  const path = join(templatesDir, 'configs', `${name}.yml`)
  return readFileSync(path, 'utf8')
}

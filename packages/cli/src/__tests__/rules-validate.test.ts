import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { registerRulesCommand } from '../commands/rules.js'

function runRules(args: string[]) {
  const program = new Command()
  program.exitOverride()
  registerRulesCommand(program)
  return program.parseAsync(args, { from: 'user' })
}

let tmpDir: string
let exitSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'harness-rules-'))
  mkdirSync(join(tmpDir, '.harness'), { recursive: true })
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
})

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
  exitSpy.mockRestore()
})

describe('harness rules validate', () => {
  it('accepts a valid config', async () => {
    const path = join(tmpDir, '.harness', 'config.yml')
    writeFileSync(
      path,
      `
harness:
  version: "1"
  risk_rules:
    high: {}
    low: {}
`,
      'utf8',
    )
    await expect(runRules(['rules', 'validate', '--config', path])).resolves.toBeDefined()
  })

  it('rejects a config missing version', async () => {
    const path = join(tmpDir, '.harness', 'config.yml')
    writeFileSync(
      path,
      `
harness:
  risk_rules:
    high: {}
    low: {}
`,
      'utf8',
    )
    await expect(runRules(['rules', 'validate', '--config', path])).rejects.toThrow(
      /process\.exit\(1\)/,
    )
  })
})

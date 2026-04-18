import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Command } from 'commander'
import jsYaml from 'js-yaml'
import { ZodError } from 'zod'
import {
  HarnessConfigSchema,
  type DiffFile,
} from '@butaosuinu/harness-shared'
import { classify } from '@butaosuinu/harness-classifier'

function formatZodError(e: ZodError): string {
  return e.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
}

export function registerRulesCommand(program: Command): void {
  const rules = program.command('rules').description('ルール関連のユーティリティ')

  rules
    .command('validate')
    .description('.harness/config.yml をスキーマで検証する')
    .option('--config <path>', 'config.yml のパス', '.harness/config.yml')
    .action(async (opts: { config: string }) => {
      const path = resolve(opts.config)
      let raw: string
      try {
        raw = readFileSync(path, 'utf8')
      } catch {
        console.error(`config.yml が見つかりません: ${path}`)
        process.exit(1)
      }
      try {
        HarnessConfigSchema.parse(jsYaml.load(raw))
        console.log(`✓ ${path} is valid`)
      } catch (e) {
        if (e instanceof ZodError) {
          console.error('バリデーション失敗:')
          console.error(formatZodError(e))
        } else {
          console.error(`パースに失敗: ${(e as Error).message}`)
        }
        process.exit(1)
      }
    })

  rules
    .command('test <file>')
    .description('指定ファイルを全ルールで評価する (手元のファイル内容を modified として扱う)')
    .option('--config <path>', 'config.yml のパス', '.harness/config.yml')
    .action(async (file: string, opts: { config: string }) => {
      const configPath = resolve(opts.config)
      const filePath = resolve(file)

      let rawConfig: string
      try {
        rawConfig = readFileSync(configPath, 'utf8')
      } catch {
        console.error(`config.yml が見つかりません: ${configPath}`)
        process.exit(1)
      }

      let config
      try {
        config = HarnessConfigSchema.parse(jsYaml.load(rawConfig))
      } catch (e) {
        if (e instanceof ZodError) {
          console.error(formatZodError(e))
        } else {
          console.error(`config.yml のパースに失敗: ${(e as Error).message}`)
        }
        process.exit(1)
      }

      const content = readFileSync(filePath, 'utf8')
      const lineCount = content.split('\n').length
      const dummy: DiffFile = {
        filename: file,
        status: 'modified',
        additions: lineCount,
        deletions: 0,
        patch: content
          .split('\n')
          .map((l) => `+${l}`)
          .join('\n'),
      }

      const result = await classify({
        files: [dummy],
        config,
        readFile: async () => content,
      })

      console.log(`File: ${basename(file)}`)
      console.log(`Risk level: ${result.riskLevel.toUpperCase()}`)
      console.log(`Summary: ${result.summary}`)
      if (result.matchedRules.length > 0) {
        console.log('Matched rules:')
        for (const rule of result.matchedRules) {
          console.log(`  [${rule.ruleType}] ${rule.ruleId}: ${rule.description}`)
        }
      } else {
        console.log('マッチしたルールはありません。')
      }
    })
}

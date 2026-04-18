import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Command } from 'commander'
import inquirer from 'inquirer'
import jsYaml from 'js-yaml'
import { loadConfigTemplate } from '../templates.js'

interface InitAnswers {
  databases: string[]
  orm: string
  auth: string[]
  infrastructure: string[]
  primaryLanguage: string
  autoMergeEnabled: boolean
  aiScoreThreshold: number
  maxFiles: number
  maxLines: number
  overwrite?: boolean
}

function pickTemplate(a: InitAnswers): string {
  const hasPrisma = a.orm === 'Prisma'
  const hasAuth0 = a.auth.includes('Auth0')
  const hasDrizzle = a.orm === 'Drizzle'
  const hasSupabase = a.auth.includes('Supabase Auth')
  const hasTypeorm = a.orm === 'TypeORM'
  const hasNextAuth = a.auth.includes('NextAuth')

  if (hasPrisma && hasAuth0) return 'prisma-auth0'
  if (hasDrizzle && hasSupabase) return 'drizzle-supabase'
  if (hasTypeorm && hasNextAuth) return 'typeorm-nextauth'
  if (hasPrisma) return 'prisma-auth0'
  if (hasDrizzle) return 'drizzle-supabase'
  if (hasTypeorm) return 'typeorm-nextauth'
  return 'base'
}

function applyAnswers(
  config: Record<string, unknown>,
  answers: InitAnswers,
): Record<string, unknown> {
  const harness = config.harness as Record<string, unknown> | undefined
  if (!harness) return config

  const autoMerge = (harness.auto_merge as Record<string, unknown> | undefined) ?? {}
  autoMerge.enabled = answers.autoMergeEnabled
  if (answers.autoMergeEnabled) {
    autoMerge.ai_score_threshold = answers.aiScoreThreshold
  }
  harness.auto_merge = autoMerge

  const risk = harness.risk_rules as Record<string, unknown> | undefined
  if (risk) {
    const high = (risk.high as Record<string, unknown> | undefined) ?? {}
    high.diff_size = {
      max_files: answers.maxFiles,
      max_lines: answers.maxLines,
    }
    risk.high = high
    harness.risk_rules = risk
  }

  return config
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('.harness/config.yml を対話形式で生成する')
    .option('-y, --yes', 'プロンプトを省略して base.yml テンプレートをそのまま書き出す')
    .option('--cwd <path>', '作業ディレクトリを指定する', process.cwd())
    .action(async (opts: { yes?: boolean; cwd: string }) => {
      const cwd = opts.cwd
      const configPath = join(cwd, '.harness', 'config.yml')

      let answers: InitAnswers
      if (opts.yes) {
        answers = {
          databases: [],
          orm: 'なし',
          auth: [],
          infrastructure: [],
          primaryLanguage: 'TypeScript',
          autoMergeEnabled: false,
          aiScoreThreshold: 75,
          maxFiles: 20,
          maxLines: 500,
        }
      } else {
        answers = await inquirer.prompt<InitAnswers>([
          {
            type: 'checkbox',
            name: 'databases',
            message: 'DB 種別 (複数選択可)',
            choices: [
              'PostgreSQL',
              'MySQL',
              'SQLite',
              'MongoDB',
              'Redis',
              'その他',
            ],
          },
          {
            type: 'list',
            name: 'orm',
            message: 'ORM',
            choices: ['Prisma', 'Drizzle', 'TypeORM', 'Sequelize', 'なし'],
            default: 'なし',
          },
          {
            type: 'checkbox',
            name: 'auth',
            message: '認証基盤 (複数選択可)',
            choices: [
              'Auth0',
              'Supabase Auth',
              'NextAuth',
              'Clerk',
              'Firebase Auth',
            ],
          },
          {
            type: 'checkbox',
            name: 'infrastructure',
            message: 'インフラ管理 (複数選択可)',
            choices: ['Terraform', 'Pulumi', 'CDK', 'Kubernetes/Helm'],
          },
          {
            type: 'list',
            name: 'primaryLanguage',
            message: '主要言語',
            choices: ['TypeScript', 'JavaScript', 'Python', 'Go', 'Ruby'],
            default: 'TypeScript',
          },
          {
            type: 'confirm',
            name: 'autoMergeEnabled',
            message: 'AI auto-merge を有効にしますか?',
            default: false,
          },
          {
            type: 'number',
            name: 'aiScoreThreshold',
            message: 'AI スコア閾値 (auto-merge 有効時のみ)',
            default: 75,
            when: (a) => Boolean(a.autoMergeEnabled),
          },
          {
            type: 'number',
            name: 'maxFiles',
            message: 'diff 上限 (ファイル数)',
            default: 20,
          },
          {
            type: 'number',
            name: 'maxLines',
            message: 'diff 上限 (行数)',
            default: 500,
          },
        ])
      }

      if (existsSync(configPath) && !opts.yes) {
        const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
          {
            type: 'confirm',
            name: 'overwrite',
            message: `${configPath} が既に存在します。上書きしますか?`,
            default: false,
          },
        ])
        if (!overwrite) {
          console.log('中断しました。既存の config.yml は変更していません。')
          return
        }
      }

      const templateName = pickTemplate(answers)
      const templateYaml = loadConfigTemplate(templateName)
      const parsed = jsYaml.load(templateYaml) as Record<string, unknown>
      const finalConfig = applyAnswers(parsed, answers)
      const out = jsYaml.dump(finalConfig, { lineWidth: 120, noRefs: true })

      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, out, 'utf8')

      console.log(`✓ ${configPath} を生成しました (テンプレート: ${templateName})`)
      console.log('')
      console.log('次のステップ:')
      console.log('  1. .harness/config.yml を確認して必要なら編集する')
      console.log('  2. harness rules validate で設定を検証する')
      console.log('  3. harness classify --base-sha HEAD~1 --head-sha HEAD で分類をテストする')
    })
}

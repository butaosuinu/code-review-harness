import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerClassifyCommand } from './commands/classify.js'
import { registerReviewCommand } from './commands/review.js'
import { registerRulesCommand } from './commands/rules.js'

const program = new Command()

program
  .name('harness')
  .description('PR リスクを静的解析 + AI で分類するハーネスの CLI')
  .version('0.1.0')

registerInitCommand(program)
registerClassifyCommand(program)
registerReviewCommand(program)
registerRulesCommand(program)

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(2)
})

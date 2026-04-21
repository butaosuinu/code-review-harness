import Anthropic from '@anthropic-ai/sdk'
import type {
  DiffFile,
  HarnessConfig,
  ReviewConcern,
  ReviewResult,
} from '@butaosuinu/harness-shared'

import { MissingApiKeyError } from './errors.js'
import { buildSystemPrompt, serializeDiff } from './prompt.js'

export { MissingApiKeyError } from './errors.js'
export {
  SYSTEM_PROMPT_TEMPLATE,
  buildSystemPrompt,
  serializeDiff,
} from './prompt.js'
export {
  AI_REVIEW_COMMENT_MARKER,
  computePosition,
  defaultOctokitFactory,
  postReview,
  toReviewComments,
} from './github.js'
export type {
  InlineComment,
  MappedComments,
  OctokitFactory,
  OctokitLike,
  PostReviewInput,
  PullRequestContext,
  ReviewEvent,
} from './github.js'

export const DEFAULT_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048
const RETRY_CORRECTION =
  'Your previous response was not valid JSON. Respond ONLY with a JSON object matching the schema, no prose, no markdown fences.'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

export interface ReviewInput {
  diff: readonly DiffFile[]
  config: HarnessConfig
  apiKey: string
  model?: string
}

export async function review(input: ReviewInput): Promise<ReviewResult> {
  if (!input.apiKey || input.apiKey.trim() === '') {
    throw new MissingApiKeyError()
  }

  const client = new Anthropic({ apiKey: input.apiKey })
  const model = input.model ?? DEFAULT_MODEL
  const system = buildSystemPrompt(input.config.harness.ai_review.focus_areas)
  const userContent = serializeDiff(input.diff)

  const firstMessages: Message[] = [{ role: 'user', content: userContent }]
  const firstText = await callModel(client, model, system, firstMessages)
  const firstParsed = tryParseReview(firstText)
  if (firstParsed) return firstParsed

  const retryMessages: Message[] = [
    ...firstMessages,
    { role: 'assistant', content: firstText },
    { role: 'user', content: RETRY_CORRECTION },
  ]
  const secondText = await callModel(client, model, system, retryMessages)
  const secondParsed = tryParseReview(secondText)
  if (secondParsed) return secondParsed

  return {
    score: 0,
    summary:
      'AI review returned invalid JSON after one retry; defaulting to request_changes.',
    concerns: [],
    recommendation: 'request_changes',
  }
}

async function callModel(
  client: Anthropic,
  model: string,
  system: string,
  messages: Message[],
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    system,
    messages,
  })
  for (const block of response.content) {
    if (block.type === 'text') return block.text
  }
  return ''
}

function tryParseReview(raw: string): ReviewResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const { score, summary, concerns, recommendation } = parsed
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (typeof summary !== 'string') return null
  if (recommendation !== 'approve' && recommendation !== 'request_changes') {
    return null
  }
  if (!Array.isArray(concerns)) return null

  const validated: ReviewConcern[] = []
  for (const c of concerns) {
    if (!isRecord(c)) return null
    if (typeof c.file !== 'string') return null
    if (typeof c.line !== 'number') return null
    if (c.severity !== 'low' && c.severity !== 'medium' && c.severity !== 'high') {
      return null
    }
    if (typeof c.message !== 'string') return null
    validated.push({
      file: c.file,
      line: c.line,
      severity: c.severity,
      message: c.message,
    })
  }

  return { score, summary, concerns: validated, recommendation }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

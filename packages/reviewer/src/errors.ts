export class MissingApiKeyError extends Error {
  constructor(message = 'ANTHROPIC_API_KEY is required for AI review') {
    super(message)
    this.name = 'MissingApiKeyError'
  }
}

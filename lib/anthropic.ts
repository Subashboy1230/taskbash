// Anthropic client. Used by the Granola extractor to parse meeting
// summaries into structured action items.

import Anthropic from '@anthropic-ai/sdk'

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('Missing env: ANTHROPIC_API_KEY')
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export const MODELS = {
  // Cheap classifier model — Haiku. Used for tagging email/Slack later.
  classifier: 'claude-haiku-4-5-20251001',
  // Synthesis model — Opus 4.7. Used for briefs and meeting prep.
  synthesis: 'claude-opus-4-7',
} as const

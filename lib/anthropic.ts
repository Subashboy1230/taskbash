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
  // Cheap classifier model — Haiku. NOT currently used in the pipeline;
  // every LLM call was migrated to Opus 4.7 for maximum quality. Kept as
  // an escape hatch if we ever want to route a high-volume path through
  // a cheaper model again (e.g. bulk backfills).
  classifier: 'claude-haiku-4-5-20251001',
  // Judge / primary model — Opus 4.7. Used for EVERY LLM call in the
  // pipeline today: extractors (Gmail/Granola), judge, function classifier,
  // task details, draft reply/followup, voice analysis, freeform text
  // extraction. Max reasoning quality across the board since the whole
  // surface is what the user reads.
  judge: 'claude-opus-4-7',
  // Synthesis model — Opus 4.7. Alias for briefs + meeting prep.
  synthesis: 'claude-opus-4-7',
} as const

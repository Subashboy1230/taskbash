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
  // Cheap classifier model — Haiku. Used for the initial extraction pass
  // on email/Granola/calendar. Optimized for throughput + cost, not for
  // adversarial judgment.
  classifier: 'claude-haiku-4-5-20251001',
  // Judge model — Opus 4.7. Second-pass adversarial reviewer over every
  // extractor output: decides keep / drop / merge / demote-to-subtask and
  // fixes tag / priority / draft_confidence. Max-out on reasoning quality
  // since judge accuracy directly gates every task the user sees.
  judge: 'claude-opus-4-7',
  // Synthesis model — Opus 4.7. Used for briefs and meeting prep.
  synthesis: 'claude-opus-4-7',
} as const

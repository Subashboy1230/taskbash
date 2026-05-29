// Dispatch table: given a prompt_id + structured input_content, call
// the right extractor/drafter with the CURRENT prompt in the codebase.
//
// This is what makes Phase B2 evals actually test prompt changes: the
// eval runner calls into the live extractor module, which uses today's
// prompt template — not the one baked into the saved request_payload.

import type Anthropic from '@anthropic-ai/sdk'

export interface ReplayResult {
  // Concatenated text of every text-block in the response. The eval
  // runner compares this against expected_output.
  responseText: string
  // The model that handled the call (so the runner can record it).
  model: string
}

// Per-prompt-id replay function. Each one knows how to:
//   1. Validate / unmarshal its input_content shape
//   2. Build the current prompt + send to Claude
//   3. Return the concatenated response text
export type ReplayFn = (input: unknown, anthropic: Anthropic) => Promise<ReplayResult>

// Dispatch table — kept in this module so the runner can list which
// prompt_ids support current-prompt replay vs. need request_payload
// fallback.
//
// Resolved at call time (lazy require) so circular-import / build-time
// concerns from extractor modules don't bite the eval CLI.
export async function replayByPromptId(
  promptId: string,
  input: unknown,
  anthropic: Anthropic
): Promise<ReplayResult | null> {
  switch (promptId) {
    case 'extract.gmail': {
      const { replayGmailExtraction } = await import('../extract/gmail')
      return replayGmailExtraction(input, anthropic)
    }
    case 'extract.granola': {
      const { replayGranolaExtraction } = await import('../extract/granola')
      return replayGranolaExtraction(input, anthropic)
    }
    case 'extract.calendar': {
      const { replayCalendarBrief } = await import('../extract/calendar')
      return replayCalendarBrief(input, anthropic)
    }
    case 'classify.functions': {
      const { replayClassifyFunctions } = await import('../classify/functions')
      return replayClassifyFunctions(input, anthropic)
    }
    // brief.synthesize, draft.reply, draft.followup — not yet wired
    // for current-prompt replay. Runner falls back to request_payload.
    default:
      return null
  }
}

export const SUPPORTED_REPLAY_PROMPTS: readonly string[] = [
  'extract.gmail',
  'extract.granola',
  'extract.calendar',
  'classify.functions',
] as const

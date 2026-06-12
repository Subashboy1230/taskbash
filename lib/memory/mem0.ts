// mem0 client singleton.
//
// mem0 (mem0.ai) is a hosted long-term memory layer for AI agents.
// Stores user-level facts and preferences extracted from interactions,
// and lets us search them by semantic relevance at prompt time. We use
// it to close the feedback -> LLM-prompt loop: when the user clicks
// slop or corrects a function tag, that signal becomes a durable
// memory that biases future extractions and classifications.
//
// Gated by env MEM0_API_KEY. Everything degrades to no-op when absent,
// so the rest of the digest keeps running.

import MemoryClient from 'mem0ai'

let _client: MemoryClient | null = null

export function mem0Configured(): boolean {
  return Boolean(process.env.MEM0_API_KEY)
}

export function getMem0Client(): MemoryClient {
  if (_client) return _client
  const apiKey = sanitizeApiKey(process.env.MEM0_API_KEY)
  if (!apiKey) {
    throw new Error('MEM0_API_KEY missing. Set it in .env.local to enable mem0.')
  }
  _client = new MemoryClient({ apiKey })
  return _client
}

/**
 * Strip invisible Unicode characters (zero-width space, BOM, ZWNJ,
 * ZWJ) and surrounding whitespace from an API key. These sneak in
 * when keys get copy-pasted from emails or rendered HTML.
 * mem0's underlying fetch wrapper rejects keys with codepoints > 255
 * with a ByteString conversion error, so we defensively scrub here.
 */
function sanitizeApiKey(raw: string | undefined): string | undefined {
  if (!raw) return raw
  return raw
    .replace(/[​-‍﻿]/g, '')
    .trim()
}

/** Default cap on the number of memories injected into any prompt. */
export const MEM0_TOP_K = 5

/** User-scoped mem0 user_id for the configured taskbash user. */
export function mem0UserIdFor(userId: string | null | undefined): string {
  return userId && userId.trim().length > 0 ? `tb-${userId}` : 'tb-default'
}

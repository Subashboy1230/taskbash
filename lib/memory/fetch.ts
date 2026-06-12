// Fetch relevant mem0 memories at LLM-prompt build time.
//
// Called from inside classifiers and extractors, just before the LLM
// call, with a short string describing what's about to be classified.
// mem0 returns its top-k most semantically relevant memories for that
// user, which we slot into the system prompt as a "User preferences"
// block.
//
// Returns [] on any failure or when mem0 is unconfigured — every
// caller treats it as best-effort context, never required input.

import { getMem0Client, mem0Configured, mem0UserIdFor, MEM0_TOP_K } from './mem0'

export interface RelevantMemory {
  id: string
  memory: string
  score: number
  categories?: string[]
  created_at?: string
}

/**
 * Search the user's mem0 store for memories relevant to `query`. Always
 * returns at most `limit` results, sorted by score descending. Filters
 * to the configured user. Best-effort: returns [] on any error so the
 * caller doesn't have to wrap.
 */
export async function fetchRelevantMemories(args: {
  userId: string | null | undefined
  query: string
  limit?: number
}): Promise<RelevantMemory[]> {
  if (!mem0Configured()) return []
  if (!args.query?.trim()) return []
  const limit = args.limit ?? MEM0_TOP_K
  try {
    const client = getMem0Client()
    const res = await client.search(args.query.slice(0, 800), {
      filters: { user_id: mem0UserIdFor(args.userId) },
      limit,
    } as Parameters<typeof client.search>[1])
    const list = Array.isArray(res) ? res : (res as { results?: unknown[] }).results ?? []
    return (list as Array<Record<string, unknown>>)
      .map(r => ({
        id: String(r.id ?? ''),
        memory: String(r.memory ?? ''),
        score: typeof r.score === 'number' ? r.score : 0,
        categories: Array.isArray(r.categories) ? (r.categories as string[]) : undefined,
        created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
      }))
      .filter(m => m.memory.length > 0)
  } catch (err) {
    console.error('[mem0.fetch] search failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Render a mem0 result list into a system-prompt block. Returns empty
 * string if the input list is empty so the prompt template can do
 * `prompt + render(...)` without an extra null check.
 */
export function renderMemoriesForPrompt(memories: RelevantMemory[]): string {
  if (memories.length === 0) return ''
  const lines = memories.map(m => `  - ${m.memory}`).join('\n')
  return [
    '',
    'USER PREFERENCES (from mem0 long-term memory):',
    'Treat these as soft constraints on classification. Honor them unless the',
    'task content clearly contradicts them.',
    lines,
    '',
  ].join('\n')
}

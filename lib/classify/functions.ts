// Auto-tag user functions onto extracted items.
//
// Why a separate classifier (not modified extractor prompts):
//   - One small focused prompt, easy to iterate
//   - Source-agnostic — works for Gmail, Granola, Calendar, Linear,
//     even Manual (Linear uses no LLM today; the classifier still works)
//   - Can be turned off without touching extraction prompts
//   - Batched: one LLM call classifies N items at once → near-zero cost
//
// Runs after extraction, before insert. Input: ExtractedItem[] +
// UserFunction[]. Output: a Map<itemKey, string[]> of function ids.
// The digest loop merges these back onto the items before writing.

import { anthropic, MODELS } from '../anthropic'
import { tracedMessage } from '../llm-trace'
import { nebiusTracedMessage } from '../nebius-trace'
import { extractJsonObject } from '../extract/parse'
import { fetchRelevantMemories, renderMemoriesForPrompt } from '../memory/fetch'
import type { ExtractedItem, UserFunction } from '../types'

// Provider for this classifier. Default Anthropic. Set CLASSIFY_PROVIDER=nebius
// in .env.local to route through Nebius Token Factory (Meta Llama 3.1 70B).
// Why a flag: keeps a one-line rollback path if Nebius quality regresses
// on a specific user batch. /observability shows system='nebius' so you
// can compare slop rate per provider over time.
const USE_NEBIUS =
  (process.env.CLASSIFY_PROVIDER || '').toLowerCase() === 'nebius'

// Key for tying input items to output rows. We don't have item ids yet
// at classify time (insert happens after), so we use a synthetic
// per-batch index: 't0', 't1', etc.
type ClassifyKey = string

interface ClassifyInput {
  key: ClassifyKey
  title: string
  context: string  // parent_context or source excerpt — whatever helps disambiguate
  source: string
}

const SYSTEM_PROMPT = `You assign FUNCTION TAGS to a user's tasks.

A "function" is a high-level work area the user organizes their day around,
e.g. "Product Management", "Hiring", "People Ops". The user has defined
their own set of functions. Your job: for each task, decide which
function(s) it belongs to.

RULES
- EVERY task MUST be assigned AT LEAST ONE function. Never return an empty
  list for any task. Every task belongs to some area of the user's work — if
  no function is an obvious fit, pick the SINGLE closest one. An uncategorized
  task is the worst outcome: it disappears from every function view.
- Read the task title + context. Tag it with EVERY function that plausibly
  applies, primary AND secondary — up to 3. Most tasks touch 1-2 functions;
  include a second (or third) whenever there is a reasonable fit, not only a
  certain one (a hiring task that's also a product task: tag both).
- LEAN INCLUSIVE. A missing tag is costlier than an extra one: the user
  removes a wrong tag in a single click, but a tag you skipped forces them to
  hunt through a menu to add it. When a function is a plausible fit, include it.
- Return ONLY function IDs that appear in the FUNCTIONS list below.
  Never invent or paraphrase a function name.

OUTPUT FORMAT
Output STRICT JSON, no prose, no markdown fences:
{"assignments": {"t0": ["<fid1>", "<fid2>"], "t1": [], "t2": ["<fid3>"], ...}}

Every task key MUST appear in the assignments object, even when the
list is empty. Use empty array, never null.

STYLE RULE (absolute): NEVER use em-dashes (—) in any string output. This
classifier only emits IDs, but the rule is global to keep all prompts
consistent.`

function buildUserPrompt(
  functions: UserFunction[],
  tasks: ClassifyInput[]
): string {
  const fnLines = functions
    .map(f => `  - id="${f.id}", name="${f.name}"`)
    .join('\n')
  const taskLines = tasks
    .map(
      t =>
        `  - key="${t.key}", source=${t.source}, title="${t.title.replace(/"/g, '\\"')}", context="${(t.context || '').replace(/"/g, '\\"').slice(0, 240)}"`
    )
    .join('\n')
  return `FUNCTIONS:
${fnLines}

TASKS:
${taskLines}

Return the assignments JSON now.`
}

interface ClassifyResponse {
  assignments?: Record<string, string[]>
}

/**
 * Assign zero or more function ids to each ExtractedItem. Mutates the
 * input array in-place (sets item.function_ids). Returns the input
 * unchanged for chaining.
 *
 * Skips entirely when there are no user functions OR no items. Wraps
 * a single tracedMessage call so per-prompt-version slop rate works
 * on /observability.
 */
export async function classifyAndTagFunctions(args: {
  items: ExtractedItem[]
  functions: UserFunction[]
  userId?: string | null
}): Promise<{ items: ExtractedItem[]; classifyCallId: string | null }> {
  const { items, functions } = args
  if (items.length === 0 || functions.length === 0)
    return { items, classifyCallId: null }

  // Build the classifier input. The key is a synthetic batch-index so
  // we can map the LLM output back to items by position.
  const tasks: ClassifyInput[] = items.map((it, i) => ({
    key: `t${i}`,
    title: it.title,
    context: it.parent_context ?? it.source_excerpt ?? '',
    source: it.source,
  }))

  const prompt = buildUserPrompt(functions, tasks)
  const inputContent = { functions, tasks }
  let classifyCallId: string | null = null

  // mem0: fetch user-level memories relevant to the current batch.
  // The query is a short summary of the task titles being classified.
  // Memories ride on the SYSTEM prompt so the model treats them as
  // soft constraints, not part of the task input. Fail-open: empty
  // memories yields empty string, downstream sees the unchanged prompt.
  const memorySearchQuery = `Classify these tasks into functions: ${tasks
    .map(t => t.title)
    .slice(0, 8)
    .join(' | ')}`
  const memories = await fetchRelevantMemories({
    userId: args.userId ?? process.env.APP_USER_ID ?? null,
    query: memorySearchQuery,
    limit: 5,
  })
  const memoryBlock = renderMemoriesForPrompt(memories)
  const augmentedSystemPrompt = SYSTEM_PROMPT + memoryBlock

  try {
    const traceCtx = {
      prompt_id: 'classify.functions',
      // v3: must-tag-every-task contract + mem0 user-preference block in
      // the system prompt. Combined with the code-level fallback below so
      // nothing is ever left uncategorized.
      prompt_version: 3,
      user_id: args.userId ?? process.env.APP_USER_ID ?? null,
      input_content: { ...inputContent, memories },
    } as const

    let text: string

    if (USE_NEBIUS) {
      const response = await nebiusTracedMessage(traceCtx, {
        // Headroom for large batches: at ~1024 the JSON truncated past ~25
        // items, parse-failed, and left a whole batch uncategorized.
        max_tokens: 4096,
        system: augmentedSystemPrompt,
        messages: [{ role: 'user', content: prompt }],
      })
      classifyCallId = response._llmCallId || null
      text = response.content[0]?.text ?? ''
    } else {
      const response = await tracedMessage(
        anthropic,
        traceCtx,
        {
          model: MODELS.classifier,
          // Headroom for large batches (see Nebius note above).
          max_tokens: 4096,
          system: augmentedSystemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }
      )
      classifyCallId = response._llmCallId || null
      text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n')
    }

    let parsed: ClassifyResponse = {}
    try {
      parsed = JSON.parse(extractJsonObject(text)) as ClassifyResponse
    } catch (err) {
      console.warn('[classify.functions] JSON parse failed, skipping tags:', err)
      return { items, classifyCallId }
    }

    const validIds = new Set(functions.map(f => f.id))
    const out = parsed.assignments ?? {}
    // Last-resort default so a task is NEVER left uncategorized — the v3 prompt
    // mandates >=1, this guarantees it even if the model disobeys or omits a key.
    const fallbackId = functions[0]?.id

    for (let i = 0; i < items.length; i++) {
      const raw = out[`t${i}`]
      const filtered = Array.isArray(raw)
        ? Array.from(
            new Set(raw.filter((id): id is string => typeof id === 'string' && validIds.has(id)))
          )
        : []
      items[i].function_ids =
        filtered.length > 0 ? filtered : fallbackId ? [fallbackId] : []
    }
  } catch (err) {
    // Classifier failure must not block extraction. Items are inserted
    // without function tags; user can tag manually.
    console.error(
      '[classify.functions] call failed; items will be untagged:',
      err instanceof Error ? err.message : err
    )
  }

  return { items, classifyCallId }
}

/**
 * Classify ONE task and return its function ids — for creation paths outside
 * the digest batch (manual add, unread-thread open). Loads the user's
 * functions, runs the batched classifier with a single item, and GUARANTEES
 * at least one function (falls back to the user's first function if the model
 * yields nothing or the call fails). Returns [] only when the user has no
 * functions defined.
 */
export async function classifyTaskFunctions(opts: {
  title: string
  context?: string | null
  source: string
  userId?: string | null
}): Promise<string[]> {
  const { loadUserFunctions } = await import('../load-functions')
  const functions = await loadUserFunctions().catch(() => [])
  if (functions.length === 0) return []
  try {
    const item = {
      source: opts.source,
      source_ref: {},
      parent_context: opts.context ?? null,
      title: opts.title,
      task_type: 'manual',
      tag: 'action',
      urgent: false,
      due_at: null,
    } as unknown as ExtractedItem
    const { items } = await classifyAndTagFunctions({
      items: [item],
      functions,
      userId: opts.userId,
    })
    const ids = items[0]?.function_ids ?? []
    return ids.length > 0 ? ids : [functions[0].id]
  } catch {
    return [functions[0].id]
  }
}

// ─── Eval replay ────────────────────────────────────────────────────
// Used by the eval runner to regression-test prompt changes against
// captured classify.functions calls. The case stored input_content =
// { functions, tasks } at extraction time; replay rebuilds the prompt
// with the CURRENT SYSTEM_PROMPT and sends to Claude.

export interface ClassifyFunctionsInput {
  functions: UserFunction[]
  tasks: ClassifyInput[]
}

export async function replayClassifyFunctions(
  input: unknown,
  client: import('@anthropic-ai/sdk').default
): Promise<{ responseText: string; model: string }> {
  const i = input as ClassifyFunctionsInput
  if (!i || !Array.isArray(i.functions) || !Array.isArray(i.tasks)) {
    throw new Error('replayClassifyFunctions: invalid input_content shape')
  }
  const prompt = buildUserPrompt(i.functions, i.tasks)
  const response = await client.messages.create({
    model: MODELS.classifier,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
  const responseText = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return { responseText, model: response.model }
}

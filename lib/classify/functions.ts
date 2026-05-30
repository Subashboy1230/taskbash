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
import { extractJsonObject } from '../extract/parse'
import type { ExtractedItem, UserFunction } from '../types'

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
- Read the task title + context. Tag it with EVERY function that's a
  clear fit. A single task can belong to multiple functions (a hiring
  task that's also a product task: tag both).
- BE CONSERVATIVE. If a task doesn't clearly fit any function, return an
  empty list for it. Wrong tags are worse than no tags. The user will
  retag manually.
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

  try {
    const response = await tracedMessage(
      anthropic,
      {
        prompt_id: 'classify.functions',
        prompt_version: 1,
        user_id: args.userId ?? process.env.APP_USER_ID ?? null,
        input_content: inputContent,
      },
      {
        model: MODELS.classifier,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }
    )

    classifyCallId = response._llmCallId || null
    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    let parsed: ClassifyResponse = {}
    try {
      parsed = JSON.parse(extractJsonObject(text)) as ClassifyResponse
    } catch (err) {
      console.warn('[classify.functions] JSON parse failed, skipping tags:', err)
      return { items, classifyCallId }
    }

    const validIds = new Set(functions.map(f => f.id))
    const out = parsed.assignments ?? {}

    for (let i = 0; i < items.length; i++) {
      const raw = out[`t${i}`]
      if (!Array.isArray(raw)) continue
      // Filter to real function ids only. Drop dupes.
      const filtered = Array.from(
        new Set(raw.filter((id): id is string => typeof id === 'string' && validIds.has(id)))
      )
      if (filtered.length > 0) {
        items[i].function_ids = filtered
      }
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

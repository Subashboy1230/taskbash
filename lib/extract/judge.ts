// Extractor + Judge — second pass over every extractor's output.
//
// Design:
//   The first-pass extractor (Haiku) is optimized for throughput. It reads
//   the source (email thread / meeting summary) and emits candidate items.
//   The judge (Sonnet) is a stricter, more expensive reviewer that gets:
//     1. The same source material
//     2. The extractor's candidate list
//     3. The user's currently OPEN tasks (compact form)
//
//   For each candidate the judge outputs one verdict:
//     - keep      : write it (optionally with corrected tag/urgent/confidence)
//     - drop      : false positive (vague, not owned by user, already done)
//     - merge     : duplicate of an existing OPEN task (cite id)
//     - subtask   : belongs under another candidate in the same batch
//
//   The judge also fixes classification metadata (tag, urgent,
//   draft_confidence) when the extractor got it wrong.
//
//   Feature-flagged via TASKBASH_JUDGE_ENABLED so we can toggle it off in
//   prod without a deploy if it ever misfires. Default: enabled.
//
//   All decisions are traced through tracedMessage so slop/merge/drop
//   rates show up in /observability.

import { anthropic, MODELS } from '../anthropic'
import { tracedMessage } from '../llm-trace'
import { extractJsonObject } from './parse'
import type { ExtractedItem, Source } from '../types'

// ─── Feature flag ────────────────────────────────────────────────────

/**
 * True when the judge pass should run. Off means every candidate is
 * passed through unchanged (current single-pass behavior). Defaults on;
 * set TASKBASH_JUDGE_ENABLED=false on Vercel to disable without a code
 * change.
 */
export function isJudgeEnabled(): boolean {
  const v = (process.env.TASKBASH_JUDGE_ENABLED ?? 'true').toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'off'
}

// ─── Public entry point ──────────────────────────────────────────────

export interface OpenItemHint {
  id: string
  title: string
  parent_context?: string | null
  source: Source
}

export interface JudgeInput {
  source: Source
  /**
   * Human label for the batch — the email subject line, meeting title,
   * etc. Shown to the judge as context.
   */
  batchLabel: string
  /**
   * The source material the extractor read (email transcript, meeting
   * summary text). Kept modest — the judge doesn't need full fidelity,
   * just enough to sanity-check each candidate.
   */
  sourceText: string
  candidates: ExtractedItem[]
  /**
   * Currently-open items across all sources for this user, in compact
   * form. Used for dedup lookup. Prefiltered to a manageable size
   * (~150) by the caller.
   */
  openItems: OpenItemHint[]
  userId?: string | null
  /**
   * Passed through to the trace so judge calls join to the extraction
   * call in llm_calls (parent_run_id).
   */
  parentRunId?: string | null
  /**
   * The source_ref of the extractor call — echoed onto the judge trace
   * for correlation.
   */
  sourceRef?: unknown
}

export interface JudgedResult {
  /** Candidates the judge accepted (with any corrections applied). */
  keep: ExtractedItem[]
  /** Candidates matched to an existing open item; do not insert new row. */
  merged: Array<{ candidate: ExtractedItem; targetId: string; reason: string }>
  /** Candidates that belong nested under another candidate in this batch. */
  demoted: Array<{ candidate: ExtractedItem; parentTitle: string }>
  /** Candidates the judge rejected. */
  dropped: Array<{ candidate: ExtractedItem; reason: string }>
  /** llm_calls.id for the judge call, if it ran. */
  llmCallId?: string
}

/**
 * Judge a batch of extractor candidates. Never throws — on any failure,
 * falls back to keeping every candidate unchanged so a bad judge call
 * can't kill a whole digest run.
 */
export async function judgeExtractedItems(
  input: JudgeInput
): Promise<JudgedResult> {
  // Pass-through when disabled or nothing to judge.
  if (!isJudgeEnabled() || input.candidates.length === 0) {
    return { keep: input.candidates, merged: [], demoted: [], dropped: [] }
  }

  const prompt = buildJudgePrompt(input)

  try {
    const response = await tracedMessage(
      anthropic,
      {
        prompt_id: `judge.${input.source}`,
        prompt_version: JUDGE_VERSION,
        user_id: input.userId ?? null,
        parent_run_id: input.parentRunId ?? null,
        source_ref: input.sourceRef,
        input_content: {
          batchLabel: input.batchLabel,
          candidateCount: input.candidates.length,
          openItemCount: input.openItems.length,
        },
      },
      {
        model: MODELS.judge,
        max_tokens: 2048,
        // Deterministic. The judge is a classifier, not a generator.
        temperature: 0,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }
    )

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    const decisions = parseJudgeResponse(text, input.candidates.length)
    return applyDecisions(input, decisions, response._llmCallId)
  } catch (err) {
    console.error(`[judge:${input.source}] failed — falling back to keep-all:`, err)
    return { keep: input.candidates, merged: [], demoted: [], dropped: [] }
  }
}

// ─── Prompt ──────────────────────────────────────────────────────────

const JUDGE_VERSION = 1

const JUDGE_SYSTEM_PROMPT = `You are a strict reviewer of extracted action items. A first-pass extractor read a source (email thread or meeting summary) and produced candidate items for the user's task list. Your job is to decide, for each candidate, whether it should be kept, dropped, merged into an existing open task, or demoted to a subtask of another candidate.

Your output is STRICT JSON. No prose. No markdown fences. No explanation outside the JSON.

Output schema:
{
  "decisions": [
    {
      "idx": <int>,                     // candidate index from input list
      "verdict": "keep" | "drop" | "merge" | "subtask",
      "reason": "<one short sentence>",
      "merge_target_id": "<uuid>",      // REQUIRED if verdict = "merge". Must be one of the open_items ids.
      "parent_idx": <int>,              // REQUIRED if verdict = "subtask". Must be a different candidate idx that IS being kept.
      "corrected_tag": "action" | "reply" | "commit" | "fyi",   // OPTIONAL. Only set when the extractor's tag is wrong.
      "corrected_urgent": true | false,                          // OPTIONAL. Only set when the extractor's urgency is wrong.
      "corrected_draft_confidence": "high" | "medium" | "low" | "skip"  // OPTIONAL. Only for reply items.
    }
  ]
}

You MUST emit one decision for every candidate. Order does not matter, but every idx must appear exactly once.

VERDICT RUBRIC (apply in order):

1) drop — the candidate is not a real task the user owns:
   - Vague, no concrete action ("follow up", "think about it")
   - Owned by someone else in the source (someone else committed to do it)
   - Already completed within the source itself
   - Duplicates another kept candidate in this same batch (drop, don't merge — merge is only for existing open tasks)
   - Restatement of a fact / status update, not an action ("The team is on track for launch")

2) merge — the candidate is the same commitment as an existing OPEN task:
   - Look at open_items. If any of them describes the same person + same object + same underlying action, use "merge" and set merge_target_id.
   - Small verb differences ("Confirm meeting" vs "Verify meeting") are the same commitment.
   - Small object differences ("send deck" vs "send deck and demo") are the same commitment when the intent is one deliverable.
   - Include time markers, phone numbers, or IDs in the CANDIDATE title only when they distinguish two different commitments; otherwise treat as duplicate.

3) subtask — the candidate is a piece of another candidate in this batch:
   - "Attach the Q3 spreadsheet" is a subtask of "Send Q3 update to team"
   - "CC Anna" is a subtask of "Reply to Bob about Q3 pricing"
   - Only demote when the parent_idx candidate you cite is clearly the container action.

4) keep — real, non-duplicate, top-level task. Optionally correct its tag / urgent / draft_confidence if the extractor got it wrong.

CORRECTION GUIDANCE:

tag:
- "reply" : owes a response to someone specific (email, DM)
- "action": concrete work beyond replying (draft a doc, decide, ship)
- "commit": explicit promise the user made ("I'll send Friday")
- "fyi"   : informational, no action required

urgent:
- true only when there's a real time pressure: same-day / next-day deadline, explicit "ASAP", or someone actively blocked.
- Otherwise false.

draft_confidence (for tag = "reply" only; null for other tags):
- "high"   : one-to-one human exchange, real person waiting on a real reply
- "medium" : likely real but borderline (cold outreach, unclear intent)
- "low"    : probably low-priority or automated
- "skip"   : clearly automated (onboarding email, receipt, no-reply)

BE STRICT. When in doubt, DROP or MERGE. It is much better to lose a marginal task than to clutter the surface with duplicates and vague items. The extractor errs on the side of inclusion; you err on the side of exclusion.`

function buildJudgePrompt(input: JudgeInput): string {
  const candidatesJson = input.candidates.map((c, idx) => ({
    idx,
    title: c.title,
    subtitle: c.subtitle ?? null,
    tag: c.tag ?? null,
    urgent: c.urgent ?? false,
    due_at: c.due_at ?? null,
    draft_confidence: c.draft_confidence ?? null,
    sub_items: (c.sub_items ?? []).map(s => s.title),
  }))

  // Compact open items so we don't blow the token budget. We only pass
  // title + parent context — the judge doesn't need timestamps or refs.
  const openItemsJson = input.openItems.map(o => ({
    id: o.id,
    title: o.title,
    parent: o.parent_context ?? null,
    source: o.source,
  }))

  return `Source: ${input.source}
Batch label: ${input.batchLabel}

--- SOURCE MATERIAL ---
${input.sourceText.slice(0, 4000)}

--- EXTRACTOR CANDIDATES ---
${JSON.stringify(candidatesJson, null, 2)}

--- USER'S CURRENTLY OPEN TASKS (for dedup lookup only) ---
${JSON.stringify(openItemsJson, null, 2)}

Return the decisions JSON. Exactly one decision per candidate.`
}

// ─── Parsing + applying ─────────────────────────────────────────────

interface Decision {
  idx: number
  verdict: 'keep' | 'drop' | 'merge' | 'subtask'
  reason?: string
  merge_target_id?: string
  parent_idx?: number
  corrected_tag?: 'action' | 'reply' | 'commit' | 'fyi'
  corrected_urgent?: boolean
  corrected_draft_confidence?: 'high' | 'medium' | 'low' | 'skip'
}

function parseJudgeResponse(text: string, expectedCount: number): Decision[] {
  let parsed: { decisions?: Decision[] }
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch (err) {
    console.error('[judge] failed to parse response:', text.slice(0, 200))
    throw err  // triggers keep-all fallback in caller
  }
  const decisions = parsed.decisions ?? []
  // If the judge under-emits (missing decisions), fill with "keep" for
  // safety — dropping a candidate is a destructive act; keeping it is not.
  const seen = new Set(decisions.map(d => d.idx))
  for (let i = 0; i < expectedCount; i++) {
    if (!seen.has(i)) {
      decisions.push({ idx: i, verdict: 'keep', reason: 'judge omitted decision — defaulted to keep' })
    }
  }
  return decisions
}

function applyDecisions(
  input: JudgeInput,
  decisions: Decision[],
  llmCallId?: string
): JudgedResult {
  const result: JudgedResult = {
    keep: [],
    merged: [],
    demoted: [],
    dropped: [],
    llmCallId,
  }

  // Which existing item ids are valid merge targets — anything else the
  // judge cites gets rejected and we fall back to keep.
  const openIds = new Set(input.openItems.map(o => o.id))

  // Which candidate indexes end up kept (so subtask parent_idx validation
  // can require the parent to be a keep, not a drop).
  const keepIndexes = new Set<number>()
  for (const d of decisions) {
    if (d.verdict === 'keep') keepIndexes.add(d.idx)
    // subtasks are attached to a kept parent, but they themselves still
    // exist as items — just nested. So the subtask candidate is "kept"
    // in the sense that it appears in the output; we handle that in the
    // second pass below.
  }

  for (const d of decisions) {
    const cand = input.candidates[d.idx]
    if (!cand) continue

    // Apply corrections in-place so all downstream verdicts see the
    // corrected shape.
    const corrected: ExtractedItem = { ...cand }
    if (d.corrected_tag) corrected.tag = d.corrected_tag
    if (typeof d.corrected_urgent === 'boolean') corrected.urgent = d.corrected_urgent
    if (d.corrected_draft_confidence !== undefined) {
      corrected.draft_confidence = d.corrected_draft_confidence
    }

    switch (d.verdict) {
      case 'drop':
        result.dropped.push({ candidate: corrected, reason: d.reason ?? 'judge dropped' })
        break

      case 'merge':
        if (d.merge_target_id && openIds.has(d.merge_target_id)) {
          result.merged.push({
            candidate: corrected,
            targetId: d.merge_target_id,
            reason: d.reason ?? 'judge merged into existing open task',
          })
        } else {
          // Judge cited a bogus id — safe fallback: keep the candidate.
          console.warn(`[judge] merge target id not found (${d.merge_target_id}) — keeping candidate`)
          result.keep.push(corrected)
        }
        break

      case 'subtask':
        if (typeof d.parent_idx === 'number' && keepIndexes.has(d.parent_idx)) {
          const parent = input.candidates[d.parent_idx]
          const parentTitle = parent?.title ?? input.batchLabel
          // Turn the demoted candidate into a sub_item under its parent
          // AND emit the standalone candidate as a subtask row (so the
          // Context Trail + tag survive). The digest write path handles
          // parent_id via the extracted sub_items array on the parent.
          const parentIdx = decisions.findIndex(
            dd => dd.idx === d.parent_idx && dd.verdict === 'keep'
          )
          if (parentIdx >= 0) {
            // Attach as a sub_item on the parent's ExtractedItem shape.
            // The digest writer already handles this pattern for extractor-
            // emitted sub_items.
            parent.sub_items = parent.sub_items ?? []
            parent.sub_items.push({
              source: corrected.source,
              source_ref: corrected.source_ref,
              parent_context: parentTitle,
              title: corrected.title,
              task_type: corrected.task_type,
              tag: corrected.tag,
            })
            result.demoted.push({ candidate: corrected, parentTitle })
          } else {
            result.keep.push(corrected)
          }
        } else {
          // Bad parent_idx — safe fallback: keep as top-level.
          result.keep.push(corrected)
        }
        break

      case 'keep':
      default:
        result.keep.push(corrected)
        break
    }
  }

  return result
}

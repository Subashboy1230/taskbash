// runDigestForUser — synchronous, no-Inngest version of the morning-digest
// pipeline. Pulls fresh items from every connected source, diffs against
// open items in the DB, persists new/carryover/completed transitions.
// Used by the on-demand "Refresh" button on /today and by the Inngest
// cron job (which wraps it in step.run blocks for durability).
//
// Skips the runs / agent_events log writes for the sync path to keep the
// round-trip fast; the Inngest path keeps those for audit history.

import { supabase } from '../supabase'
import { extractGranolaActionItems } from '../extract/granola'
import { extractGmailActionItems, extractGmailSentCommitments } from '../extract/gmail'
import { extractCalendarPrepItems } from '../extract/calendar'
import { extractLinearActionItems } from '../extract/linear'
import { diffSingleSource } from '../diff'
import { computeSemanticHash } from '../normalize'
import { getActiveConnection } from '../connections'
import { tagCallWithItems } from '../llm-trace'
import { flushLangfuse } from '../langfuse'
import { classifyAndTagFunctions } from '../classify/functions'
import { loadUserFunctions } from '../load-functions'
import type { ExtractedItem, Item, Source } from '../types'

export interface DigestRunSummary {
  sources_run: Source[]
  fresh: number
  new: number
  carryover: number
  completed: number
  /** Fresh items skipped because the user already cleared the same task. */
  suppressed: number
  durationMs: number
}

export interface DigestRunOpts {
  userId: string
  userEmail: string
  /** Lookback window (days) for sources that take one. Default 7. */
  days?: number
}

export async function runDigestForUser(opts: DigestRunOpts): Promise<DigestRunSummary> {
  const t0 = Date.now()
  const { userId, userEmail } = opts
  const days = opts.days ?? 7

  // ─── Auto-unsnooze items whose snooze window has passed ──────────────
  await supabase
    .from('items')
    .update({ status: 'open', snooze_until: null })
    .eq('user_id', userId)
    .eq('status', 'snoozed')
    .lt('snooze_until', new Date().toISOString())

  // ─── Load items the user has touched recently for the diff ─────────
  // OPEN items drive carryover. CLEARED items (completed / dismissed /
  // snoozed) drive suppression so a re-extracted task the user already
  // dealt with does not resurface. We cap cleared to the 100 most recent
  // — older than that, the user wouldn't realistically remember dealing
  // with it, and re-surfacing as "new" is fine.
  const CLEARED_LIMIT = 100
  const { data: openRows, error: openErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['open', 'in_progress'])
  if (openErr) throw new Error(`load open items: ${openErr.message}`)
  const { data: clearedRows, error: clearedErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['completed', 'dismissed', 'snoozed'])
    .order('updated_at', { ascending: false })
    .limit(CLEARED_LIMIT)
  if (clearedErr) throw new Error(`load cleared items: ${clearedErr.message}`)
  const currentItems = [
    ...((openRows ?? []) as Item[]),
    ...((clearedRows ?? []) as Item[]),
  ]

  // ─── Run every connected source extractor ────────────────────────────
  // Gate each source on connection state so a disconnected source neither
  // throws nor causes the diff to auto-complete its items.
  const sourcesRun: Source[] = []
  const allFresh: ExtractedItem[] = []

  await tryRun('granola', async () => {
    const conn = await getActiveConnection('granola')
    if (!conn?.api_key) return null
    // Build the set of Granola meeting IDs that already have a proposed_action
    // stored in the DB. The extractor skips draftFollowup for these meetings so
    // we don't burn tokens generating drafts that the carryover path would throw away.
    const { data: draftedRows } = await supabase
      .from('items')
      .select('source_ref')
      .eq('user_id', userId)
      .eq('source', 'granola')
      .not('proposed_action', 'is', null)
    const meetingIdsWithDraft = new Set<string>(
      (draftedRows ?? [])
        .map(r => (r.source_ref as { granola_meeting_id?: string } | null)?.granola_meeting_id)
        .filter((id): id is string => typeof id === 'string')
    )
    const items = await extractGranolaActionItems({ userEmail, days, meetingIdsWithDraft })
    return items
  })

  await tryRun('gmail', async () => {
    const conn = await getActiveConnection('gmail')
    if (!conn?.nango_connection_id) return null
    const [inbox, sent] = await Promise.all([
      extractGmailActionItems({ userEmail, userId, days }),
      extractGmailSentCommitments({ userEmail, days }),
    ])
    return [...inbox, ...sent]
  })

  await tryRun('calendar', async () => {
    const conn = await getActiveConnection('calendar')
    if (!conn?.nango_connection_id) return null
    return extractCalendarPrepItems({ userEmail })
  })

  await tryRun('linear', async () => {
    const conn = await getActiveConnection('linear')
    if (!conn?.api_key) return null
    return extractLinearActionItems({ userEmail })
  })

  async function tryRun(
    source: Source,
    fn: () => Promise<ExtractedItem[] | null>
  ) {
    try {
      const items = await fn()
      if (items === null) return
      for (const parent of items) {
        allFresh.push(parent)
        // sub_items stay on parent.sub_items — written as child rows with
        // parent_id in the insert loop, not flattened into top-level siblings.
      }
      sourcesRun.push(source)
    } catch (err) {
      console.error(`[runDigest] ${source} failed:`, err)
    }
  }

  // ─── Auto-tag user functions onto every freshly-extracted item ──────
  // One Claude call batches every item across every source. Failure is
  // silent — items just go in untagged and the user can tag manually.
  const userFunctions = await loadUserFunctions().catch(() => [])
  let classifyCallId: string | null = null
  if (userFunctions.length > 0 && allFresh.length > 0) {
    const result = await classifyAndTagFunctions({
      items: allFresh,
      functions: userFunctions,
      userId,
    })
    classifyCallId = result.classifyCallId
  }

  // ─── Diff per-source and persist ─────────────────────────────────────
  let newCount = 0
  let carryoverCount = 0
  let completedCount = 0
  let suppressedCount = 0

  // Buckets new item ids by the llm_call that produced them — used at
  // the end of the loop to tag llm_calls.produced_item_ids so per-prompt
  // slop_rate joins on /observability return real numbers.
  const callToItemIds = new Map<string, string[]>()

  for (const source of sourcesRun) {
    const freshForSource = allFresh.filter(i => i.source === source)
    const result = diffSingleSource(currentItems, freshForSource, source)

    // Inserts
    for (const fresh of result.newItems) {
      const semantic_hash = computeSemanticHash(
        fresh.source,
        fresh.parent_context,
        fresh.title
      )
      const briefFields = fresh.brief
        ? {
            brief: fresh.brief,
            brief_status: 'generated' as const,
            brief_generated_at: new Date().toISOString(),
          }
        : {}
      const { data: inserted, error } = await supabase
        .from('items')
        .insert({
          user_id: userId,
          title: fresh.title,
          subtitle: fresh.subtitle ?? null,
          task_type: fresh.task_type,
          tag: fresh.tag ?? null,
          parent_context: fresh.parent_context,
          source: fresh.source,
          source_ref: fresh.source_ref,
          urgent: fresh.urgent ?? false,
          due_at: fresh.due_at ?? null,
          semantic_hash,
          proposed_action: fresh.proposed_action ?? null,
          source_excerpt: fresh.source_excerpt ?? null,
          // Persist producing call ids on the item.
          //   llm_call_id        → the extractor call that produced it
          //                        (markItemSlop reads this for fast lookup)
          //   classify_call_id   → the classify.functions call that
          //                        assigned function_ids (setItemFunctions
          //                        reads this when capturing corrections)
          extraction_meta:
            fresh._llm_call_id || classifyCallId
              ? {
                  ...(fresh._llm_call_id ? { llm_call_id: fresh._llm_call_id } : {}),
                  ...(classifyCallId ? { classify_call_id: classifyCallId } : {}),
                }
              : null,
          // Auto-assigned function tags from classifyAndTagFunctions
          // (empty array when no functions defined or none fit).
          function_ids: fresh.function_ids ?? [],
          draft_confidence: fresh.draft_confidence ?? null,
          // Store gmail_draft_id from proposed_action if present
          gmail_draft_id: (fresh.proposed_action as { gmail_draft_id?: string } | null | undefined)?.gmail_draft_id ?? null,
          ...briefFields,
        })
        .select('id')
        .single()
      if (!error && inserted?.id) {
        newCount += 1
        if (fresh._llm_call_id) {
          const list = callToItemIds.get(fresh._llm_call_id) ?? []
          list.push(inserted.id)
          callToItemIds.set(fresh._llm_call_id, list)
        }
        // Fire-and-forget task_events write — doesn't block the digest
        void supabase.from('task_events').insert({
          user_id: userId,
          item_id: inserted.id,
          kind: 'created',
        })

        // Write sub_items as child rows attached to the parent, never as
        // top-level siblings (that was the cascading-subtask-leak bug).
        if (fresh.sub_items && fresh.sub_items.length > 0) {
          const subInserts = fresh.sub_items.map(sub => {
            const subHash = computeSemanticHash(
              'manual',
              fresh.parent_context,
              sub.title
            )
            return {
              user_id: userId,
              title: sub.title,
              task_type: (sub.task_type ?? 'action') as string,
              tag: 'action' as const,
              source: 'manual' as const,
              source_ref: { auto_subtask: true } as Record<string, unknown>,
              parent_id: inserted.id,
              role: 'subtask' as const,
              parent_context: null as string | null,
              semantic_hash: subHash,
              status: 'open' as const,
            }
          })
          void supabase.from('items').insert(subInserts)
        }
      }
      // Ignore unique-index race (23505) — treat as carryover silently.
    }

    // Carryover — update last_seen_at, and write proposed_action if the
    // fresh item has one but the existing DB row doesn't (first time a
    // draft is generated for a meeting that was previously seen without one).
    for (const { existing, fresh } of result.carryover) {
      const update: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
      if (fresh.proposed_action && !existing.proposed_action) {
        update.proposed_action = fresh.proposed_action
        if ((fresh.proposed_action as { gmail_draft_id?: string })?.gmail_draft_id) {
          update.gmail_draft_id = (fresh.proposed_action as { gmail_draft_id?: string }).gmail_draft_id
        }
      }
      await supabase.from('items').update(update).eq('id', existing.id)
      carryoverCount += 1
    }

    // Suppressed = fresh items the user already cleared (completed,
    // dismissed, or snoozed). We do nothing here: the existing cleared
    // row stays cleared, the fresh item is dropped on the floor. This
    // is the fix for the bug where re-running the digest resurfaced
    // tasks the user had marked done or slop.
    suppressedCount += result.suppressed.length

    // DISABLED — auto-complete-vanished was too aggressive. Extractors
    // only look at a recent window (Gmail 7d, Granola 7d, Linear all-time
    // but capped at maxResults). An OPEN task outside that window would
    // be absent from "fresh" and incorrectly auto-closed every digest.
    // A task is now only completed when the user explicitly clears it
    // (mark done, mark slop, snooze past due, or the source's own
    // status transition — e.g. a Linear issue moving to Done). The
    // diff still produces result.completed but we leave it untouched.
    completedCount += 0
  }

  // Tag each LLM call with the items it actually produced. Fire-and-
  // forget per call — observability writes must not block the digest.
  await Promise.all(
    Array.from(callToItemIds.entries()).map(([callId, itemIds]) =>
      tagCallWithItems(callId, itemIds).catch(err =>
        console.error('[runDigest] tagCallWithItems failed:', err)
      )
    )
  )

  // Flush any pending Langfuse events before the serverless function
  // exits. No-op when Langfuse isn't configured.
  await flushLangfuse()

  return {
    sources_run: sourcesRun,
    fresh: allFresh.length,
    new: newCount,
    carryover: carryoverCount,
    completed: completedCount,
    suppressed: suppressedCount,
    durationMs: Date.now() - t0,
  }
}

// runDigestForUser — synchronous, no-Inngest version of the morning-digest
// pipeline. Pulls fresh items from every connected source, diffs against
// open items in the DB, persists new/carryover/completed transitions.
// Used by the on-demand "Refresh" button on /today and by the Inngest
// cron job (which wraps it in step.run blocks for durability).

import { supabase } from '../supabase'
import { extractGranolaActionItems } from '../extract/granola'
import { extractGmailActionItems, extractGmailSentCommitments } from '../extract/gmail'
import { extractCalendarPrepItems } from '../extract/calendar'
import { extractLinearActionItems } from '../extract/linear'
import { extractSlackActionItems } from '../extract/slack'
import { composioSlackConfigured } from '../connectors/composio'
import { diffSingleSource } from '../diff'
import { computeSemanticHash } from '../normalize'
import { isMechanicalNoise } from '../extract/filters'
import { getActiveConnection } from '../connections'
import { tagCallWithItems } from '../llm-trace'
import { flushLangfuse } from '../langfuse'
import { classifyAndTagFunctions } from '../classify/functions'
import { loadUserFunctions } from '../load-functions'
import { createRunStepEmitter, SOURCE_STEP } from './run-steps'
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
  /** 'cron' (Inngest morning job) or 'manual' (Re-run button). Default 'manual'. */
  trigger?: 'cron' | 'manual'
  /** When provided (manual Re-run path), reuse this pre-created runs row
   *  instead of inserting a new one, so the client can watch it live. */
  runId?: string
}

// A source that hangs (e.g. a connector whose connection times out, or a
// slow per-event prep-brief pass) must never stall the whole run. Cap each
// source; on timeout it's marked failed ("took too long") and the run
// finishes with whatever the other sources returned.
const SOURCE_TIMEOUT_MS = 90_000
class SourceTimeoutError extends Error {}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new SourceTimeoutError('source timed out')), ms)
    ),
  ])
}

export async function runDigestForUser(opts: DigestRunOpts): Promise<DigestRunSummary> {
  const t0 = Date.now()
  const { userId, userEmail } = opts
  if (!userId?.trim()) throw new Error('runDigestForUser: userId is required but was empty or missing')
  const days = opts.days ?? 7
  const trigger = opts.trigger ?? 'manual'

  // Clean up rows left in 'running' by a previous run that never finished.
  // Two distinct cases, so the Activity feed reads honestly:
  //   - Recently started (< 15 min): almost certainly an overlapping in-flight
  //     run (e.g. the user double-clicked Re-run, or cron overlapped a manual
  //     run). Mark 'superseded' → a muted pill, not a scary red "Failed".
  //   - Older (>= 15 min): the process is long dead (hard crash / timeout that
  //     never reached the catch below). Mark 'failed' so a real problem stays
  //     visible.
  const SUPERSEDE_WINDOW_MS = 15 * 60 * 1000
  const staleCutoff = new Date(Date.now() - SUPERSEDE_WINDOW_MS).toISOString()
  const sweepNow = new Date().toISOString()
  // Sweep prior 'running' rows, but never the row we were handed: the manual
  // Re-run path pre-creates this run as 'running' before calling us, so
  // sweeping every running row would mark our own run superseded.
  let supersedeQ = supabase
    .from('runs')
    .update({ status: 'superseded', completed_at: sweepNow })
    .eq('user_id', userId)
    .eq('status', 'running')
    .gte('started_at', staleCutoff)
  let failQ = supabase
    .from('runs')
    .update({ status: 'failed', completed_at: sweepNow })
    .eq('user_id', userId)
    .eq('status', 'running')
    .lt('started_at', staleCutoff)
  if (opts.runId) {
    supersedeQ = supersedeQ.neq('id', opts.runId)
    failQ = failQ.neq('id', opts.runId)
  }
  await supersedeQ
  await failQ

  // Reuse the pre-created run row (manual path) or insert one now (cron), so
  // the Activity page shows an in-progress entry even if the run fails midway.
  let runId: string | null = opts.runId ?? null
  if (!runId) {
    const { data: runRow } = await supabase
      .from('runs')
      .insert({ user_id: userId, trigger, status: 'running', sources_run: [] })
      .select('id')
      .single()
    runId = runRow?.id ?? null
  }

  // Emitter for the live Agent Activity panel. Declared before the try so the
  // catch can record a failure step too. No-op when runId is null.
  const steps = createRunStepEmitter(runId, userId)

  // Wrap the rest of the pipeline so that ANY throw flips the run row from
  // 'running' to 'failed' before re-throwing. Without this, a mid-run crash
  // leaves the row stuck in 'running' forever (until the NEXT digest run
  // sweeps it up at line 50–54, which can be hours or days later).
  try {
  await steps.log({ phase: 'start', label: 'Starting — pulling from your connected sources', status: 'done' })
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
  const sourcesFailed: Source[] = []
  const allFresh: ExtractedItem[] = []

  // Sources run in PARALLEL so one slow or failing source (e.g. a Granola
  // connection that times out after ~10s) never blocks the others. Each
  // tryRun catches its own error and emits its own step, so Promise.all
  // never rejects and the panel shows every source resolving live.
  const runGranola = tryRun('granola', async () => {
    const conn = await getActiveConnection('granola', userId)
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
    const items = await extractGranolaActionItems({ userEmail, userId, days, meetingIdsWithDraft })
    return items
  })

  const runGmail = tryRun('gmail', async () => {
    const conn = await getActiveConnection('gmail', userId)
    if (!conn?.nango_connection_id) return null
    const [inbox, sent] = await Promise.all([
      extractGmailActionItems({ userEmail, userId, days }),
      extractGmailSentCommitments({ userEmail, userId, days }),
    ])
    return [...inbox, ...sent]
  })

  const runCalendar = tryRun('calendar', async () => {
    const conn = await getActiveConnection('calendar', userId)
    if (!conn?.nango_connection_id) return null
    return extractCalendarPrepItems({ userEmail, userId })
  })

  const runLinear = tryRun('linear', async () => {
    const conn = await getActiveConnection('linear', userId)
    if (!conn?.api_key) return null
    return extractLinearActionItems({ userEmail, userId })
  })

  // Slack via Composio. Gated on COMPOSIO_API_KEY + COMPOSIO_SLACK_CONNECTION_ID
  // being set in env. composioSlackConfigured returns false when either is
  // missing, so this is a no-op until the user pastes credentials.
  const runSlack = tryRun('slack', async () => {
    if (!composioSlackConfigured()) return null
    return extractSlackActionItems({ userEmail, userId, days })
  })

  await Promise.all([runGranola, runGmail, runCalendar, runLinear, runSlack])

  async function tryRun(
    source: Exclude<Source, 'manual'>,
    fn: () => Promise<ExtractedItem[] | null>
  ) {
    const meta = SOURCE_STEP[source]
    const stepId = await steps.start({
      phase: 'source',
      source,
      label: meta.running,
      detail: meta.detail,
    })
    try {
      const items = await withTimeout(fn(), SOURCE_TIMEOUT_MS)
      if (items === null) {
        await steps.finish(stepId, {
          status: 'skipped',
          label: `${meta.tool} isn't connected`,
          itemCount: 0,
        })
        return
      }
      const before = allFresh.length
      for (const parent of items) {
        // Drop mechanical event/logistics noise ("Join the Google Meet at
        // 12:15pm", dial-ins, bare meeting links) before it enters the diff.
        // Source-agnostic: this leaks from gmail/granola, not one extractor.
        if (isMechanicalNoise(parent.title)) continue
        allFresh.push(parent)
        // sub_items stay on parent.sub_items — written as child rows with
        // parent_id in the insert loop, not flattened into top-level siblings.
      }
      const added = allFresh.length - before
      sourcesRun.push(source)
      await steps.finish(stepId, {
        status: 'done',
        label:
          added === 0
            ? `Nothing new in ${meta.tool}`
            : `Found ${added} ${added === 1 ? 'item' : 'items'} in ${meta.tool}`,
        itemCount: added,
      })
    } catch (err) {
      const timedOut = err instanceof SourceTimeoutError
      console.error(`[runDigest] ${source} ${timedOut ? 'timed out' : 'failed'}:`, err)
      sourcesFailed.push(source)
      await steps.finish(stepId, {
        status: 'failed',
        label: timedOut
          ? `${meta.tool} took too long, skipped`
          : `Couldn't reach ${meta.tool}`,
        itemCount: 0,
      })
    }
  }

  // ─── Auto-tag user functions onto every freshly-extracted item ──────
  // One Claude call batches every item across every source. Failure is
  // silent — items just go in untagged and the user can tag manually.
  const userFunctions = await loadUserFunctions().catch(() => [])
  let classifyCallId: string | null = null
  if (userFunctions.length > 0 && allFresh.length > 0) {
    const classifyStep = await steps.start({
      phase: 'classify',
      label: 'Sorting tasks into your work areas',
      detail: {
        tool: 'Claude Haiku / Nebius Llama 3.3 70B',
        prompt_id: 'classify.functions',
      },
    })
    const result = await classifyAndTagFunctions({
      items: allFresh,
      functions: userFunctions,
      userId,
    })
    classifyCallId = result.classifyCallId
    await steps.finish(classifyStep, {
      status: 'done',
      label: 'Sorted tasks into your work areas',
    })
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

  const diffStep = await steps.start({
    phase: 'diff',
    label: 'Comparing against your existing tasks',
    detail: {
      note: 'Adds new tasks, keeps current ones, skips anything you already cleared',
    },
  })

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
      // Backfill meeting_url into source_ref on carryover so existing prep
      // items pick up the join link without needing a full re-insert.
      const freshMeetingUrl = (fresh.source_ref as { meeting_url?: string } | null)?.meeting_url
      const existingMeetingUrl = (existing.source_ref as { meeting_url?: string } | null)?.meeting_url
      if (freshMeetingUrl && !existingMeetingUrl) {
        update.source_ref = { ...(existing.source_ref as object ?? {}), meeting_url: freshMeetingUrl }
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

  await steps.finish(diffStep, {
    status: 'done',
    label: `Added ${newCount} new, kept ${carryoverCount}, skipped ${suppressedCount}`,
    itemCount: newCount,
  })

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

  const summary: DigestRunSummary = {
    sources_run: sourcesRun,
    fresh: allFresh.length,
    new: newCount,
    carryover: carryoverCount,
    completed: completedCount,
    suppressed: suppressedCount,
    durationMs: Date.now() - t0,
  }

  await steps.log({
    phase: 'done',
    status: 'done',
    label:
      newCount === 0
        ? "Done — you're all caught up"
        : `Done — added ${newCount} new ${newCount === 1 ? 'task' : 'tasks'}`,
    itemCount: newCount,
  })

  // Safety net: flip any step still marked 'running' (e.g. a finish() write
  // that didn't land) to done, so the panel never shows a stuck spinner.
  await steps.finalize('done')

  if (runId) {
    await supabase.from('runs').update({
      status: sourcesFailed.length > 0 && sourcesRun.length === 0 ? 'failed' : 'succeeded',
      completed_at: new Date().toISOString(),
      sources_run: sourcesRun,
      sources_failed: sourcesFailed,
      fresh_count: allFresh.length,
      new_count: newCount,
      carryover_count: carryoverCount,
      completed_count: completedCount,
    }).eq('id', runId)
  }

  return summary
  } catch (err) {
    // Make sure the runs row reflects reality before we re-throw, so
    // the Activity feed never shows a permanently-Running entry from a
    // crashed digest.
    if (runId) {
      try {
        await supabase.from('runs').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
        }).eq('id', runId)
      } catch { /* swallow — the original error is more interesting */ }
    }
    await steps.log({
      phase: 'error',
      status: 'failed',
      label: 'Something went wrong during the refresh',
    })
    await steps.finalize('failed')
    throw err
  }
}

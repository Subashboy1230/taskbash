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
import { extractGmailActionItems } from '../extract/gmail'
import { extractCalendarPrepItems } from '../extract/calendar'
import { extractLinearActionItems } from '../extract/linear'
import { diffSingleSource } from '../diff'
import { computeSemanticHash } from '../normalize'
import { getActiveConnection } from '../connections'
import type { ExtractedItem, Item, Source } from '../types'

export interface DigestRunSummary {
  sources_run: Source[]
  fresh: number
  new: number
  carryover: number
  completed: number
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

  // ─── Load currently-open items for the diff ──────────────────────────
  const { data: openRows, error: openErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['open', 'in_progress'])
  if (openErr) throw new Error(`load open items: ${openErr.message}`)
  const currentItems = (openRows ?? []) as Item[]

  // ─── Run every connected source extractor ────────────────────────────
  // Gate each source on connection state so a disconnected source neither
  // throws nor causes the diff to auto-complete its items.
  const sourcesRun: Source[] = []
  const allFresh: ExtractedItem[] = []

  await tryRun('granola', async () => {
    const conn = await getActiveConnection('granola')
    if (!conn?.api_key) return null
    const items = await extractGranolaActionItems({ userEmail, days })
    return items
  })

  await tryRun('gmail', async () => {
    const conn = await getActiveConnection('gmail')
    if (!conn?.nango_connection_id) return null
    return extractGmailActionItems({ userEmail, days })
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
        for (const sub of parent.sub_items ?? []) allFresh.push(sub)
      }
      sourcesRun.push(source)
    } catch (err) {
      console.error(`[runDigest] ${source} failed:`, err)
    }
  }

  // ─── Diff per-source and persist ─────────────────────────────────────
  let newCount = 0
  let carryoverCount = 0
  let completedCount = 0

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
      const { error } = await supabase.from('items').insert({
        user_id: userId,
        title: fresh.title,
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
        ...briefFields,
      })
      if (!error) newCount += 1
      // Ignore unique-index race (23505) — treat as carryover silently.
    }

    // Carryover — update last_seen_at
    const carryoverIds = result.carryover.map(c => c.existing.id)
    if (carryoverIds.length > 0) {
      await supabase
        .from('items')
        .update({ last_seen_at: new Date().toISOString() })
        .in('id', carryoverIds)
      carryoverCount += carryoverIds.length
    }

    // Auto-complete vanished items
    const completedIds = result.completed.map(c => c.id)
    if (completedIds.length > 0) {
      await supabase
        .from('items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          auto_completed_reason: 'source_signal_gone',
        })
        .in('id', completedIds)
      completedCount += completedIds.length
    }
  }

  return {
    sources_run: sourcesRun,
    fresh: allFresh.length,
    new: newCount,
    carryover: carryoverCount,
    completed: completedCount,
    durationMs: Date.now() - t0,
  }
}

// Morning digest — the diff engine, productionized.
//
// Runs daily at 7:00 PT (configurable via cron expression).
// Also runnable on-demand via `digest/requested` event.
//
// Flow:
//   1. Open a `runs` row.
//   2. Load current OPEN items from the DB.
//   3. For each connected source, extract fresh items.
//   4. Diff fresh vs current — produce new / carryover / completed.
//   5. Persist:
//      - new items → INSERT
//      - carryover → UPDATE last_seen_at
//      - completed → UPDATE status='completed', auto_completed_reason='source_signal_gone'
//   6. Close the `runs` row with counts.
//   7. Log everything to agent_events for the inspector.

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import { extractGranolaActionItems } from '@/lib/extract/granola'
import { extractGmailActionItems } from '@/lib/extract/gmail'
import { extractCalendarPrepItems } from '@/lib/extract/calendar'
import { extractLinearActionItems } from '@/lib/extract/linear'
import { diffSingleSource } from '@/lib/diff'
import { computeSemanticHash } from '@/lib/normalize'
import { getActiveConnection } from '@/lib/connections'
import type { ExtractedItem, Item, Source } from '@/lib/types'

const USER_ID = process.env.APP_USER_ID!
// Granola is now called directly (not via Nango). Presence of an API key
// is what enables the source — the Nango connection ID is unused.
const GRANOLA_ENABLED = !!process.env.GRANOLA_API_KEY
// Gmail goes through Nango — it's enabled once both the provider config key
// and the connection ID are set.
const GMAIL_ENABLED =
  !!process.env.NANGO_GMAIL_PROVIDER_KEY &&
  !!process.env.APP_NANGO_GMAIL_CONNECTION_ID

export const morningDigest = inngest.createFunction(
  { id: 'morning-digest', name: 'Morning digest — run the diff' },
  [
    { cron: 'TZ=America/Los_Angeles 0 7 * * *' }, // 7:00 PT daily
    { event: EVENTS.digestRequested },             // also manual
  ],
  async ({ step, event, logger }) => {
    if (!USER_ID) {
      throw new Error('APP_USER_ID is not set')
    }

    // ─── 1. Open run row ──────────────────────────────────────────────
    const run = await step.run('open-run', async () => {
      const trigger = event.name === EVENTS.digestRequested ? 'manual' : 'cron'
      const { data, error } = await supabase
        .from('runs')
        .insert({ user_id: USER_ID, trigger })
        .select('*')
        .single()
      if (error) throw error
      return data
    })
    logger.info(`opened run ${run.id}`)

    // ─── 1b. Auto-unsnooze ────────────────────────────────────────────
    // Items whose snooze window has passed come back to 'open' so they
    // reappear in today's digest. Runs before the items load so unsnoozed
    // items are part of the current set.
    await step.run('auto-unsnooze', async () => {
      const { error } = await supabase
        .from('items')
        .update({ status: 'open', snooze_until: null })
        .eq('user_id', USER_ID)
        .eq('status', 'snoozed')
        .lt('snooze_until', new Date().toISOString())
      if (error) throw error
    })

    // ─── 2. Load current open items ───────────────────────────────────
    const currentItems = (await step.run('load-current-items', async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('user_id', USER_ID)
        .in('status', ['open', 'in_progress'])
      if (error) throw error
      return data ?? []
    })) as Item[]

    // ─── 3. Run extractors ────────────────────────────────────────────
    const sourcesRun: Source[] = []
    const allFresh: ExtractedItem[] = []
    let freshCount = 0

    if (GRANOLA_ENABLED) {
      try {
        const granolaItems = await step.run('extract-granola', async () =>
          extractGranolaActionItems({
            userEmail: 'subash@sigiq.ai', // TODO(week2): load from users.email
            days: 7,
          })
        )
        // Flatten sub_items into the diff pool.
        //
        // TODO(week2): wire items.parent_id when inserting sub_items so the UI
        // can render them as nested checklists. For Week 1, sub-items carry
        // parent's title in `parent_context` which is enough for the dedupe
        // hash to distinguish them — they just won't visibly nest yet.
        for (const parent of granolaItems) {
          allFresh.push(parent)
          freshCount += 1
          for (const sub of parent.sub_items ?? []) {
            allFresh.push(sub)
            freshCount += 1
          }
        }
        sourcesRun.push('granola')
        await step.run('log-extract-completed-granola', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.completed',
            payload: { source: 'granola', count: granolaItems.length },
          })
        })
      } catch (err) {
        await step.run('log-extract-failed-granola', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.failed',
            payload: { source: 'granola', error: String(err) },
          })
        })
        logger.error('granola extraction failed', err)
      }
    }

    if (GMAIL_ENABLED) {
      try {
        const gmailItems = await step.run('extract-gmail', async () =>
          extractGmailActionItems({
            userEmail: 'subashraj411@gmail.com', // TODO(week2): load from users.email
            days: 7,
          })
        )
        // Flatten sub_items into the diff pool, same as Granola.
        for (const parent of gmailItems) {
          allFresh.push(parent)
          freshCount += 1
          for (const sub of parent.sub_items ?? []) {
            allFresh.push(sub)
            freshCount += 1
          }
        }
        sourcesRun.push('gmail')
        await step.run('log-extract-completed-gmail', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.completed',
            payload: { source: 'gmail', count: gmailItems.length },
          })
        })
      } catch (err) {
        await step.run('log-extract-failed-gmail', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.failed',
            payload: { source: 'gmail', error: String(err) },
          })
        })
        logger.error('gmail extraction failed', err)
      }
    }

    // Calendar — DB-backed connection (no env-var gate). Always tries; the
    // extractor itself throws cleanly if not connected.
    const calendarConn = await step.run('check-calendar-conn', async () => {
      const c = await getActiveConnection('calendar')
      return c?.status === 'active' && !!c.nango_connection_id
    })
    if (calendarConn) {
      try {
        const calendarItems = await step.run('extract-calendar', async () =>
          extractCalendarPrepItems({
            userEmail: 'subashraj411@gmail.com',
          })
        )
        for (const item of calendarItems) {
          allFresh.push(item)
          freshCount += 1
        }
        sourcesRun.push('calendar')
        await step.run('log-extract-completed-calendar', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.completed',
            payload: { source: 'calendar', count: calendarItems.length },
          })
        })
      } catch (err) {
        await step.run('log-extract-failed-calendar', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.failed',
            payload: { source: 'calendar', error: String(err) },
          })
        })
        logger.error('calendar extraction failed', err)
      }
    }

    // Linear — same DB-backed gate pattern as Calendar.
    const linearConn = await step.run('check-linear-conn', async () => {
      const c = await getActiveConnection('linear')
      return c?.status === 'active' && !!c.nango_connection_id
    })
    if (linearConn) {
      try {
        const linearItems = await step.run('extract-linear', async () =>
          extractLinearActionItems({
            userEmail: 'subashraj411@gmail.com',
          })
        )
        for (const item of linearItems) {
          allFresh.push(item)
          freshCount += 1
        }
        sourcesRun.push('linear')
        await step.run('log-extract-completed-linear', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.completed',
            payload: { source: 'linear', count: linearItems.length },
          })
        })
      } catch (err) {
        await step.run('log-extract-failed-linear', async () => {
          await supabase.from('agent_events').insert({
            user_id: USER_ID,
            run_id: run.id,
            kind: 'extract.failed',
            payload: { source: 'linear', error: String(err) },
          })
        })
        logger.error('linear extraction failed', err)
      }
    }

    // ─── 4. Diff per-source ───────────────────────────────────────────
    // Only diff sources that ran. If Granola was down, don't auto-complete
    // Granola items just because they're missing from a failed extract.
    let newCount = 0
    let carryoverCount = 0
    let completedCount = 0

    for (const source of sourcesRun) {
      const freshForSource = allFresh.filter(i => i.source === source)
      const result = diffSingleSource(currentItems, freshForSource, source)

      // ─── 5a. Insert new items ──────────────────────────────────────
      for (const fresh of result.newItems) {
        await step.run(`insert-new-${fresh.source}-${newCount}`, async () => {
          const semantic_hash = computeSemanticHash(
            fresh.source,
            fresh.parent_context,
            fresh.title
          )
          // If the extractor generated an inline brief (Calendar prep items),
          // persist it with the item so it's immediately visible — no backfill
          // pass needed.
          const briefFields = fresh.brief
            ? {
                brief: fresh.brief,
                brief_status: 'generated' as const,
                brief_generated_at: new Date().toISOString(),
              }
            : {}
          const { data, error } = await supabase
            .from('items')
            .insert({
              user_id: USER_ID,
              title: fresh.title,
              task_type: fresh.task_type,
              tag: fresh.tag ?? null,
              parent_context: fresh.parent_context,
              source: fresh.source,
              source_ref: fresh.source_ref,
              urgent: fresh.urgent ?? false,
              due_at: fresh.due_at ?? null,
              semantic_hash,
              ...briefFields,
            })
            .select('id')
            .single()
          if (error) {
            // Could be a race against the unique index — that's fine, treat as carryover
            if (error.code === '23505') return null
            throw error
          }
          return data
        })
        newCount += 1
      }

      // ─── 5b. Update carryover items ────────────────────────────────
      const carryoverIds = result.carryover.map(c => c.existing.id)
      if (carryoverIds.length > 0) {
        await step.run(`update-carryover-${source}`, async () => {
          const { error } = await supabase
            .from('items')
            .update({ last_seen_at: new Date().toISOString() })
            .in('id', carryoverIds)
          if (error) throw error
        })
        carryoverCount += carryoverIds.length
      }

      // ─── 5c. Auto-complete vanished items ──────────────────────────
      const completedIds = result.completed.map(c => c.id)
      if (completedIds.length > 0) {
        await step.run(`auto-complete-${source}`, async () => {
          const { error } = await supabase
            .from('items')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              auto_completed_reason: 'source_signal_gone',
            })
            .in('id', completedIds)
          if (error) throw error
        })
        completedCount += completedIds.length
        for (const item of result.completed) {
          await step.run(`log-auto-completed-${item.id}`, async () => {
            await supabase.from('agent_events').insert({
              user_id: USER_ID,
              run_id: run.id,
              kind: 'task.auto_completed',
              payload: { item_id: item.id, source },
            })
          })
        }
      }
    }

    // ─── 6. Close the run row ─────────────────────────────────────────
    await step.run('close-run', async () => {
      const { error } = await supabase
        .from('runs')
        .update({
          completed_at: new Date().toISOString(),
          sources_run: sourcesRun,
          fresh_count: freshCount,
          new_count: newCount,
          carryover_count: carryoverCount,
          completed_count: completedCount,
          status: 'succeeded',
        })
        .eq('id', run.id)
      if (error) throw error
    })

    return {
      run_id: run.id,
      sources_run: sourcesRun,
      fresh: freshCount,
      new: newCount,
      carryover: carryoverCount,
      completed: completedCount,
    }
  }
)

// ─── helpers ────────────────────────────────────────────────────────────
// Note: agent_events writes happen inline inside step.run() blocks rather
// than via a helper, so Inngest's retry semantics don't duplicate rows on
// transient failures. Step IDs must be deterministic per execution.

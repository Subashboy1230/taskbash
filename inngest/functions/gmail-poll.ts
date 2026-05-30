// Gmail incremental poll - runs every 5 minutes via Inngest cron.
// Uses Gmail's users.history.list to fetch only threads with new messages
// since the last poll, then runs the extractor on those threads only.
// This keeps Claude costs bounded vs. re-scanning all 7 days every time.

import { inngest } from '../client'
import { supabase } from '@/lib/supabase'
import { extractGmailActionItemsIncremental } from '@/lib/extract/gmail'
import { diffSingleSource } from '@/lib/diff'
import { computeSemanticHash } from '@/lib/normalize'
import { classifyAndTagFunctions } from '@/lib/classify/functions'
import { loadUserFunctions } from '@/lib/load-functions'
import { tagCallWithItems } from '@/lib/llm-trace'
import { flushLangfuse } from '@/lib/langfuse'
import type { ExtractedItem, Item } from '@/lib/types'

const USER_ID = process.env.APP_USER_ID!

export const gmailPoll = inngest.createFunction(
  { id: 'gmail-poll', name: 'Gmail incremental poll' },
  { cron: 'TZ=America/Los_Angeles */5 * * * *' }, // every 5 minutes
  async ({ step, logger }) => {
    if (!USER_ID) throw new Error('APP_USER_ID not set')

    // Load last historyId from sync state
    const syncState = await step.run('load-sync-state', async () => {
      const { data } = await supabase
        .from('gmail_sync_state')
        .select('last_history_id, last_polled_at')
        .eq('user_id', USER_ID)
        .maybeSingle()
      return data
    })

    const sinceHistoryId = syncState?.last_history_id ?? null

    // Extract new items incrementally
    const { items: freshItems, newHistoryId } = await step.run('extract-incremental', async () => {
      return extractGmailActionItemsIncremental({
        userEmail: 'subash@sigiq.ai',
        sinceHistoryId,
      })
    })

    // Update sync state cursor
    if (newHistoryId) {
      await step.run('update-sync-state', async () => {
        await supabase
          .from('gmail_sync_state')
          .upsert({
            user_id: USER_ID,
            last_history_id: newHistoryId,
            last_polled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
      })
    }

    if (freshItems.length === 0) {
      logger.info('No new Gmail items')
      return { new: 0, skipped: false }
    }

    logger.info(`Found ${freshItems.length} items from incremental poll`)

    // Load current open + recent cleared items for diff
    const currentItems = await step.run('load-current-items', async () => {
      const [openRes, clearedRes] = await Promise.all([
        supabase.from('items').select('*').eq('user_id', USER_ID).in('status', ['open', 'in_progress']),
        supabase.from('items').select('*').eq('user_id', USER_ID)
          .in('status', ['completed', 'dismissed', 'snoozed'])
          .order('updated_at', { ascending: false }).limit(100),
      ])
      return [...(openRes.data ?? []), ...(clearedRes.data ?? [])] as Item[]
    })

    // Classify function tags
    const userFunctions = await loadUserFunctions().catch(() => [])
    let classifyCallId: string | null = null
    if (userFunctions.length > 0 && freshItems.length > 0) {
      const result = await classifyAndTagFunctions({ items: freshItems, functions: userFunctions, userId: USER_ID })
      classifyCallId = result.classifyCallId
    }

    // Diff and insert
    const result = diffSingleSource(currentItems, freshItems, 'gmail')
    let newCount = 0
    const callToItemIds = new Map<string, string[]>()

    for (const fresh of result.newItems) {
      await step.run(`insert-gmail-poll-${newCount}`, async () => {
        const semantic_hash = computeSemanticHash(fresh.source, fresh.parent_context, fresh.title)
        const { data: inserted, error } = await supabase
          .from('items')
          .insert({
            user_id: USER_ID,
            title: fresh.title,
            task_type: fresh.task_type,
            tag: fresh.tag ?? null,
            parent_context: fresh.parent_context,
            subtitle: (fresh as ExtractedItem & { subtitle?: string }).subtitle ?? null,
            source: fresh.source,
            source_ref: fresh.source_ref,
            urgent: fresh.urgent ?? false,
            due_at: fresh.due_at ?? null,
            semantic_hash,
            proposed_action: fresh.proposed_action ?? null,
            source_excerpt: fresh.source_excerpt ?? null,
            function_ids: fresh.function_ids ?? [],
            extraction_meta: fresh._llm_call_id || classifyCallId ? {
              ...(fresh._llm_call_id ? { llm_call_id: fresh._llm_call_id } : {}),
              ...(classifyCallId ? { classify_call_id: classifyCallId } : {}),
            } : null,
          })
          .select('id')
          .single()
        if (error && error.code !== '23505') throw error
        return inserted
      })
      newCount++
      if (fresh._llm_call_id) {
        const list = callToItemIds.get(fresh._llm_call_id) ?? []
        list.push(fresh.source_ref.gmail_thread_id ?? '')
        callToItemIds.set(fresh._llm_call_id, list)
      }
    }

    await Promise.all(
      Array.from(callToItemIds.entries()).map(([callId, itemIds]) =>
        tagCallWithItems(callId, itemIds).catch(() => {})
      )
    )
    await flushLangfuse()

    logger.info(`Gmail poll inserted ${newCount} new items`)
    return { new: newCount, skipped: false }
  }
)

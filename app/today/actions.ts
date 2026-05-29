'use server'

// Server Actions for the /today page.
// Each one mutates Supabase + revalidates the page so the UI reflects state.

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { resolveUserId } from '@/lib/supabase-server'
import { runDigestForUser } from '@/lib/digest/run'
import { inngest, EVENTS } from '@/inngest/client'
import type { Priority } from '@/lib/types'

/**
 * Mark an item as "slop" — wrong / irrelevant / shouldn't have been
 * extracted at all. Three things happen:
 *
 *   1. Capture a snapshot of the item AS IT IS NOW into item_feedback.
 *      The snapshot is the training signal: "you extracted this exact
 *      thing, the user said this category of wrong, learn from it."
 *   2. Set status='dismissed' so the row leaves the user's list.
 *   3. /today is revalidated so the UI updates.
 *
 * Reason is one of 'irrelevant' | 'spam' | 'low_signal' | 'misread_title'
 * | 'other'. The caller can also pass a free-text note.
 */
export async function markItemSlop(
  itemId: string,
  reason: 'irrelevant' | 'spam' | 'low_signal' | 'misread_title' | 'other',
  note?: string
) {
  const userId = await resolveUserId()

  // 1. Snapshot the item so the feedback row stays anchored to what
  //    the user actually saw, even if extraction later changes it.
  const { data: item, error: readErr } = await supabase
    .from('items')
    .select('*')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle()
  if (readErr) throw new Error(`markItemSlop read failed: ${readErr.message}`)
  if (!item) throw new Error('Item not found.')

  // 2. Find the LLM call that produced this item — the extraction the
  //    user is rejecting. Fast path: items.extraction_meta.llm_call_id
  //    (set at insert time). Fallback: produced_item_ids array scan.
  type ItemWithMeta = { extraction_meta?: { llm_call_id?: string } | null }
  const fastCallId = (item as ItemWithMeta).extraction_meta?.llm_call_id
  let producingCallId: string | null = fastCallId ?? null
  if (!producingCallId) {
    const { data: producingCall } = await supabase
      .from('llm_calls')
      .select('id')
      .contains('produced_item_ids', [itemId])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    producingCallId = producingCall?.id ?? null
  }

  // 3. Insert feedback row, linked to the producing call when known.
  const { data: feedbackRow, error: feedbackErr } = await supabase
    .from('item_feedback')
    .insert({
      item_id: itemId,
      user_id: userId,
      kind: 'slop',
      reason,
      note: note ?? null,
      item_snapshot: item,
      llm_call_id: producingCallId,
    })
    .select('id')
    .single()
  if (feedbackErr) {
    throw new Error(`markItemSlop feedback insert failed: ${feedbackErr.message}`)
  }

  // 4. Auto-promote into the user's default 'slop-cases' dataset for
  //    the producing prompt — every slop becomes a negative case that
  //    the eval runner replays expecting empty output. Best-effort:
  //    failure here is logged but doesn't block the slop dismissal.
  if (producingCallId && feedbackRow?.id) {
    void (async () => {
      try {
        const { data: call } = await supabase
          .from('llm_calls')
          .select('prompt_id, request_payload, input_content')
          .eq('id', producingCallId)
          .maybeSingle()
        if (!call?.prompt_id) return

        // One dataset per prompt_id: "slop-{prompt_id}"
        const datasetName = `slop-${call.prompt_id}`
        let datasetId: string
        const { data: existing } = await supabase
          .from('eval_datasets')
          .select('id')
          .eq('user_id', userId)
          .eq('name', datasetName)
          .maybeSingle()
        if (existing) {
          datasetId = existing.id
        } else {
          const { data: newDs, error: dsErr } = await supabase
            .from('eval_datasets')
            .insert({
              user_id: userId,
              name: datasetName,
              prompt_id: call.prompt_id,
              description: `Auto-collected slop signals for ${call.prompt_id}. Each case expects empty output — a fixed prompt should skip the input that caused the slop.`,
            })
            .select('id')
            .single()
          if (dsErr || !newDs) return
          datasetId = newDs.id
        }
        await supabase.from('eval_cases').insert({
          dataset_id: datasetId,
          source: 'slop_negative',
          source_llm_call_id: producingCallId,
          source_feedback_id: feedbackRow.id,
          request_payload: call.request_payload,
          input_content:
            (call as { input_content?: unknown }).input_content ?? null,
          expected_output: '',
          expected_behavior: 'empty',
          notes: `Reason: ${reason}${note ? ` — ${note}` : ''}`,
        })
      } catch (err) {
        console.error('[markItemSlop] auto-promote to dataset failed:', err)
      }
    })()
  }

  // 3. Dismiss the item so it leaves the open list.
  const { error: dismissErr } = await supabase
    .from('items')
    .update({ status: 'dismissed' })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (dismissErr) {
    throw new Error(`markItemSlop dismiss failed: ${dismissErr.message}`)
  }

  revalidatePath('/today')
}

/**
 * Set or clear an item's priority (P0 / P1 / P2 / P3 / null). The /today
 * page sorts by priority first, so P0s float to the top.
 */
export async function setItemPriority(itemId: string, priority: Priority) {
  const { error } = await supabase
    .from('items')
    .update({ priority })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`setItemPriority failed: ${error.message}`)
  revalidatePath('/today')
}

/**
 * Add a manual subtask to a parent item. Stored as an `items` row with
 * source='manual', parent_id pointing to the parent, and a unique
 * semantic_hash so the unique index doesn't reject it. Returns the new row.
 *
 * The subtask is its own item — the same lifecycle (open / completed /
 * dismissed) applies and the morning-digest will leave it alone because
 * source='manual' isn't extracted by any source.
 */
export async function addSubtask(parentId: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Subtask title is empty.')
  // Hash includes a per-call timestamp so two identical subtask titles under
  // the same parent both insert (unique index is on user_id + semantic_hash).
  const semantic_hash = createHash('sha256')
    .update(`manual|${parentId}|${trimmed}|${Date.now()}`)
    .digest('hex')
    .slice(0, 16)
  const { data, error } = await supabase
    .from('items')
    .insert({
      user_id: await resolveUserId(),
      title: trimmed,
      task_type: 'manual',
      tag: 'action',
      source: 'manual',
      source_ref: { manual_subtask: true },
      parent_id: parentId,
      parent_context: null,
      semantic_hash,
      status: 'open',
    })
    .select('id, title, status')
    .single()
  if (error) throw new Error(`addSubtask failed: ${error.message}`)
  revalidatePath('/today')
  return data
}

/**
 * Toggle a subtask between open and completed. Thin wrapper over completeItem
 * / uncompleteItem so the UI doesn't have to branch.
 */
export async function toggleSubtaskComplete(subtaskId: string, complete: boolean) {
  const update = complete
    ? { status: 'completed', completed_at: new Date().toISOString() }
    : { status: 'open', completed_at: null }
  const { error } = await supabase
    .from('items')
    .update(update)
    .eq('id', subtaskId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`toggleSubtaskComplete failed: ${error.message}`)
  revalidatePath('/today')
}

/**
 * Delete a subtask permanently. Used by the X button next to a subtask in
 * the detail panel. (Soft-delete via status='dismissed' would also work; we
 * delete for now because subtasks the user manually added rarely deserve
 * history.)
 */
export async function deleteSubtask(subtaskId: string) {
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('id', subtaskId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`deleteSubtask failed: ${error.message}`)
  revalidatePath('/today')
}

export async function completeItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`completeItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function uncompleteItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'open', completed_at: null })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`uncompleteItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function dismissItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'dismissed' })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`dismissItem failed: ${error.message}`)
  revalidatePath('/today')
}

// Snooze an item — hides it from /today for the given number of hours
// (default 24h). The morning digest auto-unsnoozes items whose snooze
// window has passed, so they reappear on the next run.
export async function snoozeItem(itemId: string, hours: number = 24) {
  const snoozeUntil = new Date(
    Date.now() + hours * 60 * 60 * 1000
  ).toISOString()
  const { error } = await supabase
    .from('items')
    .update({ status: 'snoozed', snooze_until: snoozeUntil })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`snoozeItem failed: ${error.message}`)
  revalidatePath('/today')
}

/**
 * Approve & execute the proposed_action attached to an item. For the v1
 * Gmail flow, we return a `mailto:`-style Gmail compose URL the caller can
 * open in a new tab — the user actually clicks Send in Gmail. (v2 will
 * send directly via the Gmail API once we have gmail.send scope.)
 *
 * On success the item is marked completed. On error it stays open so the
 * user can retry from the UI.
 */
export async function executeProposedAction(
  itemId: string,
  opts: { sendDirect?: boolean } = {}
): Promise<
  | { ok: true; sent: true; messageId: string }
  | { ok: true; sent: false; openUrl: string }
  | { ok: false; error: string }
> {
  const userId = await resolveUserId()
  const { data, error } = await supabase
    .from('items')
    .select('id, proposed_action, status')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data?.proposed_action) {
    return { ok: false, error: 'No proposed action on this item.' }
  }

  const action = data.proposed_action as {
    kind: 'gmail_compose' | 'gmail_send'
    to: string[]
    cc?: string[]
    subject: string
    body: string
    in_reply_to_message_id?: string
    thread_id?: string
  }

  // Try to send directly via Gmail API. Requires the connected Gmail
  // integration to include the gmail.send scope (otherwise we get 403
  // and fall back to the compose URL).
  if (opts.sendDirect !== false) {
    const { sendGmailReply } = await import('@/lib/gmail/send')
    const sendResult = await sendGmailReply(action)
    if (sendResult.ok) {
      // Sent! Mark the item completed.
      const { error: updateErr } = await supabase
        .from('items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('user_id', userId)
      if (updateErr) return { ok: false, error: updateErr.message }
      revalidatePath('/today')
      return { ok: true, sent: true, messageId: sendResult.messageId }
    }
    // If we can't fall back (e.g. no Gmail connection at all), surface the
    // error so the user knows what to fix.
    if (!sendResult.canFallback) {
      return { ok: false, error: sendResult.error }
    }
    // Else: fall through to the compose URL flow.
  }

  // Fallback: build a Gmail compose URL pre-filled with the draft. The
  // user reviews in Gmail and clicks Send themselves.
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: action.to.join(','),
    su: action.subject,
    body: action.body,
  })
  if (action.cc?.length) params.set('cc', action.cc.join(','))
  const openUrl = `https://mail.google.com/mail/?${params.toString()}`

  // Mark the item completed — the user is committing by approving.
  const { error: updateErr } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath('/today')
  return { ok: true, sent: false, openUrl }
}

/**
 * Re-run every source extractor synchronously, run the diff, persist
 * new/carryover/completed transitions, then revalidate /today so the UI
 * shows fresh state. Used by the refresh button on /today.
 *
 * Takes ~30–60s end-to-end (each source makes a Claude call per item).
 * The caller should show a loading state for that duration.
 *
 * Notes vs. the Inngest cron path (inngest/functions/morning-digest.ts):
 *   - No runs / agent_events log writes (kept tight for round-trip)
 *   - No step.run() durability — a partial failure just retries on next click
 */
export async function requestRefresh(): Promise<
  | { ok: true; summary: { new: number; carryover: number; completed: number; sources: string[] } }
  | { ok: false; error: string }
> {
  try {
    const userId = await resolveUserId()
    // TODO(week5): load userEmail from the public.users row.
    const userEmail = 'subash@sigiq.ai'
    const summary = await runDigestForUser({ userId, userEmail })
    revalidatePath('/today')
    return {
      ok: true,
      summary: {
        new: summary.new,
        carryover: summary.carryover,
        completed: summary.completed,
        sources: summary.sources_run,
      },
    }
  } catch (err) {
    console.error('requestRefresh failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

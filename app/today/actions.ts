'use server'

// Server Actions for the /today page.
// Each one mutates Supabase + revalidates the page so the UI reflects state.

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { resolveUserId, resolveUserEmail } from '@/lib/supabase-server'
import { runDigestForUser } from '@/lib/digest/run'
import { inngest, EVENTS } from '@/inngest/client'
import type { Priority } from '@/lib/types'

async function writeTaskEvent(
  userId: string,
  itemId: string,
  kind: 'completed' | 'dismissed' | 'snoozed' | 'slop',
  payload?: Record<string, unknown>
) {
  await supabase.from('task_events').insert({
    user_id: userId,
    item_id: itemId,
    kind,
    payload: payload ?? null,
  })
  // Fire-and-forget — don't let event logging block the main action
}

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
  reason:
    | 'irrelevant'
    | 'spam'
    | 'low_signal'
    | 'not_my_focus'
    | 'misread_title'
    | 'duplicate'
    | 'should_be_subtask'
    | 'old_task'
    | 'already_cleared'
    | 'other',
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

  // 4. Push a low-quality score to the matching Langfuse trace so
  //    slopped traces show up flagged in their UI. No-op if Langfuse
  //    isn't configured.
  if (producingCallId) {
    const { scoreLangfuseSlop } = await import('@/lib/llm-trace')
    scoreLangfuseSlop(producingCallId, reason, note ?? null)
  }

  // 5. Auto-promote into the user's default 'slop-cases' dataset for
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

  // Clean up the Gmail draft if one was materialized
  const { data: slopItem } = await supabase
    .from('items')
    .select('proposed_action')
    .eq('id', itemId)
    .maybeSingle()
  const slopDraftId = (slopItem?.proposed_action as { gmail_draft_id?: string } | null)?.gmail_draft_id
  if (slopDraftId) {
    const { deleteGmailDraft } = await import('@/lib/gmail/drafts')
    void deleteGmailDraft(slopDraftId)
  }

  void writeTaskEvent(userId, itemId, 'slop', { reason, note: note ?? null })

  // 6. Record the slop signal in mem0 as a durable user-level memory.
  //    Future digests fetch this back into the classify.functions and
  //    extractor system prompts so the agent learns what you don't
  //    want surfaced. Fire-and-forget; degrades to no-op if MEM0_API_KEY
  //    is unset.
  void (async () => {
    try {
      const { recordFeedbackMemory } = await import('@/lib/memory/record')
      const itemWithFields = item as {
        title?: string
        source?: string
        parent_context?: string
      }
      await recordFeedbackMemory({
        userId,
        kind: 'slop',
        reason,
        note,
        itemTitle: itemWithFields.title ?? null,
        itemSource: itemWithFields.source ?? null,
        itemContext: itemWithFields.parent_context ?? null,
      })
    } catch (err) {
      console.error('[markItemSlop] mem0 record failed:', err instanceof Error ? err.message : err)
    }
  })()

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

/**
 * Reparent an item as a subtask of another. Sets parent_id and role='subtask',
 * clears sort_order so it doesn't appear in the top-level list.
 */
export async function makeItemSubtask(itemId: string, parentId: string) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('items')
    .update({ parent_id: parentId, role: 'subtask', sort_order: null })
    .eq('id', itemId)
    .eq('user_id', userId)
    .neq('id', parentId) // can't be its own parent
  if (error) throw new Error(`makeItemSubtask failed: ${error.message}`)
  revalidatePath('/today')
}

export async function completeItem(itemId: string) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) throw new Error(`completeItem failed: ${error.message}`)
  void writeTaskEvent(userId, itemId, 'completed')
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
  const userId = await resolveUserId()
  // Load gmail_draft_id before dismissing so we can clean up the Gmail draft
  const { data: item } = await supabase
    .from('items')
    .select('proposed_action')
    .eq('id', itemId)
    .eq('user_id', userId)
    .maybeSingle()
  const draftId = (item?.proposed_action as { gmail_draft_id?: string } | null)?.gmail_draft_id

  const { error } = await supabase
    .from('items')
    .update({ status: 'dismissed', gmail_draft_id: null })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) throw new Error(`dismissItem failed: ${error.message}`)

  if (draftId) {
    const { deleteGmailDraft } = await import('@/lib/gmail/drafts')
    void deleteGmailDraft(draftId)
  }
  void writeTaskEvent(userId, itemId, 'dismissed')
  revalidatePath('/today')
}

// Snooze an item — hides it from /today for the given number of hours
// (default 24h). The morning digest auto-unsnoozes items whose snooze
// window has passed, so they reappear on the next run.
export async function snoozeItem(itemId: string, hours: number = 24) {
  const userId = await resolveUserId()
  const snoozeUntil = new Date(
    Date.now() + hours * 60 * 60 * 1000
  ).toISOString()
  const { error } = await supabase
    .from('items')
    .update({ status: 'snoozed', snooze_until: snoozeUntil })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) throw new Error(`snoozeItem failed: ${error.message}`)
  void writeTaskEvent(userId, itemId, 'snoozed', { hours })
  revalidatePath('/today')
}

// Unsnooze an item early — flip it straight back to open from the Snoozed tab.
export async function unsnoozeItem(itemId: string) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('items')
    .update({ status: 'open', snooze_until: null })
    .eq('id', itemId)
    .eq('user_id', userId)
    .eq('status', 'snoozed')
  if (error) throw new Error(`unsnoozeItem failed: ${error.message}`)
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
  const userEmail = await resolveUserEmail(userId)
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
    gmail_draft_id?: string
    references?: string[]
  }

  // ── "Send now" path: always go through the Gmail Drafts API ────────────
  // 1. If there's already a materialized draft → send it directly.
  // 2. If there's no draft yet → create one first, then send.
  // Either way we never fall back to opening a compose URL here.
  if (opts.sendDirect !== false) {
    const { createGmailDraft, sendGmailDraft } = await import('@/lib/gmail/drafts')

    let draftId = action.gmail_draft_id

    // Create a draft on-the-fly if one doesn't exist yet, so it always
    // appears in the user's Gmail Drafts folder before being sent.
    if (!draftId) {
      try {
        const fromEmail = userEmail
        const { draftId: newDraftId } = await createGmailDraft({
          fromEmail,
          threadId: action.thread_id ?? '',
          inReplyTo: action.in_reply_to_message_id ?? '',
          references: action.references ?? [],
          to: action.to,
          cc: action.cc ?? [],
          subject: action.subject,
          body: action.body,
        })
        draftId = newDraftId
        // Persist the new draft_id so dismiss/edit paths can use it
        await supabase
          .from('items')
          .update({ proposed_action: { ...action, gmail_draft_id: draftId } })
          .eq('id', itemId)
          .eq('user_id', userId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Could not create Gmail draft: ${msg}` }
      }
    }

    try {
      const result = await sendGmailDraft(draftId)
      const { error: updateErr } = await supabase
        .from('items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          reply_outcome: 'approved',
          gmail_draft_id: null,
        })
        .eq('id', itemId)
        .eq('user_id', userId)
      if (updateErr) return { ok: false, error: updateErr.message }
      void writeTaskEvent(userId, itemId, 'completed')
      revalidatePath('/today')
      return { ok: true, sent: true, messageId: result.messageId }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 403 = missing gmail.modify scope. Fall back to opening the draft
      // in Gmail's native editor rather than showing a hard error.
      const isScopeMissing = msg.includes('403') || msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('scope')
      if (isScopeMissing && draftId) {
        const openUrl = `https://mail.google.com/mail/u/0/#drafts/${draftId}`
        revalidatePath('/today')
        return { ok: true, sent: false, openUrl }
      }
      return { ok: false, error: `Gmail send failed: ${msg}` }
    }
  }

  // ── "Open in Gmail" path: create a real draft (preserves threading),
  // then open the Gmail draft editor. Item stays open until Gmail poll
  // detects the sent message and auto-completes it.
  {
    const { createGmailDraft } = await import('@/lib/gmail/drafts')

    let draftId = action.gmail_draft_id

    if (!draftId) {
      try {
        const fromEmail = userEmail
        const { draftId: newDraftId } = await createGmailDraft({
          fromEmail,
          threadId: action.thread_id ?? '',
          inReplyTo: action.in_reply_to_message_id ?? '',
          references: action.references ?? [],
          to: action.to,
          cc: action.cc ?? [],
          subject: action.subject,
          body: action.body,
        })
        draftId = newDraftId
        await supabase
          .from('items')
          .update({ proposed_action: { ...action, gmail_draft_id: draftId } })
          .eq('id', itemId)
          .eq('user_id', userId)
      } catch (err) {
        // Draft creation failed — fall back to compose URL so the user isn't stuck
        const params = new URLSearchParams({
          view: 'cm', fs: '1',
          to: action.to.join(','),
          su: action.subject,
          body: action.body,
        })
        if (action.cc?.length) params.set('cc', action.cc.join(','))
        revalidatePath('/today')
        return { ok: true, sent: false, openUrl: `https://mail.google.com/mail/?${params.toString()}` }
      }
    }

    // Open the draft in Gmail's edit-draft view. The MIME headers already
    // contain In-Reply-To / References so threading is preserved.
    const openUrl = `https://mail.google.com/mail/u/0/#drafts/${draftId}`
    revalidatePath('/today')
    return { ok: true, sent: false, openUrl }
  }
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
  { ok: true } | { ok: false; error: string }
> {
  try {
    const userId = await resolveUserId()
    // Fire the Inngest digest event — runs out-of-band so we return instantly
    // instead of timing out after Vercel's 10s serverless limit.
    await inngest.send({
      name: EVENTS.digestRequested,
      data: { userId },
    })
    return { ok: true }
  } catch (err) {
    console.error('requestRefresh failed:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Server action wrapper around loadEventsForDate so the client-side
 * calendar column can fetch events for any day the user clicks. Returns
 * an empty list on failure (the loader already swallows errors).
 */
export async function getEventsForDateAction(yyyymmdd: string) {
  const { loadEventsForDate } = await import('@/lib/load-day-events')
  return loadEventsForDate(yyyymmdd)
}

/**
 * Server action for the calendar widget's "Retry" on today's events.
 * Unlike getEventsForDateAction, this preserves the failure flag so a
 * retry that fails again re-shows the error instead of a false "no events".
 */
export async function refreshTodayEventsAction() {
  const { loadTodayEventsResult } = await import('@/lib/load-day-events')
  return loadTodayEventsResult()
}

/**
 * Open an unread Gmail thread as a task in the detail panel.
 *
 * Flow:
 *   1. Fetch the full thread body via Nango.
 *   2. Draft a reply with draftReply().
 *   3. Upsert an item row (source='gmail', tag='reply', status='open').
 *      Uses ON CONFLICT DO NOTHING via the semantic_hash unique index so
 *      re-clicking the same thread is idempotent.
 *   4. Return the MockItem shape so the caller can open the detail panel
 *      immediately — no page reload needed.
 */
export async function openUnreadThread(args: {
  threadId: string
  latestMessageId: string
  subject: string
  fromEmail: string
  fromName: string
  snippet: string
}): Promise<{ ok: true; item: import('@/lib/mock-items').MockItem } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()
    const userEmail = await resolveUserEmail(userId)

    // ─── 1. Fetch full thread body ──────────────────────────────────────
    const { nangoProxy } = await import('@/lib/nango')
    const { getActiveConnection, NANGO_PROVIDER_KEY } = await import('@/lib/connections')
    const conn = await getActiveConnection('gmail')
    if (!conn?.nango_connection_id) return { ok: false, error: 'Gmail not connected' }

    interface GmailPart {
      mimeType?: string
      body?: { data?: string }
      parts?: GmailPart[]
    }
    interface GmailMessage {
      id: string
      snippet?: string
      internalDate?: string
      payload?: GmailPart & { headers?: Array<{ name: string; value: string }> }
    }
    interface ThreadDetail { id: string; messages?: GmailMessage[] }

    const thread = await nangoProxy<ThreadDetail>({
      providerConfigKey: NANGO_PROVIDER_KEY.gmail!,
      connectionId: conn.nango_connection_id,
      method: 'GET',
      endpoint: `/gmail/v1/users/me/threads/${args.threadId}`,
      params: { format: 'full' },
    })

    const messages = thread.messages ?? []
    const MAX_MESSAGES = 6
    const MAX_CHARS = 1500
    const recent = messages.slice(-MAX_MESSAGES)

    function extractText(part: GmailPart | undefined): string {
      if (!part) return ''
      if (part.mimeType === 'text/plain' && part.body?.data)
        return Buffer.from(part.body.data, 'base64url').toString('utf-8')
      if (part.parts) {
        const plain = part.parts.find(p => p.mimeType === 'text/plain' && p.body?.data)
        if (plain?.body?.data) return Buffer.from(plain.body.data, 'base64url').toString('utf-8')
        return part.parts.map(extractText).filter(Boolean).join('\n')
      }
      if (part.body?.data) {
        const raw = Buffer.from(part.body.data, 'base64url').toString('utf-8')
        return part.mimeType === 'text/html'
          ? raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : raw
      }
      return ''
    }

    const hdr = (msg: GmailMessage, name: string) =>
      msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

    const transcript = recent
      .map((m, i) => {
        const from = hdr(m, 'From') || 'unknown'
        const to = hdr(m, 'To') || ''
        const cc = hdr(m, 'Cc') || ''
        const date = hdr(m, 'Date') || ''
        const body = extractText(m.payload).slice(0, MAX_CHARS)
        const headerLines = [
          `From: ${from}`,
          to ? `To: ${to}` : null,
          cc ? `Cc: ${cc}` : null,
          `Date: ${date}`,
        ].filter(Boolean).join('\n')
        return `--- Message ${i + 1} ---\n${headerLines}\n${body || m.snippet || ''}`
      })
      .join('\n\n')

    const latestMessage = recent[recent.length - 1]
    const latestBody = extractText(latestMessage?.payload).slice(0, 2000)
    const sourceExcerpt = `Subject: ${args.subject}\nFrom: ${args.fromEmail}\n\n${latestBody}`

    // Find the reply-to address.
    // Rule: if Subash is in To/From of the latest message, reply to the sender.
    //       If Subash is only in Cc (bystander), reply to the actual To recipient(s)
    //       since the email wasn't addressed to Subash in the first place.
    function parseEmail(raw: string): string {
      const m = raw.match(/<([^>]+)>/)
      return m ? m[1].trim().toLowerCase() : raw.trim().toLowerCase()
    }
    function parseEmails(raw: string): string[] {
      return raw.split(',').map(s => parseEmail(s.trim())).filter(Boolean)
    }
    const userEmailLower = userEmail.toLowerCase()
    const latest = recent[recent.length - 1]
    const latestFrom = parseEmail(hdr(latest, 'From'))
    const latestTo = parseEmails(hdr(latest, 'To'))
    const latestCc = parseEmails(hdr(latest, 'Cc'))
    const userIsTo = latestTo.includes(userEmailLower)
    const userIsCcOnly = !userIsTo && latestCc.includes(userEmailLower)

    let replyToEmail = args.fromEmail
    if (userIsCcOnly) {
      // Subash is a bystander — the email was sent to someone else.
      // Reply back to the original sender (From) which is the person Subash
      // as a manager would respond to, not the direct report they were
      // writing to.
      replyToEmail = latestFrom !== userEmailLower ? latestFrom : (latestTo.find(e => e !== userEmailLower) ?? latestFrom)
    } else {
      // Normal case: Subash is in To or From. Reply to whoever last sent,
      // excluding Subash himself.
      for (const m of [...recent].reverse()) {
        const from = parseEmail(hdr(m, 'From'))
        if (from && from !== userEmailLower) {
          replyToEmail = from
          break
        }
      }
    }

    // ─── 2. Draft reply ─────────────────────────────────────────────────
    const { draftReply } = await import('@/lib/draft/reply')
    let proposedAction = null
    if (replyToEmail) {
      try {
        proposedAction = await draftReply({
          threadText: transcript,
          subject: args.subject,
          to: replyToEmail,
          threadId: args.threadId,
          messageId: args.latestMessageId,
          userName: userEmail.split('@')[0],
          userId,
          userRole: userIsCcOnly ? 'cc_only' : 'to',
        })
      } catch (err) {
        console.error('[openUnreadThread] draftReply failed:', err)
      }
    }

    // ─── 3. Upsert item to DB ────────────────────────────────────────────
    // Use thread_id in the hash to guarantee uniqueness even when subject
    // is empty or two threads share the same subject.
    const { createHash: _createHash } = await import('node:crypto')
    const semantic_hash = _createHash('sha256')
      .update(`gmail::unread::${args.threadId}`)
      .digest('hex')
      .slice(0, 16)

    // Check if this item already exists (any status — semantic_hash is unique)
    const { data: existing } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', userId)
      .eq('semantic_hash', semantic_hash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let itemRow: Record<string, unknown>
    if (existing) {
      // Already exists — re-open if it was cleared, update draft
      const updates: Record<string, unknown> = { source_excerpt: sourceExcerpt }
      if (proposedAction) updates.proposed_action = proposedAction
      if (existing.status !== 'open' && existing.status !== 'in_progress') {
        updates.status = 'open'
      }
      await supabase
        .from('items')
        .update(updates)
        .eq('id', existing.id)
        .eq('user_id', userId)
      itemRow = { ...existing, ...updates }
    } else {
      const subjectLabel = args.subject && args.subject !== '(no subject)' ? ` re: ${args.subject}` : ''
      const title = `Reply to ${args.fromName || args.fromEmail || 'sender'}${subjectLabel}`
      const { data: inserted, error: insertErr } = await supabase
        .from('items')
        .insert({
          user_id: userId,
          title,
          subtitle: args.snippet,
          task_type: 'review' as const,
          tag: 'reply' as const,
          parent_context: args.subject,
          source: 'gmail' as const,
          source_ref: {
            gmail_thread_id: args.threadId,
            gmail_message_id: args.latestMessageId,
          },
          urgent: false,
          semantic_hash,
          proposed_action: proposedAction,
          source_excerpt: sourceExcerpt,
          status: 'open' as const,
        })
        .select('*')
        .single()
      if (insertErr) {
        console.error('[openUnreadThread] insert failed:', insertErr)
        return { ok: false, error: insertErr.message }
      }
      itemRow = inserted as Record<string, unknown>
    }

    revalidatePath('/today')

    // ─── 4. Map to MockItem ──────────────────────────────────────────────
    const now = new Date()
    const firstSeen = new Date((itemRow.first_seen_at as string | undefined) ?? now.toISOString())
    const ageDays = Math.max(0, Math.floor((now.getTime() - firstSeen.getTime()) / 86400000))

    const mockItem: import('@/lib/mock-items').MockItem = {
      id: itemRow.id as string,
      title: itemRow.title as string,
      subtitle: (itemRow.subtitle as string | null) ?? null,
      task_type: (itemRow.task_type as import('@/lib/types').TaskType),
      tag: (itemRow.tag as import('@/lib/types').Tag),
      parent_context: (itemRow.parent_context as string | null) ?? null,
      status: 'open',
      source: 'gmail',
      priority: (itemRow.priority as import('@/lib/types').Priority) ?? undefined,
      urgent: !!(itemRow.urgent),
      function_ids: (itemRow.function_ids as string[] | undefined) ?? [],
      age_days: ageDays,
      due_at: (itemRow.due_at as string | null) ?? null,
      is_new_today: ageDays === 0,
      proposed_action: (itemRow.proposed_action as import('@/lib/types').ProposedAction | null) ?? null,
      source_excerpt: (itemRow.source_excerpt as string | null) ?? null,
      detail_status: proposedAction ? 'Draft ready' : 'Review needed',
      description: `From ${args.fromName} - ${args.subject}`,
      sub_items: [],
      sort_order: null,
    }

    return { ok: true, item: mockItem }
  } catch (err) {
    console.error('[openUnreadThread] failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Enrich a calendar prep item's brief with cross-source context.
 *
 * Fetches past Granola notes, Gmail threads, and Linear issues for the
 * meeting attendees, then calls Claude to produce a richer prep brief.
 * Updates the item's brief field in DB and returns the enriched brief.
 */
export async function enrichPrepItem(itemId: string): Promise<{
  ok: true
  brief: import('@/lib/prep/meeting-prep').EnrichedBrief
} | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()
    const userEmail = await resolveUserEmail(userId)

    // Load the item to get its calendar event id and metadata
    const { data: item, error: itemErr } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single()
    if (itemErr || !item) return { ok: false, error: 'Item not found' }

    const sourceRef = (item as any).source_ref ?? {}
    const eventId: string = sourceRef.google_calendar_event_id ?? ''
    if (!eventId) return { ok: false, error: 'No calendar event ID on this item' }

    // Fetch the live calendar event for attendees + description
    const { getActiveConnection, NANGO_PROVIDER_KEY } = await import('@/lib/connections')
    const { nangoProxy } = await import('@/lib/nango')
    const conn = await getActiveConnection('calendar')
    if (!conn?.nango_connection_id) return { ok: false, error: 'Calendar not connected' }

    interface CalendarEvent {
      id: string
      summary?: string
      description?: string
      start?: { dateTime?: string; date?: string }
      attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>
    }

    const event = await nangoProxy<CalendarEvent>({
      providerConfigKey: NANGO_PROVIDER_KEY.calendar!,
      connectionId: conn.nango_connection_id,
      method: 'GET',
      endpoint: `/calendar/v3/calendars/primary/events/${eventId}`,
    })

    const attendeeEmails = (event.attendees ?? [])
      .filter(a => !a.self && a.email)
      .map(a => a.email!)
    const attendeeNames = (event.attendees ?? [])
      .filter(a => !a.self)
      .map(a => a.displayName || a.email || 'unknown')

    const { generateMeetingPrepBrief } = await import('@/lib/prep/meeting-prep')
    const brief = await generateMeetingPrepBrief({
      eventId,
      eventTitle: event.summary || item.title,
      eventStart: event.start?.dateTime || event.start?.date || '',
      eventDescription: (event.description || '').replace(/<[^>]+>/g, ' ').trim(),
      attendeeEmails,
      attendeeNames,
      userEmail,
      userId,
    })

    // Persist the enriched brief
    await supabase
      .from('items')
      .update({ brief, brief_status: 'generated', brief_generated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('user_id', userId)

    revalidatePath('/today')
    return { ok: true, brief }
  } catch (err) {
    console.error('[enrichPrepItem] failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Persist a manual drag-to-reorder. Computes a new sort_order float for
 * `itemId` so it sits between `beforeId` and `afterId` (either can be null
 * for "moved to top" or "moved to bottom"). Uses midpoint insertion so we
 * never need to renumber existing rows. If the gap gets too small (<0.01)
 * we renumber all items for the user with step=1000 to reset breathing room.
 */
export async function reorderItem(
  itemId: string,
  beforeId: string | null,
  afterId: string | null
) {
  const userId = await resolveUserId()

  // Fetch the sort_order of the two neighbours (only the fields we need).
  const neighbourIds = [beforeId, afterId].filter(Boolean) as string[]
  let beforeOrder: number | null = null
  let afterOrder: number | null = null

  if (neighbourIds.length > 0) {
    const { data, error } = await supabase
      .from('items')
      .select('id, sort_order')
      .eq('user_id', userId)
      .in('id', neighbourIds)
    if (error) throw new Error(`reorderItem fetch neighbours failed: ${error.message}`)
    for (const row of data ?? []) {
      const r = row as { id: string; sort_order: number | null }
      if (r.id === beforeId) beforeOrder = r.sort_order
      if (r.id === afterId) afterOrder = r.sort_order
    }
  }

  // If a neighbour has no sort_order yet, we need the full ordered list to
  // assign virtual positions first.
  const needsBootstrap = neighbourIds.length > 0 &&
    (beforeId && beforeOrder === null) || (afterId && afterOrder === null)

  if (needsBootstrap || neighbourIds.length === 0) {
    // Load all open items in current display order to assign initial sort_orders.
    const { data: allItems, error: allErr } = await supabase
      .from('items')
      .select('id, sort_order, priority, proposed_action, due_at, first_seen_at')
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress'])
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: true, nullsFirst: false })
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('first_seen_at', { ascending: false })
    if (allErr) throw new Error(`reorderItem load all failed: ${allErr.message}`)

    const rows = (allItems ?? []) as { id: string; sort_order: number | null }[]
    // Assign sequential sort_orders (step 1000) to any that don't have one yet.
    const updates: { id: string; sort_order: number }[] = []
    let cursor = 1000
    for (const row of rows) {
      if (row.sort_order === null) {
        updates.push({ id: row.id, sort_order: cursor })
        row.sort_order = cursor
      }
      cursor += 1000
    }
    if (updates.length > 0) {
      for (const upd of updates) {
        await supabase.from('items').update({ sort_order: upd.sort_order })
          .eq('id', upd.id).eq('user_id', userId)
      }
    }
    // Re-read neighbours' sort_orders from the now-populated rows.
    for (const row of rows) {
      if (row.id === beforeId) beforeOrder = row.sort_order
      if (row.id === afterId) afterOrder = row.sort_order
    }
  }

  // Compute new sort_order via midpoint.
  let newOrder: number
  if (beforeOrder === null && afterOrder === null) {
    newOrder = 1000
  } else if (beforeOrder === null) {
    newOrder = (afterOrder as number) - 500
  } else if (afterOrder === null) {
    newOrder = (beforeOrder as number) + 500
  } else {
    newOrder = (beforeOrder + afterOrder) / 2
  }

  // If gap too small, renumber everything with step=1000 then recompute.
  const MIN_GAP = 0.01
  const gapTooSmall =
    beforeOrder !== null && afterOrder !== null &&
    Math.abs((afterOrder - beforeOrder)) < MIN_GAP * 2

  if (gapTooSmall) {
    const { data: allItems2 } = await supabase
      .from('items')
      .select('id, sort_order')
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress'])
      .order('sort_order', { ascending: true, nullsFirst: false })
    const rows2 = (allItems2 ?? []) as { id: string; sort_order: number | null }[]
    let c = 1000
    for (const row of rows2) {
      await supabase.from('items').update({ sort_order: c })
        .eq('id', row.id).eq('user_id', userId)
      if (row.id === beforeId) beforeOrder = c
      if (row.id === afterId) afterOrder = c + 1000
      c += 1000
    }
    newOrder = beforeOrder !== null && afterOrder !== null
      ? (beforeOrder + afterOrder) / 2
      : beforeOrder !== null ? (beforeOrder as number) + 500
      : afterOrder !== null ? (afterOrder as number) - 500
      : 1000
  }

  const { error } = await supabase
    .from('items')
    .update({ sort_order: newOrder })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) throw new Error(`reorderItem update failed: ${error.message}`)
  revalidatePath('/today')
}

/**
 * Update a task's title and/or description. Used by the inline edit UI in
 * the detail panel.
 */
export async function updateItemDescription(
  itemId: string,
  args: { title?: string; description?: string; due_at?: string | null }
) {
  const update: Record<string, unknown> = {}
  if (args.title !== undefined) update.title = args.title.trim()
  if (args.description !== undefined) update.parent_context = args.description.trim()
  if (args.due_at !== undefined) update.due_at = args.due_at ? new Date(args.due_at).toISOString() : null
  if (Object.keys(update).length === 0) return
  const { error } = await supabase
    .from('items')
    .update(update)
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`updateItemDescription failed: ${error.message}`)
  revalidatePath('/today')
}

/**
 * Create a manual top-level task (no parent). Same shape as addSubtask
 * but without a parent_id, so it shows up in the main Open list.
 * Optional due_at (ISO date string) and function_ids tag the new task.
 */
export async function addManualTask(args: {
  title: string
  dueAt?: string | null
  functionIds?: string[]
  priority?: string | null
  subtasks?: string[]
}) {
  const trimmed = args.title.trim()
  if (!trimmed) throw new Error('Task title is empty.')
  const userId = await resolveUserId()
  const semantic_hash = createHash('sha256')
    .update(`manual|${userId}|${trimmed}|${Date.now()}`)
    .digest('hex')
    .slice(0, 16)

  // Pin new manual tasks to the top: find the lowest existing sort_order and
  // subtract 1000. If no items exist yet, start at 1000.
  const { data: topItem } = await supabase
    .from('items')
    .select('sort_order')
    .eq('user_id', userId)
    .in('status', ['open', 'in_progress'])
    .order('sort_order', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  const topOrder = (topItem as { sort_order?: number | null } | null)?.sort_order ?? 2000
  const newSortOrder = topOrder - 1000

  const { data, error } = await supabase
    .from('items')
    .insert({
      user_id: userId,
      title: trimmed,
      task_type: 'manual',
      tag: 'action',
      source: 'manual',
      source_ref: { manual_task: true },
      semantic_hash,
      status: 'open',
      due_at: args.dueAt ?? null,
      priority: args.priority ?? null,
      sort_order: newSortOrder,
      function_ids: args.functionIds && args.functionIds.length > 0
        ? args.functionIds
        : null,
    })
    .select('id, title, status')
    .single()
  if (error) throw new Error(`addManualTask failed: ${error.message}`)

  // Insert subtasks as child rows
  const subtitles = (args.subtasks ?? []).map(s => s.trim()).filter(Boolean)
  for (const subTitle of subtitles) {
    const subHash = createHash('sha256')
      .update(`manual|${data.id}|${subTitle}|${Date.now()}`)
      .digest('hex')
      .slice(0, 16)
    await supabase.from('items').insert({
      user_id: userId,
      title: subTitle,
      task_type: 'manual',
      tag: 'action',
      source: 'manual',
      source_ref: { manual_subtask: true },
      parent_id: data.id,
      role: 'subtask',
      semantic_hash: subHash,
      status: 'open',
    })
  }

  revalidatePath('/today')
  return data
}

/**
 * Extract structured tasks from freeform text (brain dump, meeting notes,
 * pasted content) using Claude Haiku. Returns an array of task objects the
 * UI can preview before committing.
 */
export async function extractTasksFromText(args: {
  text: string
  /** Base64-encoded image (JPEG/PNG/WEBP/GIF). If provided, Claude reads the image alongside the text. */
  imageBase64?: string
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}): Promise<{ ok: true; tasks: Array<{ title: string; subtasks: string[]; due_at: string | null; priority: string | null }> } | { ok: false; error: string }> {
  try {
    const text = args.text.trim()
    if (!text && !args.imageBase64) return { ok: false, error: 'No text or image provided.' }

    const { anthropic, MODELS } = await import('@/lib/anthropic')

    type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
    const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }> = []
    if (args.imageBase64) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: args.imageMediaType ?? 'image/jpeg',
          data: args.imageBase64,
        },
      })
    }
    userContent.push({
      type: 'text',
      text: text ? `Extract tasks from:\n\n${text}` : 'Extract tasks from this image.',
    })

    const response = await anthropic.messages.create({
      model: MODELS.classifier,
      max_tokens: 1024,
      system: `You extract action items from freeform text, screenshots, or images — brain dumps, voice transcripts, meeting notes, task boards, whiteboards, or any unstructured input.

Return STRICT JSON only. No prose, no markdown fences.

Schema:
{
  "tasks": [
    {
      "title": "string. Imperative form ('Send X', 'Review Y', 'Schedule Z'). Max 80 chars.",
      "subtasks": ["string", ...],
      "due_at": "ISO 8601 date string or null",
      "priority": "P0" | "P1" | "P2" | "P3" | null
    }
  ]
}

Rules:
- Extract only concrete, actionable tasks. Skip vague intentions.
- Cap subtasks at 5 per task.
- Set priority P0 for urgent/blocking items, P1 for high-stakes, P2 for normal, P3 for low/nice-to-have. Null if unclear.
- Set due_at only when the text explicitly mentions a date or deadline. Use today's date (${new Date().toISOString().slice(0, 10)}) as reference for relative dates.
- NEVER use em-dashes in any string. Use hyphens or rewrite.
- If no actionable tasks, return { "tasks": [] }.`,
      messages: [{ role: 'user', content: userContent }],
    })

    const raw = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    const { extractJsonObject } = await import('@/lib/extract/parse')
    const parsed = JSON.parse(extractJsonObject(raw)) as { tasks?: Array<{ title: string; subtasks?: string[]; due_at?: string | null; priority?: string | null }> }
    const tasks = (parsed.tasks ?? []).map(t => ({
      title: t.title ?? '',
      subtasks: t.subtasks ?? [],
      due_at: t.due_at ?? null,
      priority: t.priority ?? null,
    })).filter(t => t.title.trim())

    return { ok: true, tasks }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' }
  }
}

/**
 * Generate a synthesized description + concrete subtasks for a task.
 * Runs on first open of the detail panel when the task has no description
 * and no subtasks yet. Uses Haiku (fast). Idempotent — if called again
 * it regenerates, which is intentional (user can refresh).
 *
 * Returns the generated description and the new subtask rows so the UI
 * can update optimistically without a full page reload.
 */
export async function generateItemDetails(itemId: string): Promise<
  | { ok: true; description: string; subtasks: Array<{ id: string; title: string; completed: boolean }> }
  | { ok: false; error: string }
> {
  try {
    const userId = await resolveUserId()

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .select('id, title, parent_context, source, tag, source_excerpt, parent_id')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single()
    if (itemErr || !item) return { ok: false, error: 'Item not found' }
    // Never generate details for subtask rows — they don't need descriptions
    // and running the generator on them caused cascading subtask creation.
    if ((item as any).parent_id) return { ok: false, error: 'is_subtask' }

    const { generateTaskDetails } = await import('@/lib/ai/task-details')
    const details = await generateTaskDetails({
      title: item.title,
      parentContext: item.parent_context ?? null,
      source: item.source,
      tag: item.tag ?? null,
      sourceExcerpt: (item as any).source_excerpt ?? null,
      userId,
    })

    // Save description
    await supabase
      .from('items')
      .update({ description: details.description })
      .eq('id', itemId)
      .eq('user_id', userId)

    // Insert subtasks as child items
    const newSubtasks: Array<{ id: string; title: string; completed: boolean }> = []
    for (const title of details.subtasks) {
      const semantic_hash = createHash('sha256')
        .update(`manual|${itemId}|${title}|${Date.now()}`)
        .digest('hex')
        .slice(0, 16)
      const { data: sub, error: subErr } = await supabase
        .from('items')
        .insert({
          user_id: userId,
          title,
          task_type: 'manual',
          tag: 'action',
          source: 'manual',
          source_ref: { manual_subtask: true, ai_generated: true },
          parent_id: itemId,
          parent_context: null,
          semantic_hash,
          status: 'open',
        })
        .select('id, title, status')
        .single()
      if (!subErr && sub) {
        newSubtasks.push({ id: sub.id, title: sub.title, completed: false })
      }
    }

    revalidatePath('/today')
    return { ok: true, description: details.description, subtasks: newSubtasks }
  } catch (err) {
    console.error('[generateItemDetails] failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Reject the agent-drafted reply attached to an item. Marks the item
 * completed with reply_outcome='rejected' so the user can distinguish
 * "I reviewed and decided not to send" from "I approved and sent".
 */
export async function rejectDraft(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      reply_outcome: 'rejected',
    })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (error) throw new Error(`rejectDraft failed: ${error.message}`)
  revalidatePath('/today')
}

'use server'

// Server Actions for the /today page.
// Each one mutates Supabase + revalidates the page so the UI reflects state.

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { resolveUserId } from '@/lib/supabase-server'
import { inngest, EVENTS } from '@/inngest/client'

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
  itemId: string
): Promise<{ ok: true; openUrl?: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('items')
    .select('id, proposed_action, status')
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data?.proposed_action) {
    return { ok: false, error: 'No proposed action on this item.' }
  }

  const action = data.proposed_action as {
    kind: string
    to: string[]
    cc?: string[]
    subject: string
    body: string
  }

  let openUrl: string | undefined
  if (action.kind === 'gmail_compose') {
    // Build a Gmail compose URL with the draft pre-filled. The user
    // reviews in Gmail and clicks Send themselves — no extra OAuth scope
    // needed for v1.
    const params = new URLSearchParams({
      view: 'cm',
      fs: '1',
      to: action.to.join(','),
      su: action.subject,
      body: action.body,
    })
    if (action.cc?.length) params.set('cc', action.cc.join(','))
    openUrl = `https://mail.google.com/mail/?${params.toString()}`
  }
  // Future: kind === 'gmail_send' calls Gmail API users.messages.send directly.

  // Mark the item completed — the user is committing by approving.
  const { error: updateErr } = await supabase
    .from('items')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('user_id', await resolveUserId())
  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath('/today')
  return { ok: true, openUrl }
}

export async function requestRefresh(): Promise<{ ok: boolean; error?: string }> {
  // A failed Inngest send must NOT crash the /today page. Catch and report.
  try {
    await inngest.send({
      name: EVENTS.digestRequested,
      data: { source: 'ui_refresh', requested_at: new Date().toISOString() },
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

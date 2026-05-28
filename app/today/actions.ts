'use server'

// Server Actions for the /today page.
// Each one mutates Supabase + revalidates the page so the UI reflects state.

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { inngest, EVENTS } from '@/inngest/client'

const USER_ID = process.env.APP_USER_ID!

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
      user_id: USER_ID,
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
    .eq('user_id', USER_ID)
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
    .eq('user_id', USER_ID)
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
    .eq('user_id', USER_ID)
  if (error) throw new Error(`completeItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function uncompleteItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'open', completed_at: null })
    .eq('id', itemId)
    .eq('user_id', USER_ID)
  if (error) throw new Error(`uncompleteItem failed: ${error.message}`)
  revalidatePath('/today')
}

export async function dismissItem(itemId: string) {
  const { error } = await supabase
    .from('items')
    .update({ status: 'dismissed' })
    .eq('id', itemId)
    .eq('user_id', USER_ID)
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
    .eq('user_id', USER_ID)
  if (error) throw new Error(`snoozeItem failed: ${error.message}`)
  revalidatePath('/today')
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

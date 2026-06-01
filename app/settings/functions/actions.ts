'use server'

// CRUD server actions for user functions. Owner-scoped via RLS +
// explicit user_id checks (defense in depth).

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { resolveUserId } from '@/lib/supabase-server'

export async function createFunction(args: {
  name: string
  color?: string | null
}) {
  const userId = await resolveUserId()
  const trimmed = args.name.trim()
  if (!trimmed) throw new Error('Function name is empty.')

  // Pick a sort_order at the end of the current list.
  const { data: last } = await supabase
    .from('user_functions')
    .select('sort_order')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (last?.sort_order ?? 0) + 10

  const { data, error } = await supabase
    .from('user_functions')
    .insert({
      user_id: userId,
      name: trimmed,
      color: args.color ?? null,
      sort_order: nextOrder,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createFunction failed: ${error.message}`)
  revalidatePath('/settings/functions')
  revalidatePath('/today')
  return data
}

export async function renameFunction(id: string, name: string) {
  const userId = await resolveUserId()
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Function name is empty.')
  const { error } = await supabase
    .from('user_functions')
    .update({ name: trimmed })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`renameFunction failed: ${error.message}`)
  revalidatePath('/settings/functions')
  revalidatePath('/today')
}

export async function setFunctionColor(id: string, color: string | null) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('user_functions')
    .update({ color })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`setFunctionColor failed: ${error.message}`)
  revalidatePath('/settings/functions')
  revalidatePath('/today')
}

/**
 * Soft delete. Existing items.function_ids references remain valid; the
 * UI just hides the function from filter rows and the manage screen.
 * If you need to actually scrub, run a DB-side update afterwards to
 * remove the id from any items.function_ids arrays.
 */
export async function deleteFunction(id: string) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('user_functions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteFunction failed: ${error.message}`)
  revalidatePath('/settings/functions')
  revalidatePath('/today')
}

/**
 * Replace the array of function_ids on an item. Called by the detail
 * panel's multi-select. Pass the FULL desired list; this isn't an
 * incremental add/remove.
 *
 * Captures user corrections vs the auto-classifier as a first-class
 * training signal:
 *   1. Diff old vs new function_ids
 *   2. If different AND the item has a classify_call_id, write a
 *      'wrong_tag' row to item_feedback with the before/after state +
 *      the classifier call that's being corrected
 *   3. Auto-promote into the corrections-classify.functions eval
 *      dataset so `npm run eval` can regression-test prompt changes
 *      against every correction the user has ever made
 */
export async function setItemFunctions(
  itemId: string,
  functionIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()

    // 1. Read the current state BEFORE updating, so we can diff.
    const { data: before, error: beforeErr } = await supabase
      .from('items')
      .select('id, title, source, source_ref, source_excerpt, parent_context, function_ids, extraction_meta')
      .eq('id', itemId)
      .eq('user_id', userId)
      .maybeSingle()
    if (beforeErr) return { ok: false, error: `Read failed: ${beforeErr.message}` }
    if (!before) return { ok: false, error: 'Item not found.' }

    // 2. Apply the update.
    const { error: updateErr } = await supabase
      .from('items')
      .update({ function_ids: functionIds })
      .eq('id', itemId)
      .eq('user_id', userId)
    if (updateErr) return { ok: false, error: updateErr.message }

    // 3. Capture the correction (fire-and-forget — failures don't block
    //    the user's edit).
    void captureFunctionCorrection({
      userId,
      item: before as ItemSnapshot,
      before: (before as { function_ids?: string[] }).function_ids ?? [],
      after: functionIds,
    })

    revalidatePath('/today')
    return { ok: true }
  } catch (err) {
    console.error('[setItemFunctions]', err)
    return { ok: false, error: 'Network error. Try again.' }
  }
}

interface ItemSnapshot {
  id: string
  title: string
  source: string
  source_ref: unknown
  source_excerpt: string | null
  parent_context: string | null
  function_ids: string[] | null
  extraction_meta: { llm_call_id?: string; classify_call_id?: string } | null
}

async function captureFunctionCorrection(args: {
  userId: string
  item: ItemSnapshot
  before: string[]
  after: string[]
}) {
  try {
    const beforeSet = new Set(args.before)
    const afterSet = new Set(args.after)
    const added = args.after.filter(id => !beforeSet.has(id))
    const removed = args.before.filter(id => !afterSet.has(id))
    if (added.length === 0 && removed.length === 0) return // no change

    const classifyCallId = args.item.extraction_meta?.classify_call_id ?? null

    // 3a. Insert the feedback row.
    const { data: feedbackRow, error: fbErr } = await supabase
      .from('item_feedback')
      .insert({
        item_id: args.item.id,
        user_id: args.userId,
        kind: 'wrong_tag',
        // 'function_added' | 'function_removed' | 'function_replaced'
        reason:
          added.length > 0 && removed.length > 0
            ? 'function_replaced'
            : added.length > 0
            ? 'function_added'
            : 'function_removed',
        note: null,
        item_snapshot: args.item,
        llm_call_id: classifyCallId,
        correction: {
          before: args.before,
          after: args.after,
          added,
          removed,
        },
      })
      .select('id')
      .single()
    if (fbErr) {
      console.error('[setItemFunctions] feedback insert failed:', fbErr.message)
      return
    }

    // 3b. Auto-promote into the corrections-classify.functions dataset.
    //     Only when we know which classifier call to attach to — without
    //     that we can't capture the original prompt + input.
    if (!classifyCallId) return

    const { data: call } = await supabase
      .from('llm_calls')
      .select('prompt_id, request_payload, input_content, response_text')
      .eq('id', classifyCallId)
      .maybeSingle()
    if (!call?.prompt_id) return

    const datasetName = `corrections-${call.prompt_id}`
    let datasetId: string
    const { data: existing } = await supabase
      .from('eval_datasets')
      .select('id')
      .eq('user_id', args.userId)
      .eq('name', datasetName)
      .maybeSingle()
    if (existing) {
      datasetId = existing.id
    } else {
      const { data: newDs, error: dsErr } = await supabase
        .from('eval_datasets')
        .insert({
          user_id: args.userId,
          name: datasetName,
          prompt_id: call.prompt_id,
          description: `User corrections to ${call.prompt_id} — every time the auto-classifier got a function tag wrong and the user fixed it. Use \`npm run eval -- --dataset ${datasetName}\` to regression-test prompt changes against these corrections.`,
        })
        .select('id')
        .single()
      if (dsErr || !newDs) {
        console.error('[setItemFunctions] dataset create failed:', dsErr?.message)
        return
      }
      datasetId = newDs.id
    }

    // Expected output: a JSON snippet showing what the classifier
    // SHOULD have returned for THIS item. We can't easily reconstruct
    // the per-batch task index after the fact, so we encode the
    // correction as a per-item assertion. `expected_behavior='contains'`
    // means the response just has to include the right tag(s).
    const expectedOutput = JSON.stringify({
      itemId: args.item.id,
      title: args.item.title,
      added,
      removed,
      correct: args.after,
    })

    const { error: caseErr } = await supabase.from('eval_cases').insert({
      dataset_id: datasetId,
      source: 'promoted_from_trace',
      source_llm_call_id: classifyCallId,
      source_feedback_id: feedbackRow.id,
      request_payload: call.request_payload,
      input_content: call.input_content,
      expected_output: expectedOutput,
      expected_behavior: 'manual_review',
      notes:
        added.length > 0
          ? `Should have tagged: ${added.join(', ')}${
              removed.length > 0 ? ` | Should NOT have tagged: ${removed.join(', ')}` : ''
            }`
          : `Should NOT have tagged: ${removed.join(', ')}`,
    })
    if (caseErr) {
      console.error('[setItemFunctions] case insert failed:', caseErr.message)
    }
  } catch (err) {
    console.error('[setItemFunctions] captureCorrection failed:', err)
  }
}

/**
 * Seed the user's starter set of functions. Idempotent — uses the
 * (user_id, name) unique constraint to skip duplicates. Called from
 * the settings page's "Seed Subash defaults" button so you don't have
 * to type them in.
 */
export async function seedDefaultFunctions(names: string[]) {
  const userId = await resolveUserId()
  let nextOrder = 10
  const { data: existing } = await supabase
    .from('user_functions')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing?.sort_order) nextOrder = existing.sort_order + 10

  const rows = names
    .map(n => n.trim())
    .filter(Boolean)
    .map(name => ({
      user_id: userId,
      name,
      sort_order: (nextOrder += 10),
    }))
  if (rows.length === 0) return
  // upsert with onConflict to silently skip duplicates.
  const { error } = await supabase
    .from('user_functions')
    .upsert(rows, { onConflict: 'user_id,name', ignoreDuplicates: true })
  if (error) throw new Error(`seedDefaultFunctions failed: ${error.message}`)
  revalidatePath('/settings/functions')
  revalidatePath('/today')
}

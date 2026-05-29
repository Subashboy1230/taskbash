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
 */
export async function setItemFunctions(itemId: string, functionIds: string[]) {
  const userId = await resolveUserId()
  const { error } = await supabase
    .from('items')
    .update({ function_ids: functionIds })
    .eq('id', itemId)
    .eq('user_id', userId)
  if (error) throw new Error(`setItemFunctions failed: ${error.message}`)
  revalidatePath('/today')
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

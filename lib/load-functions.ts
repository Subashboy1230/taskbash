// Server loader for user functions — pulled by the /today page and the
// settings page. Skips soft-deleted functions. SERVER-ONLY because it
// uses supabase-server (which uses next/headers). For the client-safe
// chip-color helper, import from ./function-color instead.

import { supabase } from './supabase'
import { resolveUserId } from './supabase-server'
import type { UserFunction } from './types'

// Re-export so any caller that already imports functionColor from this
// path keeps working — the helper now lives in a client-safe module.
export { functionColor } from './function-color'

export async function loadUserFunctions(): Promise<UserFunction[]> {
  const userId = await resolveUserId()
  const { data, error } = await supabase
    .from('user_functions')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadUserFunctions failed: ${error.message}`)
  return (data ?? []) as UserFunction[]
}

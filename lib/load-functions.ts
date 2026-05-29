// Server loader for user functions — pulled by the /today page and the
// settings page. Skips soft-deleted functions.

import { supabase } from './supabase'
import { resolveUserId } from './supabase-server'
import type { UserFunction } from './types'

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

/**
 * Deterministic chip color when a function has no explicit color set.
 * Hashes the function id to one of 8 preset hues so the same function
 * always renders the same color across sessions.
 */
const FALLBACK_COLORS = [
  '#7B68EE', // purple
  '#1D9E75', // teal
  '#D85A30', // coral
  '#0C447C', // blue
  '#993556', // pink
  '#854F0B', // amber
  '#3B6D11', // green
  '#A32D2D', // red
] as const

export function functionColor(fn: { id: string; color: string | null }): string {
  if (fn.color) return fn.color
  // Cheap deterministic hash → bucket
  let h = 0
  for (let i = 0; i < fn.id.length; i++) h = (h * 31 + fn.id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

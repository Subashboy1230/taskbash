'use server'

// Auth server actions. Keep these in a dedicated file so they're easy to
// audit — anything that mutates the session lives here.

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * Sign the current user out, clear the Supabase session cookie, and send
 * them to /login. Used by the avatar dropdown's "Sign out" button.
 */
export async function signOut() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}

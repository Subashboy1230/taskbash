// Browser-side Supabase client. Use in 'use client' components for things
// that have to run in the browser (signInWithOAuth, sign out, listening to
// auth state changes).

import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

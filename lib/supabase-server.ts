// Server-side Supabase client that reads the user's session from cookies.
// Use this in server components, server actions, and route handlers when
// you need to know WHO is calling. Uses the anon key + the user's JWT, so
// RLS policies apply.
//
// For background jobs (Inngest) and trusted server operations that need to
// bypass RLS, keep using the service-role client from lib/supabase.ts.

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — middleware will
            // refresh the session, so this is fine to swallow.
          }
        },
      },
    }
  )
}

/**
 * Return the authenticated user's id, or throw if not signed in.
 * Helper for server actions / loaders that should never run unauthenticated.
 */
export async function getCurrentUserId(): Promise<string> {
  const client = await createSupabaseServerClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

/**
 * Best-effort user id lookup:
 *   1. If we're in a request context (cookies present, user signed in) →
 *      return the auth user's id.
 *   2. Otherwise fall back to APP_USER_ID env var (Inngest jobs, scripts,
 *      and other no-session contexts).
 *
 * Use this in shared code that runs both inside server actions/components
 * (where there's a session) and inside Inngest/scripts (where there isn't).
 * Throws only when both paths fail.
 */
export async function resolveUserId(): Promise<string> {
  try {
    return await getCurrentUserId()
  } catch {
    const envId = process.env.APP_USER_ID
    if (!envId) {
      throw new Error(
        'No authenticated user and APP_USER_ID env var is not set.'
      )
    }
    return envId
  }
}

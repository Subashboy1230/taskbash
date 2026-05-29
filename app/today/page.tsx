// Server component — fetches real digest from Supabase, renders TodayView.

import { loadDigest } from '@/lib/load-digest'
import { loadUserFunctions } from '@/lib/load-functions'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { TodayView } from './today-view'

// Always fetch fresh — no Next.js static caching for this page.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const [digest, functions] = await Promise.all([
    loadDigest(),
    loadUserFunctions().catch(() => []),
  ])
  // Pull the user's email for the avatar dropdown. Best-effort: if auth is
  // somehow not in place, we still render the page (middleware should have
  // bounced anyone unauthenticated, but be defensive).
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (
    <TodayView digest={digest} userEmail={user?.email} functions={functions} />
  )
}

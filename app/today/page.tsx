// Server component — fetches real digest from Supabase, renders TodayView.

import { loadDigest } from '@/lib/load-digest'
import { TodayView } from './today-view'

// Always fetch fresh — no Next.js static caching for this page.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const digest = await loadDigest()
  return <TodayView digest={digest} />
}

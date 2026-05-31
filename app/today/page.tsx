// Server component — loads digest + functions + calendar events,
// then hands off to TodayShell which manages the right-slot state
// (detail panel vs. calendar column) so the two can't bleed together.

import { loadDigest } from '@/lib/load-digest'
import { loadUserFunctions } from '@/lib/load-functions'
import { loadTodayEvents } from '@/lib/load-day-events'
import { loadUnreadGmail } from '@/lib/load-unread-gmail'
import { getActiveConnection } from '@/lib/connections'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { TodayShell } from './today-shell'

export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const [digest, functions, events, calConn, unreadThreads] = await Promise.all([
    loadDigest(),
    loadUserFunctions().catch(() => []),
    loadTodayEvents(),
    getActiveConnection('calendar').catch(() => null),
    loadUnreadGmail().catch(() => []),
  ])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <TodayShell
      digest={digest}
      userEmail={user?.email}
      functions={functions}
      events={events}
      calendarConnected={!!calConn?.nango_connection_id}
      unreadThreads={unreadThreads}
    />
  )
}

// Server component — fetches digest + functions + today's events,
// renders the 3-column app shell (sidebar | main | calendar).

import { loadDigest } from '@/lib/load-digest'
import { loadUserFunctions } from '@/lib/load-functions'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { AppSidebar } from '@/app/_components/app-sidebar'
import { TodayView } from './today-view'
import { TodayCalendarColumn } from './today-calendar-column'

// Always fetch fresh — no Next.js static caching for this page.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const [digest, functions, events, calConn] = await Promise.all([
    loadDigest(),
    loadUserFunctions().catch(() => []),
    loadTodayEvents(),
    getActiveConnection('calendar').catch(() => null),
  ])

  // Pull the user's email for the sidebar identity card. Best-effort: if
  // auth isn't in place, we still render (middleware should have bounced
  // anyone unauthenticated, but be defensive).
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // ISO YYYY-MM-DD of every open item with a due date — drives the dot
  // on each day in the right-column month grid.
  const itemDates = digest.open_items
    .filter(i => i.due_at)
    .map(i => (i.due_at as string).slice(0, 10))

  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar
        userEmail={user?.email}
        userInitial={digest.user_initials.charAt(0)}
      />
      <main className="flex-1 px-8 pt-4 pb-16">
        <TodayView
          digest={digest}
          userEmail={user?.email}
          functions={functions}
          hideHeader
        />
      </main>
      <TodayCalendarColumn
        events={events}
        itemDates={itemDates}
        calendarConnected={!!calConn?.nango_connection_id}
      />
    </div>
  )
}

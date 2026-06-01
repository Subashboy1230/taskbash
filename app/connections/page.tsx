// /connections — manage your OAuth + API-key sources.
// Server component: loads current connections from the DB and hands them to
// the client component that owns the button interactions.

import { listUserConnections } from '@/lib/connections'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import { ConnectionsView } from './connections-view'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  const initial = (user?.email ?? 'U').charAt(0).toUpperCase()

  const [connections, events, calConn] = await Promise.all([
    userId ? listUserConnections(userId) : Promise.resolve([]),
    loadTodayEvents().catch(() => []),
    userId ? getActiveConnection('calendar', userId).catch(() => null) : Promise.resolve(null),
  ])

  return (
    <PageShell
      userEmail={user?.email ?? undefined}
      userInitial={initial}
      events={events}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <ConnectionsView
        connections={connections}
        userInitial={initial}
        userEmail={user?.email ?? undefined}
      />
    </PageShell>
  )
}

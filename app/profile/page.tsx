// /profile — placeholder. Will hold Soul/voice profile, Function defaults,
// connected sources at a glance, and personal stats.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const [events, calConn, supabase] = await Promise.all([
    loadTodayEvents().catch(() => []),
    getActiveConnection('calendar').catch(() => null),
    createSupabaseServerClient(),
  ])
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (
    <PageShell
      userEmail={user?.email ?? undefined}
      userInitial={(user?.email ?? 'U').charAt(0).toUpperCase()}
      events={events}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <h1 className="m-0 mb-2 text-[28px] font-semibold tracking-tight text-ink">
        Profile
      </h1>
      <p className="m-0 mb-6 text-[14px] text-ink-faint">
        Signed in as {user?.email ?? '-'}.
      </p>
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="m-0 text-[14px] text-ink-muted">
          Coming soon: your voice profile (Soul), function defaults, weekly
          stats, and source health at a glance.
        </p>
      </div>
    </PageShell>
  )
}

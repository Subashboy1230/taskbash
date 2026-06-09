// /network — placeholder. Will list every person you've interacted with
// via email, grouped by their organisation (derived from email domain).

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEventsResult } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'

export const dynamic = 'force-dynamic'

export default async function NetworkPage() {
  const [eventsResult, calConn, supabase] = await Promise.all([
    loadTodayEventsResult().catch(() => ({ events: [], failed: true })),
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
      events={eventsResult.events}
      eventsError={eventsResult.failed}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <h1 className="m-0 mb-2 text-[28px] font-semibold tracking-tight text-ink">
        Network
      </h1>
      <p className="m-0 mb-6 text-[14px] text-ink-faint">
        Everyone you&apos;ve exchanged email with, grouped by organisation.
      </p>
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="m-0 text-[14px] text-ink-muted">
          Coming next session. We&apos;ll scan your Gmail history once,
          extract distinct senders/recipients, derive each person&apos;s
          org from their email domain, and cache it for fast lookups.
        </p>
      </div>
    </PageShell>
  )
}

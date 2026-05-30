// /activity — placeholder. Will be a chronological timeline of recent
// runs, item completions, slop signals, and corrections — basically a
// "what happened in my agentic day" log.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
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
        Activity
      </h1>
      <p className="m-0 mb-6 text-[14px] text-ink-faint">
        A chronological feed of everything that happened today: extractions,
        completions, slop signals, function corrections.
      </p>
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="m-0 text-[14px] text-ink-muted">
          Coming soon. In the meantime, /observability shows the raw
          LLM-call feed and /handled shows completed tasks.
        </p>
      </div>
    </PageShell>
  )
}

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEventsResult } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import {
  loadAllActivity,
  loadRuns,
  loadTaskEvents,
  loadDataSourceSyncs,
  loadApprovals,
  loadRecords,
  loadEvalHealth,
} from './loaders'
import { ActivityTabs } from './activity-tabs'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    eventsResult, calConn,
    all, runs, tasks, sources, approvals, records, evalHealth,
  ] = await Promise.all([
    loadTodayEventsResult().catch(() => ({ events: [], failed: true })),
    getActiveConnection('calendar').catch(() => null),
    loadAllActivity(user.id).catch(() => []),
    loadRuns(user.id).catch(() => []),
    loadTaskEvents(user.id).catch(() => []),
    loadDataSourceSyncs(user.id).catch(() => []),
    loadApprovals(user.id).catch(() => []),
    loadRecords(user.id).catch(() => []),
    loadEvalHealth(user.id).catch(() => ({ lastCronRanAt: null, nextCronAt: null, datasets: [] })),
  ])

  const initial = user.email?.charAt(0).toUpperCase() ?? 'U'

  return (
    <PageShell
      userEmail={user.email}
      userInitial={initial}
      events={eventsResult.events}
      eventsError={eventsResult.failed}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <h1 className="m-0 mb-1 text-[28px] font-semibold tracking-tight text-ink">
        Activity
      </h1>
      <p className="m-0 mb-6 text-[14px] text-ink-muted">
        Everything taskbash has done across your automations and data sources.
      </p>
      <Suspense>
        <ActivityTabs
          all={all}
          runs={runs}
          tasks={tasks}
          sources={sources}
          approvals={approvals}
          records={records}
          evalHealth={evalHealth}
        />
      </Suspense>
    </PageShell>
  )
}

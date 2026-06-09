// /handled — "What's been handled". Chronological log of completed and
// dismissed items, grouped by day. Reachable from /today's COMPLETED TODAY
// section's "View All" link.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { loadHandled } from '@/lib/load-handled'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEventsResult } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import { StatusPill } from '@/app/_components/status-pill'
import { formatTimeOfDay } from '@/lib/format-datetime'

export const dynamic = 'force-dynamic'

export default async function HandledPage() {
  const [days, eventsResult, calConn, supabase] = await Promise.all([
    loadHandled(),
    loadTodayEventsResult().catch(() => ({ events: [], failed: true })),
    getActiveConnection('calendar').catch(() => null),
    createSupabaseServerClient(),
  ])
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const initial = (user?.email ?? 'U').charAt(0).toUpperCase()
  const total = days.reduce((s, d) => s + d.items.length, 0)

  return (
    <PageShell
      userEmail={user?.email ?? undefined}
      userInitial={initial}
      events={eventsResult.events}
      eventsError={eventsResult.failed}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <div className="mx-auto max-w-[920px]">
        <header className="mb-8">
          <Link
            href="/today"
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
          >
            <ChevronLeft size={14} />
            Back to today
          </Link>
          <h1 className="mt-2 mb-1 text-[28px] font-semibold tracking-tight text-ink">
            What&apos;s been handled
          </h1>
          <p className="m-0 text-[14px] text-ink-faint">
            Tasks completed for you. {total} total, newest first.
          </p>
        </header>

        {days.length === 0 ? (
          <div className="rounded-lg border border-line/60 bg-surface px-6 py-10 text-center">
            <p className="m-0 text-[15px] font-medium text-ink">
              Nothing handled yet
            </p>
            <p className="mt-1 text-[13px] text-ink-muted m-0">
              Tasks you complete or dismiss in <Link href="/today" className="underline hover:text-ink">today</Link> show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {days.map(day => (
              <section key={day.date_iso}>
                <div className="mb-2 flex items-baseline gap-2 border-b border-line/60 pb-1.5">
                  <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
                    {day.label}
                  </h2>
                  <span className="text-[12px] text-ink-faint">
                    {day.items.length}
                  </span>
                </div>
                <ul className="list-none p-0 m-0 divide-y divide-line/50">
                  {day.items.map(item => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-4 px-2 py-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[15px] font-semibold leading-snug text-ink">
                          {item.title}
                        </p>
                        <p className="mt-1 truncate text-[13px] text-ink-faint m-0">
                          {item.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[12px] text-ink-faint tabular-nums">
                          {formatTimeOfDay(item.completed_at)}
                        </span>
                        <StatusPill
                          kind={
                            item.status === 'dismissed'
                              ? 'rejected'
                              : item.auto_completed_reason
                              ? 'auto'
                              : 'done'
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  )
}

// /handled — "What's been handled". Chronological log of completed and
// dismissed items, grouped by day. Reachable from /today's COMPLETED TODAY
// section's "View All" link.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { loadHandled } from '@/lib/load-handled'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { AppHeader } from '@/app/_components/app-header'
import { StatusPill } from '@/app/_components/status-pill'

export const dynamic = 'force-dynamic'

export default async function HandledPage() {
  const days = await loadHandled()
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const initial = (user?.email ?? 'U').charAt(0).toUpperCase()
  const total = days.reduce((s, d) => s + d.items.length, 0)

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader userInitial={initial} userEmail={user?.email ?? undefined} />

      <main className="mx-auto max-w-[920px] px-8 pt-4 pb-16">
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
            Tasks completed for you — {total} total, newest first.
          </p>
        </header>

        {days.length === 0 ? (
          <div className="rounded-lg border border-line/60 bg-surface px-6 py-10 text-center">
            <p className="m-0 text-[15px] font-medium text-ink">
              Nothing here yet
            </p>
            <p className="mt-1 text-[13px] text-ink-muted m-0">
              Approved and auto-completed tasks land here once they ship.
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
                          {item.completed_at
                            ? new Date(item.completed_at).toLocaleTimeString(
                                'en-US',
                                { hour: 'numeric', minute: '2-digit' }
                              )
                            : ''}
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
      </main>
    </div>
  )
}

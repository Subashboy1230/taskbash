// /settings/functions — manage the user's function tags.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadUserFunctions } from '@/lib/load-functions'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import { FunctionsManager } from './functions-manager'

export const dynamic = 'force-dynamic'

export default async function FunctionsSettingsPage() {
  const [functions, events, calConn, supabase] = await Promise.all([
    loadUserFunctions(),
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
      <div className="mx-auto max-w-[700px]">
        <header className="mb-8">
          <Link
            href="/today"
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint hover:text-ink"
          >
            <ChevronLeft size={14} />
            Back to today
          </Link>
          <h1 className="mt-2 mb-1 text-[28px] font-semibold tracking-tight text-ink">
            Functions
          </h1>
          <p className="m-0 text-[14px] text-ink-faint">
            Your mental buckets for work: Product, People Ops, Hiring, etc.
            Tag any task with one or more so you can filter and group by
            function on /today.
          </p>
        </header>

        <FunctionsManager initial={functions} />
      </div>
    </PageShell>
  )
}

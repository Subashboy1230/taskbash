// /settings/functions — manage the user's function tags.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { AppHeader } from '@/app/_components/app-header'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadUserFunctions } from '@/lib/load-functions'
import { FunctionsManager } from './functions-manager'

export const dynamic = 'force-dynamic'

export default async function FunctionsSettingsPage() {
  const functions = await loadUserFunctions()
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader
        userInitial={(user?.email ?? 'U').charAt(0).toUpperCase()}
        userEmail={user?.email ?? undefined}
      />
      <main className="mx-auto max-w-[700px] px-8 pt-4 pb-16">
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
            Your mental buckets for work — Product, People Ops, Hiring, etc.
            Tag any task with one or more so you can filter and group by
            function on /today.
          </p>
        </header>

        <FunctionsManager initial={functions} />
      </main>
    </div>
  )
}

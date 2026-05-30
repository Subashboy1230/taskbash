// /network — placeholder. Will list every person you've interacted with
// via email, grouped by their organisation (derived from email domain).

import { AppSidebar } from '@/app/_components/app-sidebar'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function NetworkPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar userEmail={user?.email} />
      <main className="flex-1 px-10 pt-10 pb-16">
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
      </main>
    </div>
  )
}

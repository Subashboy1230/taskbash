// /profile — placeholder. Will hold Soul/voice profile, Function defaults,
// connected sources at a glance, and personal stats.

import { AppSidebar } from '@/app/_components/app-sidebar'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar userEmail={user?.email} />
      <main className="flex-1 px-10 pt-10 pb-16">
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
      </main>
    </div>
  )
}

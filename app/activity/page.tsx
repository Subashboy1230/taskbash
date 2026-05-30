// /activity — placeholder. Will be a chronological timeline of recent
// runs, item completions, slop signals, and corrections — basically a
// "what happened in my agentic day" log.

import { AppSidebar } from '@/app/_components/app-sidebar'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (
    <div className="flex min-h-screen bg-canvas">
      <AppSidebar userEmail={user?.email} />
      <main className="flex-1 px-10 pt-10 pb-16">
        <h1 className="m-0 mb-2 text-[28px] font-semibold tracking-tight text-ink">
          Activity
        </h1>
        <p className="m-0 mb-6 text-[14px] text-ink-faint">
          A chronological feed of everything that happened today — extractions,
          completions, slop signals, function corrections.
        </p>
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="m-0 text-[14px] text-ink-muted">
            Coming soon. In the meantime, /observability shows the raw
            LLM-call feed and /handled shows completed tasks.
          </p>
        </div>
      </main>
    </div>
  )
}

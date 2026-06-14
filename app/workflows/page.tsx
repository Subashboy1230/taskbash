// /workflows: mock UI for the agent-workflow feature.
//
// Demo-only: every interactive element is presentational. The Gmail Draft
// card renders as ENABLED to reflect the real already-shipped capability
// (lib/gmail/drafts.ts + the executeProposedAction flow on /today). Every
// other card renders as "Coming soon" with either:
//   - "Background" (taskbash runs it for you on the server)
//   - "Browser agent" (uses Cowork; clicking the card copies a Claude
//     prompt to the clipboard the user pastes into Cowork)
//
// When we wire the first non-Gmail workflow for real, this page becomes
// the place to surface its on/off toggle. Until then the buttons are
// disabled so the demo can't trigger anything that doesn't exist yet.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTodayEventsResult } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import { WorkflowsView } from './workflows-view'

export const dynamic = 'force-dynamic'

export default async function WorkflowsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  const initial = (user?.email ?? 'U').charAt(0).toUpperCase()

  // Only the calendar connection state is loaded (needed by PageShell to
  // render the right column). No workflow state is read or written.
  const [eventsResult, calConn] = await Promise.all([
    loadTodayEventsResult().catch(() => ({ events: [], failed: true })),
    userId
      ? getActiveConnection('calendar', userId).catch(() => null)
      : Promise.resolve(null),
  ])

  return (
    <PageShell
      userEmail={user?.email ?? undefined}
      userInitial={initial}
      events={eventsResult.events}
      eventsError={eventsResult.failed}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <WorkflowsView />
    </PageShell>
  )
}

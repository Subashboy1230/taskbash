import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadProfileOverview, loadVoiceProfile, loadPromptsWithSlopRates, loadStats } from '@/lib/load-profile'
import { loadTodayEvents } from '@/lib/load-day-events'
import { getActiveConnection } from '@/lib/connections'
import { PageShell } from '@/app/_components/page-shell'
import ProfileTabs from './profile-tabs'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [overview, voiceProfile, prompts, stats, events, calConn] = await Promise.all([
    loadProfileOverview(user.id),
    loadVoiceProfile(user.id),
    loadPromptsWithSlopRates(user.id),
    loadStats(user.id),
    loadTodayEvents().catch(() => []),
    getActiveConnection('calendar').catch(() => null),
  ])

  const memberSince = new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split('@')[0] ??
    'You'

  return (
    <PageShell
      userEmail={user.email}
      userInitial={displayName.charAt(0).toUpperCase()}
      events={events}
      calendarConnected={!!calConn?.nango_connection_id}
    >
      <h1 className="m-0 mb-6 text-[28px] font-semibold tracking-tight text-ink">
        Profile
      </h1>
      <ProfileTabs
        displayName={displayName}
        email={user.email ?? ''}
        memberSince={memberSince}
        overview={overview}
        voiceProfile={voiceProfile}
        prompts={prompts}
        stats={stats}
      />
    </PageShell>
  )
}

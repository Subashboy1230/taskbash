'use client'

import { useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/_components/ui/card'
import { Button } from '@/app/_components/ui/button'
import { BrandLogo } from '@/app/_components/brand-logo'
import { signOut } from '@/app/auth/actions'
import { LogOut } from 'lucide-react'

const SOURCES = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'calendar', label: 'Google Calendar' },
  { key: 'granola', label: 'Granola' },
  { key: 'linear', label: 'Linear' },
  { key: 'slack', label: 'Slack', comingSoon: true },
] as const

interface Props {
  displayName: string
  email: string
  memberSince: string
  overview: {
    openCount: number
    clearedToday: number
    draftsReady: number
    connectedSources: string[]
  }
}

export default function OverviewTab({ displayName, email, memberSince, overview }: Props) {
  const [busy, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      <Card className="bg-surface border-line">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-full text-[20px] font-semibold uppercase"
              style={{ backgroundColor: 'var(--color-avatar-bg)', color: 'var(--color-avatar-fg)' }}
            >
              {displayName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="m-0 text-[16px] font-semibold text-ink">{displayName}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-muted">{email}</p>
              <p className="m-0 mt-1 text-[12px] text-ink-faint">Member since {memberSince}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => startTransition(() => signOut())}
              className="shrink-0 text-ink-faint hover:text-ink text-[12px] gap-1.5"
            >
              <LogOut size={13} />
              {busy ? 'Signing out...' : 'Sign out'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <StatCard label="Open tasks" value={overview.openCount} />
        <StatCard label="Cleared today" value={overview.clearedToday} />
        <StatCard label="Drafts ready" value={overview.draftsReady} />
      </div>

      <Card className="bg-surface border-line">
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-[13px] font-semibold text-ink-muted uppercase tracking-wider">
            Connections
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-0">
          <ul className="space-y-2.5">
            {SOURCES.map(src => {
              const connected = overview.connectedSources.includes(src.key)
              return (
                <li key={src.key} className="flex items-center gap-3">
                  <BrandLogo brand={src.key as 'gmail' | 'calendar' | 'granola' | 'linear' | 'slack'} size={18} />
                  <span className="flex-1 text-[13px] text-ink">{src.label}</span>
                  {'comingSoon' in src && src.comingSoon ? (
                    <span className="text-[11px] text-ink-faint">Coming soon</span>
                  ) : (
                    <span
                      className="flex items-center gap-1.5 text-[12px]"
                      style={{ color: connected ? 'var(--color-success-fg)' : 'var(--color-ink-faint)' }}
                    >
                      <span
                        className="inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: connected ? 'var(--color-success-fg)' : 'var(--color-ink-faint)' }}
                      />
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex-1 bg-surface border-line">
      <CardContent className="pt-5 pb-4 px-5">
        <p className="m-0 text-[24px] font-semibold text-ink">{value}</p>
        <p className="m-0 mt-0.5 text-[12px] text-ink-faint">{label}</p>
      </CardContent>
    </Card>
  )
}

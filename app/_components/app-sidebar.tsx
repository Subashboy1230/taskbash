'use client'

// Persistent left sidebar — nav between /today, /profile, /connections,
// /activity, /network. Plus user identity at the bottom.

import { useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Home,
  LogOut,
  Network,
  Plug,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/app/auth/actions'

const NAV: Array<{
  href: string
  label: string
  icon: typeof Home
  match: (path: string) => boolean
}> = [
  { href: '/today', label: 'Home', icon: Home, match: p => p === '/today' || p === '/' },
  { href: '/profile', label: 'Profile', icon: User, match: p => p.startsWith('/profile') },
  { href: '/connections', label: 'Connections', icon: Plug, match: p => p.startsWith('/connections') },
  { href: '/activity', label: 'Activity', icon: Activity, match: p => p.startsWith('/activity') },
  { href: '/network', label: 'Network', icon: Network, match: p => p.startsWith('/network') },
]

export function AppSidebar({
  userEmail,
  userName,
  userInitial,
}: {
  userEmail?: string | null
  userName?: string | null
  userInitial?: string
}) {
  const pathname = usePathname() ?? '/'
  const [busy, startTransition] = useTransition()

  return (
    <aside className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col justify-between border-r border-line bg-canvas px-5 py-6">
      <div>
        {/* Wordmark — small, calm */}
        <Link
          href="/today"
          className="mb-10 block text-[15px] font-semibold tracking-tight text-ink hover:opacity-80"
          aria-label="taskbash home"
        >
          taskbash
        </Link>
        <nav className="space-y-1">
          {NAV.map(item => {
            const active = item.match(pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] transition-colors',
                  active
                    ? 'bg-surface-muted/60 font-medium text-ink'
                    : 'text-ink-muted hover:bg-surface-muted/30 hover:text-ink'
                )}
              >
                <Icon size={15} className={active ? 'text-ink' : 'text-ink-faint'} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* User identity + sign out */}
      <div className="space-y-2 border-t border-line/60 pt-3">
        <div className="flex items-center gap-2.5 px-1">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold uppercase"
            style={{
              backgroundColor: 'var(--color-avatar-bg)',
              color: 'var(--color-avatar-fg)',
            }}
          >
            {userInitial ?? (userEmail ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[13px] font-medium text-ink">
              {userName ?? formatNameFromEmail(userEmail) ?? 'You'}
            </p>
            <p className="m-0 truncate text-[11px] text-ink-faint">
              {userEmail ?? '—'}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => startTransition(() => signOut())}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-ink-faint hover:bg-surface-muted/40 hover:text-ink disabled:opacity-50"
        >
          <LogOut size={12} />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}

function formatNameFromEmail(email?: string | null): string | null {
  if (!email) return null
  const local = email.split('@')[0] ?? ''
  // "subash.rajaseelan" / "subash-raj" → "Subash Rajaseelan"
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

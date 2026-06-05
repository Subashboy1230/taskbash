'use client'

// Persistent left sidebar — nav between /today, /profile, /connections,
// /activity, /network. Collapsible: click the chevron at the top right
// to flip between full-width (icons + labels) and rail (icons only).
// Choice persists in localStorage.

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ChevronsLeft,
  ChevronsRight,
  Home,
  LogOut,
  Network,
  Plug,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { signOut } from '@/app/auth/actions'

// Widths tuned for a compact CoS shell.
const WIDTH_EXPANDED = 180
const WIDTH_COLLAPSED = 56

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
  // Default expanded — but hydrate from localStorage on first render so
  // the choice survives navigations + reloads.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('taskbash:sidebarCollapsed')
      if (saved === '1') setCollapsed(true)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('taskbash:sidebarCollapsed', collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  return (
    <aside
      className="sticky top-0 hidden h-screen shrink-0 flex-col justify-between border-r border-line bg-canvas transition-[width] duration-200 ease-out md:flex"
      style={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
    >
      <div className={cn(collapsed ? 'px-2 pt-5' : 'px-4 pt-5')}>
        {/* Wordmark + collapse toggle in the same row */}
        <div className="mb-8 flex items-center justify-between">
          <Link
            href="/today"
            aria-label="taskbash home"
            className={cn('shrink-0 hover:opacity-80', collapsed && 'mx-auto')}
          >
            <img
              src="/logo-new.png"
              alt="taskbash"
              width={collapsed ? 24 : 32}
              height={collapsed ? 24 : 32}
              className="block"
            />
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              aria-label="Collapse sidebar"
              title="Collapse"
              className="rounded-md p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
            >
              <ChevronsLeft size={14} />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-label="Expand sidebar"
            title="Expand"
            className="mx-auto mb-4 flex items-center justify-center rounded-md p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
          >
            <ChevronsRight size={14} />
          </button>
        )}

        <nav className="space-y-0.5">
          {NAV.map(item => {
            const active = item.match(pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md text-[13px] transition-all duration-150 ease-out',
                  collapsed
                    ? 'h-9 w-9 mx-auto justify-center px-0'
                    : 'px-2 py-1.5',
                  active
                    ? 'bg-surface-muted/60 font-medium text-ink'
                    : 'text-ink-muted hover:bg-surface-muted/30 hover:text-ink hover:translate-x-0.5'
                )}
              >
                <Icon size={15} className={active ? 'text-ink' : 'text-ink-faint'} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* User identity + sign out */}
      <div
        className={cn(
          'space-y-1.5 border-t border-line/60 pt-3 pb-4',
          collapsed ? 'px-2' : 'px-3'
        )}
      >
        <div
          className={cn(
            'flex items-center',
            collapsed ? 'justify-center' : 'gap-2.5 px-1'
          )}
          title={collapsed ? (userEmail ?? undefined) : undefined}
        >
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase"
            style={{
              backgroundColor: 'var(--color-avatar-bg)',
              color: 'var(--color-avatar-fg)',
            }}
          >
            {userInitial ?? (userEmail ?? 'U').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[12px] font-medium text-ink">
                {userName ?? formatNameFromEmail(userEmail) ?? 'You'}
              </p>
              <p className="m-0 truncate text-[10px] text-ink-faint">
                {userEmail ?? '-'}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => startTransition(() => signOut())}
          aria-label="Sign out"
          title={collapsed ? 'Sign out' : undefined}
          className={cn(
            'flex items-center rounded-md text-[11px] text-ink-faint hover:bg-surface-muted/40 hover:text-ink disabled:opacity-50',
            collapsed
              ? 'mx-auto size-8 justify-center'
              : 'w-full gap-2 px-2 py-1'
          )}
        >
          <LogOut size={12} />
          {!collapsed && <span>{busy ? 'Signing out…' : 'Sign out'}</span>}
        </button>
      </div>
    </aside>
  )
}

function formatNameFromEmail(email?: string | null): string | null {
  if (!email) return null
  const local = email.split('@')[0] ?? ''
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

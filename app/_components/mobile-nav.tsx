'use client'

// Bottom navigation for screens below md. Mirrors the sidebar entries
// but in a fixed bottom bar. Shows on mobile only.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, Home, Network, Plug, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV: Array<{
  href: string
  label: string
  icon: typeof Home
  match: (path: string) => boolean
}> = [
  { href: '/today', label: 'Home', icon: Home, match: p => p === '/today' || p === '/' },
  { href: '/profile', label: 'Profile', icon: User, match: p => p.startsWith('/profile') },
  { href: '/connections', label: 'Connect', icon: Plug, match: p => p.startsWith('/connections') },
  { href: '/activity', label: 'Activity', icon: Activity, match: p => p.startsWith('/activity') },
  { href: '/network', label: 'Network', icon: Network, match: p => p.startsWith('/network') },
]

export function MobileNav() {
  const pathname = usePathname() ?? '/'
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-line bg-canvas/95 py-1.5 backdrop-blur md:hidden"
      style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
    >
      {NAV.map(item => {
        const active = item.match(pathname)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors',
              active ? 'text-ink' : 'text-ink-faint hover:text-ink'
            )}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

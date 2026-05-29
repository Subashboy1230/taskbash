'use client'

// Shared top-bar shown on /today and /connections. Clicking the wordmark
// goes home; clicking the avatar opens a dropdown with Connections + Sign
// out. Removed the brain / bell / ⌘K affordances — they were aspirational
// and not wired to anything, so they were broken links by default.

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { LayoutGrid, LogOut, Plug } from 'lucide-react'
import { signOut } from '@/app/auth/actions'

export function AppHeader({
  userInitial,
  userEmail,
}: {
  userInitial: string
  userEmail?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, startTransition] = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <header className="flex items-center justify-between gap-3 px-6 py-3">
      <Link
        href="/today"
        aria-label="ToDoo home"
        className="text-[15px] font-semibold tracking-tight text-ink hover:opacity-80"
      >
        ToDoo
      </Link>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Account menu"
          aria-expanded={open}
          className="flex size-8 items-center justify-center rounded-full text-[12px] font-semibold uppercase transition-opacity hover:opacity-90"
          style={{
            backgroundColor: 'var(--color-avatar-bg)',
            color: 'var(--color-avatar-fg)',
          }}
        >
          {userInitial}
        </button>

        {open && (
          <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            {userEmail && (
              <div className="border-b border-line/60 px-3 py-2.5">
                <p className="m-0 truncate text-[12px] text-ink-faint">
                  Signed in as
                </p>
                <p className="m-0 truncate text-[13px] font-medium text-ink">
                  {userEmail}
                </p>
              </div>
            )}
            <Link
              href="/connections"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-surface-muted"
            >
              <Plug size={14} className="text-ink-faint" />
              Connections
            </Link>
            <Link
              href="/settings/functions"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink hover:bg-surface-muted"
            >
              <LayoutGrid size={14} className="text-ink-faint" />
              Functions
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  await signOut()
                })
              }
              className="flex w-full items-center gap-2.5 border-t border-line/60 px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-muted disabled:opacity-50"
            >
              <LogOut size={14} className="text-ink-faint" />
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

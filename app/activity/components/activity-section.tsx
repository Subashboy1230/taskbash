'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ActivityRow } from './activity-row'
import type { ActivityRow as ActivityRowData } from '../loaders'

export function ActivitySection({
  title,
  rows,
  defaultOpen = false,
  storageKey,
}: {
  title: string
  rows: ActivityRowData[]
  defaultOpen?: boolean
  storageKey: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`taskbash:activitySections:${storageKey}`)
      if (saved !== null) setOpen(saved === '1')
    } catch { /* ignore */ }
  }, [storageKey])

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(`taskbash:activitySections:${storageKey}`, next ? '1' : '0')
    } catch { /* ignore */ }
  }

  if (rows.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border border-line/60 bg-surface/40 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
          {title}
        </span>
        {open ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
      </button>
      {open && (
        <div className="border-t border-line/40">
          {rows.map(row => (
            <ActivityRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

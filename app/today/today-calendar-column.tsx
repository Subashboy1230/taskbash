'use client'

// Right-column calendar widget: month grid above, today's events below.
// Interactive:
//   - Hover any day with a dot → popover lists up to 5 task titles
//   - Click a day → calls onSelectDay(YYYY-MM-DD), shell filters main
//     list to that day's tasks (and shows a banner with Clear button)

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plug, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DayEvent } from '@/lib/load-day-events'

export interface CalendarColumnItem {
  id: string
  title: string
  due_at?: string | null
}

export function TodayCalendarColumn({
  events,
  items = [],
  calendarConnected = true,
  selectedDay = null,
  onSelectDay,
}: {
  events: DayEvent[]
  // Open items with due dates — drives the dot under each day and the
  // hover-preview list. (Pass digest.open_items from the page.)
  items?: CalendarColumnItem[]
  calendarConnected?: boolean
  // YYYY-MM-DD of the currently active day filter (or null).
  selectedDay?: string | null
  onSelectDay?: (iso: string | null) => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [viewMonth, setViewMonth] = useState(new Date(today))

  // Bucket items by their due-date day key.
  const itemsByDay = useMemo(() => {
    const m = new Map<string, CalendarColumnItem[]>()
    for (const it of items) {
      if (!it.due_at) continue
      const key = it.due_at.slice(0, 10)
      const list = m.get(key) ?? []
      list.push(it)
      m.set(key, list)
    }
    return m
  }, [items])

  // Build a 6-week grid (Sun → Sat) covering the viewed month.
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay())
  const cells: Array<{
    date: Date
    iso: string
    inMonth: boolean
    isToday: boolean
    dayItems: CalendarColumnItem[]
  }> = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const iso = isoDay(d)
    cells.push({
      date: d,
      iso,
      inMonth: d.getMonth() === viewMonth.getMonth(),
      isToday: iso === isoDay(today),
      dayItems: itemsByDay.get(iso) ?? [],
    })
  }

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas px-5 py-6 lg:flex">
      {/* Month grid */}
      <header className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold text-ink">
          {monthLabel.split(' ').map((part, i) => (
            <span key={i} className={i === 0 ? 'text-ink' : 'ml-1.5 text-accent'}>
              {part}
            </span>
          ))}
        </h2>
        <div className="flex items-center gap-1 text-ink-faint">
          <button
            aria-label="Previous month"
            onClick={() =>
              setViewMonth(
                new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
              )
            }
            className="rounded p-1 hover:bg-surface-muted hover:text-ink"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Next month"
            onClick={() =>
              setViewMonth(
                new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)
              )
            }
            className="rounded p-1 hover:bg-surface-muted hover:text-ink"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </header>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {cells.map((c, i) => (
          <DayCell
            key={i}
            cell={c}
            selected={c.iso === selectedDay}
            onClick={() => {
              // Toggle: clicking the same day clears the filter.
              if (c.dayItems.length === 0) return
              onSelectDay?.(c.iso === selectedDay ? null : c.iso)
            }}
          />
        ))}
      </div>

      {/* Today's agenda */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Today
          </p>
          {!calendarConnected && (
            <Link
              href="/connections"
              className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
            >
              <Plug size={11} />
              Connect Calendar
            </Link>
          )}
        </div>
        {events.length === 0 ? (
          <p className="m-0 rounded-md border border-dashed border-line bg-surface px-3 py-3 text-[12px] text-ink-faint">
            {calendarConnected
              ? 'No events scheduled today.'
              : 'Connect Google Calendar to see your schedule here.'}
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {events.map(e => (
              <EventCard key={e.id} event={e} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

function DayCell({
  cell,
  selected,
  onClick,
}: {
  cell: { date: Date; iso: string; inMonth: boolean; isToday: boolean; dayItems: CalendarColumnItem[] }
  selected: boolean
  onClick: () => void
}) {
  const hasItems = cell.dayItems.length > 0
  return (
    <div className="group relative flex flex-col items-center pt-1">
      <button
        type="button"
        onClick={onClick}
        disabled={!hasItems}
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-[12px] transition-colors',
          cell.isToday && !selected && 'bg-accent text-white font-semibold',
          selected && 'bg-ink text-canvas font-semibold',
          !cell.isToday && !selected && cell.inMonth && 'text-ink',
          !cell.isToday && !selected && !cell.inMonth && 'text-ink-faint',
          hasItems && !cell.isToday && !selected && 'hover:bg-surface-muted cursor-pointer',
          !hasItems && 'cursor-default'
        )}
      >
        {cell.date.getDate()}
      </button>
      <div className="mt-0.5 h-1 w-1">
        {hasItems && (
          <div
            className={cn(
              'size-1 rounded-full',
              selected ? 'bg-ink' : 'bg-accent/70'
            )}
          />
        )}
      </div>
      {/* Hover preview popover — appears below the cell when there are items */}
      {hasItems && (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-line/70 bg-surface px-3 py-2 text-left text-[12px] leading-snug text-ink shadow-lg opacity-0 transition-opacity group-hover:opacity-100"
          role="tooltip"
        >
          <p className="m-0 mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {cell.dayItems.length} item{cell.dayItems.length === 1 ? '' : 's'} due
          </p>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {cell.dayItems.slice(0, 5).map(it => (
              <li key={it.id} className="truncate">
                · {it.title}
              </li>
            ))}
            {cell.dayItems.length > 5 && (
              <li className="text-ink-faint">+{cell.dayItems.length - 5} more</li>
            )}
          </ul>
          <p className="m-0 mt-1.5 text-[10px] text-ink-faint">Click day to filter list</p>
        </div>
      )}
    </div>
  )
}

function EventCard({ event }: { event: DayEvent }) {
  const timeLabel = event.isAllDay
    ? 'All day'
    : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}`
  return (
    <li>
      <div className="rounded-md bg-accent-soft/60 px-3 py-2 ring-1 ring-accent/15">
        <p className="m-0 text-[13px] font-medium leading-snug text-ink">
          {event.summary}
        </p>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span>{timeLabel}</span>
          {event.hangoutLink && (
            <a
              href={event.hangoutLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              <Video size={10} />
              Join
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

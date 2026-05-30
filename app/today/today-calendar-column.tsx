'use client'

// Right-column calendar widget: month grid above, today's events below.
// Month grid is purely visual for now (current month, today highlighted,
// dot on every day that has an item in the digest). Daily agenda lives
// below and is server-fed via the events prop.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plug, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DayEvent } from '@/lib/load-day-events'

export function TodayCalendarColumn({
  events,
  itemDates = [],
  calendarConnected = true,
}: {
  events: DayEvent[]
  // ISO YYYY-MM-DD strings of every day in the next ~60 days that has a
  // task due. Drives the dot under each day in the month grid.
  itemDates?: string[]
  calendarConnected?: boolean
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [viewMonth, setViewMonth] = useState(new Date(today))

  const itemDateSet = new Set(itemDates)

  // Build a 6-week grid (Sun → Sat) covering the viewed month.
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay())
  const cells: Array<{
    date: Date
    inMonth: boolean
    isToday: boolean
    hasItems: boolean
  }> = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    const iso = isoDay(d)
    cells.push({
      date: d,
      inMonth: d.getMonth() === viewMonth.getMonth(),
      isToday: isoDay(d) === isoDay(today),
      hasItems: itemDateSet.has(iso),
    })
  }

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas px-5 py-6 lg:flex">
      {/* Month grid */}
      <header className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold text-ink">
          {monthLabel.split(' ').map((part, i) => (
            <span
              key={i}
              className={i === 0 ? 'text-ink' : 'ml-1.5 text-accent'}
            >
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
          <div key={i} className="flex flex-col items-center pt-1">
            {c.isToday ? (
              <div className="flex size-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-white">
                {c.date.getDate()}
              </div>
            ) : (
              <div
                className={cn(
                  'flex size-7 items-center justify-center text-[12px]',
                  c.inMonth ? 'text-ink' : 'text-ink-faint'
                )}
              >
                {c.date.getDate()}
              </div>
            )}
            <div className="mt-0.5 h-1 w-1">
              {c.hasItems && (
                <div className="size-1 rounded-full bg-accent/70" />
              )}
            </div>
          </div>
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

function EventCard({ event }: { event: DayEvent }) {
  const timeLabel = event.isAllDay
    ? 'All day'
    : `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ''}`
  // Soft-blue accent block — Apple Calendar style.
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

'use client'

// Right-column calendar widget: month grid above, today's events below.
// Interactive:
//   - Hover any day with a dot → popover lists up to 5 task titles
//   - Click any day → calls onSelectDay(YYYY-MM-DD); shell filters main
//     list to that day's tasks (and shows a banner with Clear button)
//   - Collapsible via the chevron in the header. Persisted in
//     localStorage under `taskbash:calendarCollapsed`.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plug,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/app/_components/ui/card'
import type { DayEvent } from '@/lib/load-day-events'
import { getEventsForDateAction } from './actions'

export interface CalendarColumnItem {
  id: string
  title: string
  due_at?: string | null
}

const COLLAPSED_KEY = 'taskbash:calendarCollapsed'

export function TodayCalendarColumn({
  events,
  items = [],
  calendarConnected = true,
  selectedDay = null,
  onSelectDay,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: {
  events: DayEvent[]
  // Open items with due dates — drives the dot under each day and the
  // hover-preview list. (Pass digest.open_items from the page.)
  items?: CalendarColumnItem[]
  calendarConnected?: boolean
  // YYYY-MM-DD of the currently active day filter (or null).
  selectedDay?: string | null
  onSelectDay?: (iso: string | null) => void
  // Controlled collapse state. When the shell controls collapse it can
  // expand the main task column to fill the freed space.
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = isoDay(today)
  const [viewMonth, setViewMonth] = useState(new Date(today))

  // Collapse/expand. Default expanded; hydrate from localStorage on mount.
  // When `collapsed` prop is passed we treat this component as controlled
  // and skip the internal state. Persistence to localStorage is owned by
  // whichever side actually holds the state.
  const [collapsedInternal, setCollapsedInternal] = useState(false)
  const isControlled = typeof collapsedProp === 'boolean'
  const collapsed = isControlled ? collapsedProp : collapsedInternal
  const setCollapsed = (next: boolean) => {
    if (isControlled) {
      onToggleCollapsed?.()
    } else {
      setCollapsedInternal(next)
    }
  }
  useEffect(() => {
    if (isControlled) return
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY)
      if (saved === '1') setCollapsedInternal(true)
    } catch {
      /* localStorage unavailable */
    }
  }, [isControlled])
  useEffect(() => {
    if (isControlled) return
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsedInternal ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsedInternal, isControlled])

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
      isToday: iso === todayIso,
      dayItems: itemsByDay.get(iso) ?? [],
    })
  }

  const monthLabel = viewMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  // Header for the events section. Shows "TODAY" by default; switches
  // to the selected day's short label when the user picks a date.
  const eventsHeader = useMemo(() => {
    if (!selectedDay || selectedDay === todayIso) return 'Today'
    const [y, m, d] = selectedDay.split('-').map(Number)
    const sel = new Date(y, m - 1, d)
    return sel.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }, [selectedDay, todayIso])

  const isShowingToday = !selectedDay || selectedDay === todayIso

  // Collapsed rail — just a thin column with an expand chevron.
  if (collapsed) {
    return (
      <aside className="sticky top-0 hidden h-screen w-9 shrink-0 flex-col items-center border-l border-line bg-canvas py-4 lg:flex">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand calendar"
          title="Expand calendar"
          className="rounded-md p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <ChevronsLeft size={14} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 flex-col border-l border-line bg-canvas px-5 py-6 lg:flex">
      {/* Month grid */}
      <header className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold text-ink">
          {monthLabel.split(' ').map((part, i) => (
            <span key={i} className={i === 0 ? 'text-ink' : 'ml-1.5 text-ink-muted'}>
              {part}
            </span>
          ))}
        </h2>
        <div className="flex items-center gap-0.5 text-ink-faint">
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
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse calendar"
            title="Collapse calendar"
            className="ml-1 rounded p-1 hover:bg-surface-muted hover:text-ink"
          >
            <ChevronsRight size={14} />
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
              // Allow clicking ANY in-month day — the events section
              // below reflects the selection even if no tasks are due.
              onSelectDay?.(c.iso === selectedDay ? null : c.iso)
            }}
          />
        ))}
      </div>

      {/* Day-specific events panel.
          Wrapped in a Card to visually separate it from the grid. */}
      <Card className="mt-6 bg-surface/40">
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
          <CardTitle className="m-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {eventsHeader}
          </CardTitle>
          {!calendarConnected && (
            <Link
              href="/connections"
              className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
            >
              <Plug size={11} />
              Connect Calendar
            </Link>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-1">
          {!isShowingToday ? (
            <SelectedDaySection
              selectedIso={selectedDay!}
              dayItems={itemsByDay.get(selectedDay!) ?? []}
            />
          ) : events.length === 0 ? (
            <p className="m-0 rounded-md border border-dashed border-line bg-canvas/60 px-3 py-3 text-[12px] text-ink-faint">
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
        </CardContent>
      </Card>
    </aside>
  )
}

function SelectedDaySection({
  selectedIso,
  dayItems,
}: {
  selectedIso: string
  dayItems: CalendarColumnItem[]
}) {
  // Fetch Google Calendar events for the picked day on demand. The
  // server action wraps loadEventsForDate, which uses the same Nango
  // proxy as the today loader. Errors are swallowed there, so we just
  // see an empty list.
  const [dayEvents, setDayEvents] = useState<DayEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDayEvents([])
    getEventsForDateAction(selectedIso)
      .then(evts => {
        if (cancelled) return
        setDayEvents(evts)
      })
      .catch(() => {
        if (cancelled) return
        setDayEvents([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedIso])

  const hasEvents = dayEvents.length > 0
  const hasTasks = dayItems.length > 0

  return (
    <div className="space-y-3">
      {/* Events for the selected day (top). */}
      <section>
        <p className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Events
        </p>
        {loading ? (
          <p className="m-0 rounded-md border border-dashed border-line bg-canvas/60 px-3 py-3 text-[12px] text-ink-faint">
            Loading events...
          </p>
        ) : hasEvents ? (
          <ul className="m-0 list-none space-y-2 p-0">
            {dayEvents.map(e => (
              <EventCard key={e.id} event={e} />
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-md border border-dashed border-line bg-canvas/60 px-3 py-3 text-[12px] text-ink-faint">
            No calendar events on this day.
          </p>
        )}
      </section>

      {/* Tasks due on the selected day (bottom). */}
      <section>
        <p className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Tasks due
        </p>
        {hasTasks ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {dayItems.map(it => (
              <li
                key={it.id}
                className="truncate rounded-md border border-line/60 bg-canvas/60 px-2.5 py-1.5 text-[12px] text-ink"
                title={it.title}
              >
                {it.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-md border border-dashed border-line bg-canvas/60 px-3 py-3 text-[12px] text-ink-faint">
            No tasks due on this day.
          </p>
        )}
      </section>
    </div>
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
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-[12px] transition-colors',
          // Today (not selected) — solid white circle with DARK text so the number reads.
          cell.isToday && !selected && 'bg-accent text-canvas font-semibold',
          // Selected (not today) — outlined ring, transparent bg, number stays visible.
          selected && !cell.isToday && 'ring-2 ring-ink ring-inset text-ink font-semibold',
          // Today AND selected — solid white circle + outer ring so both states read.
          selected && cell.isToday && 'bg-accent text-canvas font-semibold ring-2 ring-ink ring-offset-1 ring-offset-canvas',
          !cell.isToday && !selected && cell.inMonth && 'text-ink',
          !cell.isToday && !selected && !cell.inMonth && 'text-ink-faint',
          !cell.isToday && !selected && 'hover:bg-surface-muted cursor-pointer'
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
          className="pointer-events-none absolute left-1/2 top-full z-[60] mt-1 w-56 -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[12px] leading-snug text-ink shadow-2xl opacity-0 transition-opacity group-hover:opacity-100"
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

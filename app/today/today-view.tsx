'use client'

// Day 3.5 — Nummo-inspired but differentiated.
// Differentiators:
//   1. No bottom chat bar
//   2. Color-coded tag pills + tag-colored left border (scannable at a glance)
//   3. Subtasks visible inline, interactive checkboxes that strike through
//   4. Source icon prominent on every task
//   5. Stats row inline ("2 new · 2 carried · 4 cleared · 1 overdue")
//   6. Cmd+K hint (keyboard-driven, not chat-driven)
//   7. Smart deadline display ("Overdue 15h" / "Due in 5h" / "Due tomorrow" / "Due Friday")
//   8. Mark-as-done strikes through the parent task and fades it

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Edit3,
  ExternalLink,
  History,
  Layers,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppHeader } from '@/app/_components/app-header'
import { BrandLogo } from '@/app/_components/brand-logo'
import { StatusPill, type StatusPillKind } from '@/app/_components/status-pill'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { Priority, ProposedAction, Source, Tag, TaskBrief } from '@/lib/types'
import {
  addSubtask,
  completeItem,
  deleteSubtask,
  dismissItem,
  executeProposedAction,
  requestRefresh,
  setItemPriority,
  snoozeItem,
  toggleSubtaskComplete,
  uncompleteItem,
} from './actions'

// ─── Top-level layout ───────────────────────────────────────────────────

export function TodayView({
  digest,
  userEmail,
}: {
  digest: MockDigestSummary
  userEmail?: string
}) {
  const [selectedItem, setSelectedItem] = useState<MockItem | null>(null)
  const [tab, setTab] = useState<'open' | 'prep' | 'cleared'>('open')
  // Filter chips — null = "All". Persist in localStorage so the user's
  // filter survives a reload.
  const [sourceFilter, setSourceFilter] = useState<Source | null>(null)
  const [tagFilter, setTagFilter] = useState<NonNullable<Tag> | null>(null)
  const [groupBy, setGroupBy] = useState<'none' | 'source' | 'due'>('none')
  const [isRefreshing, startRefresh] = useTransition()
  const router = useRouter()

  // Hydrate filter + group selections from localStorage on mount, then
  // persist whenever they change. Wrapped in a no-throw try so SSR is fine.
  useEffect(() => {
    try {
      const savedSource = localStorage.getItem('todoo:sourceFilter')
      if (savedSource && savedSource !== 'null') setSourceFilter(savedSource as Source)
      const savedTag = localStorage.getItem('todoo:tagFilter')
      if (
        savedTag === 'reply' ||
        savedTag === 'action' ||
        savedTag === 'commit' ||
        savedTag === 'fyi'
      ) {
        setTagFilter(savedTag)
      }
      const savedGroup = localStorage.getItem('todoo:groupBy')
      if (savedGroup === 'source' || savedGroup === 'due' || savedGroup === 'none') {
        setGroupBy(savedGroup)
      }
    } catch {
      /* localStorage unavailable — fine */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('todoo:sourceFilter', sourceFilter ?? 'null')
      localStorage.setItem('todoo:tagFilter', tagFilter ?? 'null')
      localStorage.setItem('todoo:groupBy', groupBy)
    } catch {
      /* ignore */
    }
  }, [sourceFilter, tagFilter, groupBy])

  // Items the user just dismissed/completed — hide them locally before revalidate lands
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  function handleComplete(id: string) {
    setHiddenIds(s => new Set(s).add(id))
    completeItem(id).catch(() => {
      // revert on error
      setHiddenIds(s => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  }
  function handleDismiss(id: string) {
    setHiddenIds(s => new Set(s).add(id))
    dismissItem(id).catch(() => {
      setHiddenIds(s => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  }
  function handleSnooze(id: string) {
    setHiddenIds(s => new Set(s).add(id))
    snoozeItem(id).catch(() => {
      setHiddenIds(s => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  }
  const [refreshError, setRefreshError] = useState<string | null>(null)

  function handleRefresh() {
    setRefreshError(null)
    startRefresh(async () => {
      const result = await requestRefresh()
      if (!result.ok) {
        setRefreshError(result.error || 'Refresh failed')
        return
      }
      // Server already revalidated /today; trigger a client re-fetch.
      router.refresh()
    })
  }

  const allVisible = digest.open_items.filter(i => !hiddenIds.has(i.id))
  // Split prep tasks (Calendar prep briefs — task_type='context_prep' or
  // titles literally starting with "Prep:") out of the main Open list so
  // the user can focus on real action items without 10 meeting briefs
  // crowding the page.
  const isPrep = (i: MockItem) =>
    i.task_type === 'context_prep' || /^prep:/i.test(i.title)
  const visibleOpen = allVisible.filter(i => !isPrep(i))
  const visiblePrep = allVisible.filter(isPrep)

  // Which sources actually appear in this digest — drives the chip row so
  // we don't show "Linear" as a filter option when there's no Linear data.
  const availableSources = useMemo(() => {
    const set = new Set<Source>()
    for (const it of digest.open_items) set.add(it.source)
    return Array.from(set)
  }, [digest.open_items])

  // Same idea for tags — only show chips for tags that actually exist in
  // the current digest.
  const availableTags = useMemo(() => {
    const set = new Set<NonNullable<Tag>>()
    for (const it of digest.open_items) {
      if (it.tag) set.add(it.tag)
    }
    return Array.from(set)
  }, [digest.open_items])

  // Apply source+tag filter to the open list. Cleared tab is unfiltered for
  // now (small enough that it doesn't need it; can revisit if it grows).
  const filteredOpen = useMemo(() => {
    let out = visibleOpen
    if (sourceFilter) out = out.filter(i => i.source === sourceFilter)
    if (tagFilter) out = out.filter(i => i.tag === tagFilter)
    return out
  }, [visibleOpen, sourceFilter, tagFilter])

  const groups = useMemo(() => groupItems(filteredOpen, groupBy), [filteredOpen, groupBy])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        // future: open command palette
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader
        userInitial={digest.user_initials.charAt(0)}
        userEmail={userEmail}
      />

      <div className="flex">
        <main
          className={cn(
            'mx-auto px-8 pt-4 pb-16 transition-all duration-200',
            selectedItem ? 'max-w-[680px]' : 'max-w-[920px] flex-1'
          )}
        >
          <h1 className="m-0 mb-4 text-[28px] font-semibold tracking-tight text-ink">
            {digest.greeting}
          </h1>

          <CalendarStrip
            dateIso={digest.date_iso}
            itemsWithDueDates={digest.open_items}
          />

          {/* Tabs: Open / Cleared */}
          <div className="mt-7 flex items-center justify-between border-b border-line">
            <div className="flex gap-6">
              <TabButton
                active={tab === 'open'}
                onClick={() => setTab('open')}
                count={visibleOpen.length}
              >
                Open
              </TabButton>
              <TabButton
                active={tab === 'prep'}
                onClick={() => setTab('prep')}
                count={visiblePrep.length}
              >
                Prep
              </TabButton>
              <TabButton
                active={tab === 'cleared'}
                onClick={() => setTab('cleared')}
                count={digest.completed_today_count}
              >
                Cleared today
              </TabButton>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh"
              className="mb-1.5 rounded-full p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40"
              title="Re-pull latest items from your sources"
            >
              {isRefreshing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          </div>

          {refreshError && (
            <div className="mt-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
              Refresh failed: {refreshError}
            </div>
          )}

          {tab === 'prep' ? (
            <PrepTab
              items={visiblePrep}
              selectedId={selectedItem?.id}
              onSelect={setSelectedItem}
              onComplete={handleComplete}
              onDismiss={handleDismiss}
              onSnooze={handleSnooze}
            />
          ) : tab === 'open' ? (
            <>
              {/* Filter chips + Group by */}
              <FilterBar
                availableSources={availableSources}
                sourceFilter={sourceFilter}
                onSourceChange={setSourceFilter}
                availableTags={availableTags}
                tagFilter={tagFilter}
                onTagChange={setTagFilter}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
              />

              {filteredOpen.length === 0 ? (
                sourceFilter || tagFilter ? (
                  <FilterEmpty
                    source={sourceFilter}
                    tag={tagFilter}
                    onClear={() => {
                      setSourceFilter(null)
                      setTagFilter(null)
                    }}
                  />
                ) : (
                  <EmptyState />
                )
              ) : (
                <div className="mt-4 space-y-6">
                  {groups.map(group => (
                    <section key={group.key}>
                      {group.label && (
                        <h2 className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                          {group.icon}
                          {group.label}
                          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-muted normal-case tracking-normal">
                            {group.items.length}
                          </span>
                        </h2>
                      )}
                      <ul className="list-none p-0 m-0 divide-y divide-line/70">
                        {group.items.map(item => (
                          <TaskRow
                            key={item.id}
                            item={item}
                            isSelected={selectedItem?.id === item.id}
                            onSelect={() => setSelectedItem(item)}
                            onComplete={() => handleComplete(item.id)}
                            onDismiss={() => handleDismiss(item.id)}
                            onSnooze={() => handleSnooze(item.id)}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ClearedTab
              items={digest.completed_today}
              totalCount={digest.completed_today_count}
            />
          )}
        </main>

        {selectedItem && (
          <DetailPanel
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onComplete={() => handleComplete(selectedItem.id)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Calendar strip ─────────────────────────────────────────────────────

function CalendarStrip({
  dateIso,
  itemsWithDueDates,
}: {
  dateIso: string
  itemsWithDueDates: { due_at?: string | null; title?: string }[]
}) {
  // The page's "today" anchor — never changes. Used to highlight today's
  // number even when the user is viewing a different week.
  const [todayY, todayM, todayD] = dateIso.split('-').map(Number)
  const todayDate = new Date(todayY, todayM - 1, todayD)

  // weekOffset = how many weeks away from this week we're viewing.
  // 0 = current, -1 = last week, 1 = next week, etc.
  const [weekOffset, setWeekOffset] = useState(0)

  const dayOfWeek = todayDate.getDay()
  const sundayOfThisWeek = new Date(todayDate)
  sundayOfThisWeek.setDate(todayDate.getDate() - dayOfWeek)
  const sundayOfViewedWeek = new Date(sundayOfThisWeek)
  sundayOfViewedWeek.setDate(sundayOfThisWeek.getDate() + weekOffset * 7)

  // Group items by day-key with a sample of titles for the tooltip.
  const itemsByDay = new Map<string, string[]>()
  for (const item of itemsWithDueDates) {
    if (!item.due_at) continue
    const d = new Date(item.due_at)
    if (isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const list = itemsByDay.get(key) ?? []
    if (item.title) list.push(item.title)
    itemsByDay.set(key, list)
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sundayOfViewedWeek)
    d.setDate(sundayOfViewedWeek.getDate() + i)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const dayItems = itemsByDay.get(key) ?? []
    return {
      letter: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i],
      number: d.getDate(),
      isToday: d.toDateString() === todayDate.toDateString(),
      hasItems: dayItems.length > 0,
      itemTitles: dayItems,
    }
  })

  // Headline date — shows the week range when not on the current week,
  // otherwise today's full date.
  const isThisWeek = weekOffset === 0
  const lastDayOfViewedWeek = new Date(sundayOfViewedWeek)
  lastDayOfViewedWeek.setDate(sundayOfViewedWeek.getDate() + 6)
  const headlineDate = isThisWeek
    ? todayDate.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : `${sundayOfViewedWeek.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })} – ${lastDayOfViewedWeek.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`

  return (
    <div
      className="rounded-2xl px-6 py-5"
      style={{
        background:
          'linear-gradient(135deg, var(--color-cal-strip-from) 0%, var(--color-cal-strip-to) 100%)',
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-cal-strip-text">{headlineDate}</span>
        <div className="flex items-center gap-1 rounded-full bg-white/70 pl-2 pr-1 text-cal-strip-text">
          <button
            aria-label="Previous week"
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1 hover:opacity-70"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Jump to today"
            onClick={() => setWeekOffset(0)}
            disabled={isThisWeek}
            className="px-1 text-xs font-medium disabled:opacity-60 disabled:cursor-default hover:opacity-70"
          >
            Today
          </button>
          <button
            aria-label="Next week"
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1 hover:opacity-70"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-center">
        {days.map((d, i) => (
          <div key={i} className="text-xs font-medium text-cal-strip-text-faint">
            {d.letter}
          </div>
        ))}
        {days.map((d, i) => (
          <div
            key={`n-${i}`}
            className="group/day relative flex flex-col items-center pt-1.5"
          >
            {d.isToday ? (
              <div className="flex size-9 items-center justify-center rounded-full bg-cal-strip-active text-sm font-semibold text-white">
                {d.number}
              </div>
            ) : (
              <div className="flex size-9 items-center justify-center text-sm font-medium text-cal-strip-text">
                {d.number}
              </div>
            )}
            <div className="mt-1 h-1 w-1">
              {d.hasItems && <div className="size-1 rounded-full bg-cal-strip-active" />}
            </div>
            {/* Real hover popover (replaces native `title` tooltip) — shows
                up to 4 item titles + "+N more". */}
            {d.hasItems && (
              <div
                className="pointer-events-none absolute top-full left-1/2 z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-line/70 bg-surface px-3 py-2 text-left text-[12px] leading-snug text-ink shadow-lg opacity-0 transition-opacity group-hover/day:opacity-100"
                role="tooltip"
              >
                <p className="m-0 mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {d.itemTitles.length} item{d.itemTitles.length === 1 ? '' : 's'} due
                </p>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {d.itemTitles.slice(0, 4).map((t, j) => (
                    <li key={j} className="truncate text-ink">
                      · {t}
                    </li>
                  ))}
                  {d.itemTitles.length > 4 && (
                    <li className="text-ink-faint">+{d.itemTitles.length - 4} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-cal-strip-text-faint flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-cal-strip-active inline-block" />
        Dot = items due that day
      </p>
    </div>
  )
}

// ─── Stats row — morning timeline ───────────────────────────────────────

function StatsRow({
  counts,
}: {
  counts: { new: number; carryover: number; cleared_overnight: number; overdue: number }
}) {
  const items = [
    { label: 'new', value: counts.new, tone: 'default' as const },
    { label: 'carried', value: counts.carryover, tone: 'default' as const },
    { label: 'cleared o/n', value: counts.cleared_overnight, tone: 'success' as const },
    { label: 'overdue', value: counts.overdue, tone: 'danger' as const },
  ]
  return (
    <div className="mt-4 flex items-center gap-4 text-[13px] text-ink-muted">
      {items.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span
            className={cn(
              'tabular-nums font-semibold',
              s.tone === 'success' && 'text-success-fg',
              s.tone === 'danger' && 'text-danger-fg',
              s.tone === 'default' && 'text-ink'
            )}
          >
            {s.value}
          </span>
          <span>{s.label}</span>
          {i < items.length - 1 && <span className="ml-2 text-ink-faint">·</span>}
        </span>
      ))}
    </div>
  )
}

// ─── Deadline helpers ───────────────────────────────────────────────────

type DeadlineTone = 'overdue' | 'today' | 'soon' | 'future'

function formatDeadline(dueIso: string): { label: string; tone: DeadlineTone } | null {
  const due = new Date(dueIso)
  if (isNaN(due.getTime())) return null
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)
  const diffDays = diffHours / 24

  if (diffMs < 0) {
    const overdueHrs = Math.abs(Math.round(diffHours))
    if (overdueHrs >= 24) {
      const days = Math.round(overdueHrs / 24)
      return { label: `Overdue ${days}d`, tone: 'overdue' }
    }
    return { label: `Overdue ${overdueHrs}h`, tone: 'overdue' }
  }
  if (diffHours < 12) {
    const hours = Math.max(1, Math.round(diffHours))
    return { label: `Due in ${hours}h`, tone: 'today' }
  }
  if (diffDays < 1.5) {
    return { label: 'Due tomorrow', tone: 'soon' }
  }
  if (diffDays < 7) {
    const dayName = due.toLocaleDateString('en-US', { weekday: 'long' })
    return { label: `Due ${dayName}`, tone: 'soon' }
  }
  const dateStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { label: `Due ${dateStr}`, tone: 'future' }
}

function DeadlineBadge({ dueIso }: { dueIso: string }) {
  const formatted = formatDeadline(dueIso)
  if (!formatted) return null
  const toneCls =
    formatted.tone === 'overdue'
      ? 'bg-danger-bg text-danger-fg'
      : formatted.tone === 'today'
      ? 'bg-tag-action-bg text-tag-action-fg'
      : formatted.tone === 'soon'
      ? 'bg-tag-reply-bg text-tag-reply-fg'
      : 'bg-surface-muted text-ink-muted'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
        toneCls
      )}
    >
      <Clock size={11} />
      {formatted.label}
    </span>
  )
}

// ─── Task row ───────────────────────────────────────────────────────────

const TAG_BORDER: Record<NonNullable<Tag>, string> = {
  reply: 'before:bg-tag-reply-fg',
  action: 'before:bg-tag-action-fg',
  commit: 'before:bg-tag-commit-fg',
  fyi: 'before:bg-tag-fyi-fg',
}

const TAG_PILL: Record<NonNullable<Tag>, string> = {
  reply: 'bg-tag-reply-bg text-tag-reply-fg',
  action: 'bg-tag-action-bg text-tag-action-fg',
  commit: 'bg-tag-commit-bg text-tag-commit-fg',
  fyi: 'bg-tag-fyi-bg text-tag-fyi-fg',
}

function TaskRow({
  item,
  isSelected,
  onSelect,
  onComplete,
  onDismiss,
  onSnooze,
}: {
  item: MockItem
  isSelected: boolean
  onSelect: () => void
  onComplete: () => void
  onDismiss: () => void
  onSnooze: () => void
}) {
  // Visual strikethrough animates before the row gets removed by the parent
  const [completed, setCompleted] = useState(false)
  // Optimistic local state for subtask completion. We seed from server data
  // and update immediately on click; the server call runs in the background
  // and reverts on error.
  const [subDone, setSubDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((item.sub_items ?? []).map(s => [s.id, !!s.completed]))
  )

  const toggleSub = (id: string) => {
    const next = !subDone[id]
    setSubDone(prev => ({ ...prev, [id]: next }))
    toggleSubtaskComplete(id, next).catch(() => {
      // revert on failure
      setSubDone(prev => ({ ...prev, [id]: !next }))
    })
  }

  const subItems = item.sub_items ?? []
  const subTotal = subItems.length
  const subCompleted = subItems.filter(s => subDone[s.id]).length
  const handleCompleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCompleted(true)
    setTimeout(() => onComplete(), 250) // tiny delay so the strikethrough is visible
  }
  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCompleted(true) // fades the row before it's removed
    setTimeout(() => onDismiss(), 250)
  }
  const handleSnoozeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCompleted(true) // fade out before removal
    setTimeout(() => onSnooze(), 250)
  }

  return (
    <li
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer pl-12 pr-2 py-4 transition-colors',
        isSelected ? 'bg-success-bg/30' : 'hover:bg-surface-muted/50',
        completed && 'opacity-50'
      )}
    >
      {/* Hover-triage micro-buttons on the LEFT — speed approval. Hidden
          until the row is hovered/selected, then fade in over the row's
          left gutter. Mirrors Nummo's row-level X/✓ pattern. */}
      <div
        className={cn(
          'absolute left-1.5 top-3.5 flex flex-col gap-1 transition-opacity',
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={handleDismissClick}
          className="flex size-6 items-center justify-center rounded-md border border-line bg-surface text-ink-faint hover:border-danger-fg hover:text-danger-fg"
        >
          <X size={12} />
        </button>
        <button
          type="button"
          aria-label="Complete"
          onClick={handleCompleteClick}
          className="flex size-6 items-center justify-center rounded-md border border-success-fg/40 bg-success-bg text-success-fg hover:bg-success-fg hover:text-white"
        >
          <Check size={12} />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityChip itemId={item.id} value={item.priority ?? null} />
            <span
              className={cn(
                'text-[15px] font-semibold leading-snug text-ink',
                completed && 'line-through text-ink-faint'
              )}
            >
              {item.title}
            </span>
            {subTotal > 0 && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  subCompleted === subTotal
                    ? 'bg-success-bg text-success-fg'
                    : 'bg-surface-muted text-ink-muted'
                )}
                title={`${subCompleted} of ${subTotal} subtasks done`}
              >
                {subCompleted}/{subTotal}
              </span>
            )}
            {item.due_at && <DeadlineBadge dueIso={item.due_at} />}
          </div>

          <p className="mt-1 truncate text-[13px] text-ink-faint m-0">
            {item.brief?.why ||
              item.description ||
              item.parent_context ||
              `From ${item.source}`}
          </p>

          {subTotal > 0 && (
            <ul className="mt-2.5 list-none p-0 m-0 space-y-1">
              {/* Show up to 2 subtasks inline; the rest live in the detail panel. */}
              {subItems.slice(0, 2).map(sub => {
                const isDone = !!subDone[sub.id]
                return (
                  <li
                    key={sub.id}
                    className="flex items-center gap-2 text-[13px]"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSub(sub.id)}
                      aria-label={
                        isDone ? `Mark "${sub.title}" not done` : `Mark "${sub.title}" done`
                      }
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                        isDone
                          ? 'border-success-fg bg-success-fg text-white'
                          : 'border-line-strong bg-surface hover:border-success-fg'
                      )}
                    >
                      {isDone && <Check size={10} />}
                    </button>
                    <span
                      className={cn(
                        'text-ink transition-colors',
                        isDone && 'line-through text-ink-faint'
                      )}
                    >
                      {sub.title}
                    </span>
                  </li>
                )
              })}
              {subTotal > 2 && (
                <li
                  className="ml-6 text-[12px] text-ink-faint hover:text-ink-muted"
                  onClick={e => {
                    e.stopPropagation()
                    onSelect()
                  }}
                  role="button"
                >
                  + {subTotal - 2} more
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* Status pill — uses the consistent vocabulary. The fast X/✓
              triage is on the left now; we keep Snooze on the right as
              the only "longer" action that doesn't have a left twin. */}
          {(() => {
            // Pill priority: an actual drafted artifact is the strongest
            // signal — "Draft ready" (green). Otherwise fall back to
            // urgency-only "Awaiting approval" (orange) so the row earns
            // attention even without a draft.
            const kind: StatusPillKind | null = item.proposed_action
              ? 'draft'
              : item.urgent
              ? 'awaiting'
              : null
            return kind ? <StatusPill kind={kind} /> : null
          })()}
          <div
            className={cn(
              'flex gap-1 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isSelected && 'opacity-100'
            )}
          >
            <ActionButton icon={Clock} label="Snooze 24h" onClick={handleSnoozeClick} />
          </div>
        </div>
      </div>
    </li>
  )
}

function ActionButton({
  icon: Icon,
  label,
  variant = 'default',
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  variant?: 'default' | 'primary' | 'completed'
  onClick?: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex size-6 items-center justify-center rounded-md border transition-colors',
        variant === 'primary' && 'border-success-fg/40 bg-success-bg text-success-fg hover:bg-success-fg hover:text-white',
        variant === 'completed' && 'border-success-fg bg-success-fg text-white hover:opacity-80',
        variant === 'default' && 'border-line bg-surface text-ink-faint hover:border-line-strong hover:text-ink'
      )}
    >
      <Icon size={12} />
    </button>
  )
}

function TagPill({ tag }: { tag: NonNullable<Tag> }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        TAG_PILL[tag]
      )}
    >
      {tag}
    </span>
  )
}

// ─── Priority chip ──────────────────────────────────────────────────────
// Clickable badge showing the item's current priority. Click opens a small
// menu with P0/P1/P2/P3/Clear. Updates persist via setItemPriority server
// action; revert on error.
//
// Visual: filled colored pill (P0 red, P1 orange, P2 blue, P3 gray) when
// set; a faint dashed placeholder when unset (still clickable to set one).

const PRIORITY_STYLE: Record<'P0' | 'P1' | 'P2' | 'P3', string> = {
  P0: 'bg-danger-fg text-white border-danger-fg',
  P1: 'bg-tag-action-fg text-white border-tag-action-fg',
  P2: 'bg-tag-reply-fg text-white border-tag-reply-fg',
  P3: 'bg-surface-muted text-ink-muted border-line-strong',
}

const PRIORITY_OPTIONS: ('P0' | 'P1' | 'P2' | 'P3')[] = ['P0', 'P1', 'P2', 'P3']

function PriorityChip({
  itemId,
  value,
}: {
  itemId: string
  value: Priority
}) {
  const [current, setCurrent] = useState<Priority>(value)
  const [open, setOpen] = useState(false)

  // Re-sync when the parent passes new value (after revalidate).
  useEffect(() => {
    setCurrent(value)
  }, [value])

  // Click-away to close the menu.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-priority-chip]')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function setTo(p: Priority, e: React.MouseEvent) {
    e.stopPropagation()
    const prev = current
    setCurrent(p)
    setOpen(false)
    setItemPriority(itemId, p).catch(() => setCurrent(prev))
  }

  return (
    <div className="relative" data-priority-chip onClick={e => e.stopPropagation()}>
      {current ? (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            setOpen(o => !o)
          }}
          className={cn(
            'inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums uppercase tracking-wider transition-opacity hover:opacity-80',
            PRIORITY_STYLE[current as 'P0' | 'P1' | 'P2' | 'P3']
          )}
          title={`Priority ${current} — click to change`}
        >
          {current}
        </button>
      ) : (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            setOpen(o => !o)
          }}
          aria-label="Set priority"
          className="inline-flex items-center justify-center rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[10px] font-medium text-ink-faint hover:border-ink hover:text-ink"
          title="Set priority"
        >
          P–
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 flex gap-1 rounded-md border border-line bg-surface p-1 shadow-md">
          {PRIORITY_OPTIONS.map(p => (
            <button
              key={p}
              type="button"
              onClick={e => setTo(p, e)}
              className={cn(
                'inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums uppercase tracking-wider transition-opacity hover:opacity-80',
                PRIORITY_STYLE[p],
                current === p && 'ring-2 ring-ink ring-offset-1 ring-offset-surface'
              )}
            >
              {p}
            </button>
          ))}
          {current && (
            <button
              type="button"
              onClick={e => setTo(null, e)}
              className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-faint hover:text-ink"
              title="Clear priority"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SourceIcon({ source, size = 18 }: { source: Source; size?: number }) {
  const tooltip = SOURCE_LABEL[source] ?? source
  return (
    <div
      title={tooltip}
      className="mt-0.5 flex shrink-0 items-center justify-center"
      style={{ width: size + 4, height: size + 4 }}
    >
      <BrandLogo brand={source} size={size} />
    </div>
  )
}

const SOURCE_LABEL: Record<Source, string> = {
  granola: 'Granola',
  gmail: 'Gmail',
  calendar: 'Google Calendar',
  slack: 'Slack',
  linear: 'Linear',
  manual: 'Manual',
}

// ─── Completed row ──────────────────────────────────────────────────────

function CompletedRow({ item }: { item: MockItem }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-line/50 py-4 px-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold leading-snug text-ink">
          {item.title}
        </p>
        <p className="mt-1 truncate text-[13px] text-ink-faint m-0">
          {item.brief?.why ||
            item.description ||
            item.parent_context ||
            `From ${item.source}`}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-success-bg px-2.5 py-0.5 text-[12px] font-medium text-success-fg">
        Approved
      </span>
    </li>
  )
}

// ─── Brief view — the Why/Know/Done/Next structure ──────────────────────

function BriefView({ brief }: { brief: TaskBrief }) {
  return (
    <div className="mb-5 space-y-3.5">
      <BriefSection label="Why" tone="ink">
        <p className="m-0 text-[14px] leading-relaxed text-ink">{brief.why}</p>
      </BriefSection>

      {brief.know.length > 0 && (
        <BriefSection label="Know" tone="ink">
          <ul className="m-0 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-ink">
            {brief.know.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </BriefSection>
      )}

      <BriefSection label="Done" tone="muted">
        <p className="m-0 text-[13px] leading-relaxed text-ink-muted">{brief.done}</p>
      </BriefSection>

      <BriefSection label="Next" tone="success">
        <p className="m-0 text-[14px] font-medium leading-relaxed text-success-fg">
          {brief.next}
        </p>
      </BriefSection>
    </div>
  )
}

function BriefSection({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'ink' | 'muted' | 'success'
  children: React.ReactNode
}) {
  const labelColor =
    tone === 'success' ? 'text-success-fg' : tone === 'muted' ? 'text-ink-faint' : 'text-ink-faint'
  return (
    <div>
      <p
        className={cn(
          'm-0 mb-1 text-[11px] font-medium uppercase tracking-wider',
          labelColor
        )}
      >
        {label}
      </p>
      {children}
    </div>
  )
}

// ─── Detail panel ───────────────────────────────────────────────────────

function DetailPanel({
  item,
  onClose,
  onComplete,
}: {
  item: MockItem
  onClose: () => void
  onComplete: () => void
}) {
  return (
    <aside className="sticky top-0 max-h-screen w-[480px] shrink-0 overflow-y-auto border-l border-line bg-surface px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
          aria-label="Close panel"
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
            aria-label="Edit"
          >
            <Edit3 size={15} />
          </button>
          <button
            className="rounded-md p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
            aria-label="History"
          >
            <History size={15} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-start gap-2">
        <NummoLogo />
        <h2 className="m-0 text-[18px] font-medium leading-snug text-ink">{item.title}</h2>
      </div>

      <div className="mb-4 flex items-center gap-2">
        {item.detail_status && (
          <span
            className={cn(
              'rounded-md px-2.5 py-1 text-[12px] font-medium',
              item.detail_status === 'Needs your review' && 'bg-surface-muted text-ink-muted',
              item.detail_status === 'In progress' && 'bg-tag-reply-bg text-tag-reply-fg',
              item.detail_status === 'Review needed' && 'bg-surface-muted text-ink-muted'
            )}
          >
            {item.detail_status}
          </span>
        )}
        {item.due_at && <DeadlineBadge dueIso={item.due_at} />}
      </div>

      {/* Approval queue: when the agent drafted an action (e.g. an email
          reply), show the draft inline so the user can approve and send. */}
      {item.proposed_action && (
        <DraftCard
          itemId={item.id}
          action={item.proposed_action}
          onSent={() => {
            onComplete()
            onClose()
          }}
        />
      )}

      {/* Subtasks — the headline interaction. Stored as child items in the
          DB; toggle persists; add input creates a new manual item. */}
      <SubtasksSection parentId={item.id} initial={item.sub_items ?? []} />

      {/* The brief — synthesized context for the task. Why / Know / Done / Next. */}
      {item.brief ? (
        <BriefView brief={item.brief} />
      ) : !item.proposed_action ? (
        <div className="mb-5 rounded-md border border-line/60 bg-surface-muted/50 px-3.5 py-3">
          <p className="m-0 text-[13px] text-ink-muted">
            {item.description || 'No brief generated for this task yet.'}
          </p>
          <p className="m-0 mt-1 text-[12px] text-ink-faint">
            Brief pending — run the brief generator to synthesize context for this task.
          </p>
        </div>
      ) : null}

      {/* Context Trail: the raw underlying content (email body / transcript)
          so the user can audit why the agent flagged this task. */}
      {item.source_excerpt && (
        <ContextTrailSection
          source={item.source}
          excerpt={item.source_excerpt}
        />
      )}

      {item.transcript_pull && item.transcript_pull.length > 0 && (
        <div className="mb-5">
          <p className="m-0 mb-2 text-[14px] font-medium text-ink">Transcript pull</p>
          <ul className="m-0 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink">
            {item.transcript_pull.map((b, i) => (
              <li key={i}>{b.text}</li>
            ))}
          </ul>
        </div>
      )}

      {item.link && (
        <p className="mb-5 text-[13px]">
          <span className="text-ink-muted">Link: </span>
          <a
            href={item.link.url}
            className="inline-flex items-center gap-1 text-success-fg hover:underline"
          >
            {item.link.label}
            <ExternalLink size={12} />
          </a>
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-[14px] font-medium text-ink hover:bg-surface-muted"
        >
          Close
        </button>
        <button
          onClick={() => {
            onComplete()
            onClose()
          }}
          className="flex-1 rounded-md bg-success-fg px-4 py-2 text-[14px] font-medium text-white hover:opacity-90"
        >
          <Check size={14} className="-mt-0.5 mr-1 inline" />
          Mark as Done
        </button>
      </div>
    </aside>
  )
}

// ─── Draft card ─────────────────────────────────────────────────────────
// The artifact the agent drafted (e.g. an email reply). The user reads it
// inline, edits if needed, and clicks Send. "Send" calls
// executeProposedAction which opens Gmail compose pre-filled with the draft
// and marks the item completed.

function DraftCard({
  itemId,
  action,
  onSent,
}: {
  itemId: string
  action: ProposedAction
  onSent: () => void
}) {
  const [body, setBody] = useState(action.body)
  const [busy, startSend] = useTransition()
  const [busyMode, setBusyMode] = useState<'send' | 'open' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Two action modes:
  //   - sendDirect: true  → call Gmail API users.messages.send (one click)
  //                          falls back to opening compose if the scope is
  //                          missing or the API returns 403.
  //   - sendDirect: false → skip the API entirely; open compose URL only.
  function handleAction(sendDirect: boolean) {
    setError(null)
    setNotice(null)
    setBusyMode(sendDirect ? 'send' : 'open')
    startSend(async () => {
      try {
        const result = await executeProposedAction(itemId, { sendDirect })
        if (!result.ok) {
          setError(result.error)
          setBusyMode(null)
          return
        }
        if (result.sent) {
          // Direct API send succeeded.
          setNotice('Sent via Gmail.')
        } else {
          // Fallback path — open compose URL in a new tab.
          window.open(result.openUrl, '_blank', 'noopener,noreferrer')
          setNotice(
            sendDirect
              ? 'Opened in Gmail (gmail.send scope not granted yet).'
              : 'Opened in Gmail.'
          )
        }
        onSent()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed')
        setBusyMode(null)
      }
    })
  }

  return (
    <div className="mb-5 rounded-lg border border-line/60 bg-surface">
      <div className="flex items-center justify-between border-b border-line/60 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          <span>Email</span>
          <span>·</span>
          <span>Reply</span>
          <span className="rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-success-fg">
            Draft
          </span>
        </div>
      </div>

      <div className="border-b border-line/60 px-3.5 py-2.5 text-[12px] text-ink-muted">
        <div className="flex items-baseline gap-2">
          <span className="w-14 shrink-0 text-ink-faint">Subject:</span>
          <span className="text-ink">{(action as { subject: string }).subject}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="w-14 shrink-0 text-ink-faint">To:</span>
          <span className="text-ink">
            {(action as { to: string[] }).to.join(', ')}
          </span>
        </div>
      </div>

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={Math.min(14, Math.max(5, body.split('\n').length + 1))}
        className="block w-full resize-y border-0 bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-ink focus:outline-none"
        spellCheck
      />

      <div className="flex items-center justify-end gap-2 border-t border-line/60 px-3.5 py-2.5">
        {error && (
          <span className="mr-auto text-[12px] text-danger-fg">{error}</span>
        )}
        {notice && !error && (
          <span className="mr-auto text-[12px] text-success-fg">{notice}</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => handleAction(false)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-muted disabled:opacity-50"
          title="Open in Gmail compose to review before sending"
        >
          {busy && busyMode === 'open' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ExternalLink size={12} />
          )}
          Open in Gmail
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleAction(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          title="Send via Gmail API immediately"
        >
          {busy && busyMode === 'send' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Send now
        </button>
      </div>
    </div>
  )
}

// ─── Context Trail ──────────────────────────────────────────────────────
// Shows the raw underlying source content the agent drew on. The
// user can audit why the task was flagged. Collapsed by default to keep
// the panel compact.

function ContextTrailSection({
  source,
  excerpt,
}: {
  source: Source
  excerpt: string
}) {
  const [open, setOpen] = useState(false)
  const label =
    source === 'gmail'
      ? 'Email thread'
      : source === 'granola'
      ? 'Meeting note'
      : source === 'slack'
      ? 'Slack message'
      : source === 'calendar'
      ? 'Calendar event'
      : source === 'linear'
      ? 'Linear issue'
      : 'Source'
  return (
    <div className="mb-5 rounded-lg border border-line/60 bg-canvas/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-muted"
      >
        <span className="flex items-center gap-2">
          <SourceIcon source={source} />
          Context · {label}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <pre className="m-0 whitespace-pre-wrap border-t border-line/60 px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted font-sans">
          {excerpt}
        </pre>
      )}
    </div>
  )
}

// ─── Subtasks ───────────────────────────────────────────────────────────
// Children of the parent item. Each subtask is its own item row in the DB
// (source='manual', parent_id set). Toggle and delete persist through the
// server actions; add inserts a new row.

function SubtasksSection({
  parentId,
  initial,
}: {
  parentId: string
  initial: { id: string; title: string; completed?: boolean }[]
}) {
  const router = useRouter()
  // Local optimistic copy of the subtask list. Server actions revalidate
  // /today on success which refreshes initial via the parent, but for
  // immediate snappy feedback we mutate locally first.
  const [subs, setSubs] = useState(initial)
  const [draft, setDraft] = useState('')
  const [busy, startTransition] = useTransition()

  // Re-sync when the parent passes a fresh list (after revalidate). This
  // handles the case where the user added a subtask, the page revalidated,
  // and the server-source list is now different from what we optimistically
  // showed (e.g. it gained a permanent id).
  useEffect(() => {
    setSubs(initial)
  }, [initial])

  const completed = subs.filter(s => s.completed).length

  function handleToggle(id: string) {
    const next = !subs.find(s => s.id === id)?.completed
    setSubs(prev => prev.map(s => (s.id === id ? { ...s, completed: next } : s)))
    toggleSubtaskComplete(id, next).catch(() => {
      // revert on error
      setSubs(prev => prev.map(s => (s.id === id ? { ...s, completed: !next } : s)))
    })
  }

  function handleDelete(id: string) {
    setSubs(prev => prev.filter(s => s.id !== id))
    deleteSubtask(id).catch(() => router.refresh())
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    // Optimistic insert with a temp id — replaced when the server returns
    // the real row via revalidatePath.
    const tempId = `temp-${Date.now()}`
    setSubs(prev => [...prev, { id: tempId, title, completed: false }])
    setDraft('')
    startTransition(async () => {
      try {
        await addSubtask(parentId, title)
        // revalidatePath in the action will refresh `initial` via the parent,
        // and our useEffect above syncs setSubs.
      } catch {
        // Roll back the temp row on failure
        setSubs(prev => prev.filter(s => s.id !== tempId))
      }
    })
  }

  return (
    <div className="mb-5 rounded-lg border border-line/60 bg-canvas/40 px-3.5 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
          Subtasks
        </h3>
        <span className="text-[12px] text-ink-faint tabular-nums">
          {completed} of {subs.length} done
        </span>
      </div>

      {subs.length === 0 && (
        <p className="m-0 mb-2 text-[13px] text-ink-faint">
          Break this down into smaller steps.
        </p>
      )}

      <ul className="m-0 list-none p-0 space-y-1.5">
        {subs.map(sub => (
          <li
            key={sub.id}
            className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-muted/60"
          >
            <button
              type="button"
              onClick={() => handleToggle(sub.id)}
              aria-label={
                sub.completed ? `Mark "${sub.title}" not done` : `Mark "${sub.title}" done`
              }
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                sub.completed
                  ? 'border-success-fg bg-success-fg text-white'
                  : 'border-line-strong bg-surface hover:border-success-fg'
              )}
            >
              {sub.completed && <Check size={11} />}
            </button>
            <span
              className={cn(
                'flex-1 text-[14px] text-ink transition-colors',
                sub.completed && 'line-through text-ink-faint'
              )}
            >
              {sub.title}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(sub.id)}
              aria-label={`Delete "${sub.title}"`}
              className="rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-danger-fg group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="mt-2 flex items-center gap-2 px-1">
        <span className="text-[14px] text-ink-faint">+</span>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a subtask"
          disabled={busy}
          className="flex-1 border-0 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        {draft && (
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-success-fg px-2.5 py-0.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
        )}
      </form>
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="mt-6 rounded-lg border border-line/60 bg-surface px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <Check size={18} />
      </div>
      <p className="m-0 text-[15px] font-medium text-ink">All clear</p>
      <p className="mt-1 text-[13px] text-ink-muted m-0">
        Nothing on your plate right now. The next morning digest runs at 7:00 AM.
      </p>
    </div>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-1 py-2.5 text-[14px] font-medium transition-colors',
        active
          ? 'border-ink text-ink'
          : 'border-transparent text-ink-faint hover:text-ink-muted'
      )}
    >
      {children}
      {typeof count === 'number' && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
            active ? 'bg-success-bg text-success-fg' : 'bg-surface-muted text-ink-faint'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// First tab in the row gets no left margin; subsequent tabs get a gap.
// Done with sibling-margin in the parent flex to keep this component simple.

// ─── Filter bar ─────────────────────────────────────────────────────────

const SOURCE_ORDER: Source[] = ['gmail', 'calendar', 'granola', 'linear', 'slack', 'manual']
const TAG_ORDER: NonNullable<Tag>[] = ['reply', 'action', 'commit', 'fyi']
const TAG_LABEL: Record<NonNullable<Tag>, string> = {
  reply: 'Replies',
  action: 'Actions',
  commit: 'Commits',
  fyi: 'FYIs',
}

function FilterBar({
  availableSources,
  sourceFilter,
  onSourceChange,
  availableTags,
  tagFilter,
  onTagChange,
  groupBy,
  onGroupByChange,
}: {
  availableSources: Source[]
  sourceFilter: Source | null
  onSourceChange: (s: Source | null) => void
  availableTags: NonNullable<Tag>[]
  tagFilter: NonNullable<Tag> | null
  onTagChange: (t: NonNullable<Tag> | null) => void
  groupBy: 'none' | 'source' | 'due'
  onGroupByChange: (g: 'none' | 'source' | 'due') => void
}) {
  const orderedSources = SOURCE_ORDER.filter(s => availableSources.includes(s))
  const orderedTags = TAG_ORDER.filter(t => availableTags.includes(t))
  // Hide the bar entirely when there's nothing to filter or group.
  if (orderedSources.length === 0 && orderedTags.length === 0) return null
  return (
    <div className="mt-4 space-y-2">
      {/* Row 1: Source chips + Group-by toggle (right-aligned) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Source
          </span>
          <FilterChip
            active={sourceFilter === null}
            onClick={() => onSourceChange(null)}
          >
            All
          </FilterChip>
          {orderedSources.map(s => (
            <FilterChip
              key={s}
              active={sourceFilter === s}
              onClick={() => onSourceChange(sourceFilter === s ? null : s)}
            >
              <BrandLogo brand={s} size={12} />
              {SOURCE_LABEL[s]}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
          <Layers size={12} />
          <span>Group:</span>
          <GroupToggle value={groupBy} onChange={onGroupByChange} />
        </div>
      </div>

      {/* Row 2: Tag chips */}
      {orderedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Tag
          </span>
          <FilterChip
            active={tagFilter === null}
            onClick={() => onTagChange(null)}
          >
            All
          </FilterChip>
          {orderedTags.map(t => (
            <FilterChip
              key={t}
              active={tagFilter === t}
              onClick={() => onTagChange(tagFilter === t ? null : t)}
              tone={t}
            >
              {TAG_LABEL[t]}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  // Optional tag tone — active state uses the tag color so the chip
  // visually mirrors the row's tag pill.
  tone?: NonNullable<Tag>
}) {
  const activeToneCls = tone
    ? TAG_CHIP_ACTIVE[tone]
    : 'border-ink bg-ink text-canvas'
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? activeToneCls
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

// Per-tag active styling for the tag chip row. Matches the row's tag pill
// palette so a "Replies" chip in its active state visually anchors to the
// blue reply rows below.
const TAG_CHIP_ACTIVE: Record<NonNullable<Tag>, string> = {
  reply: 'border-tag-reply-fg bg-tag-reply-fg text-white',
  action: 'border-tag-action-fg bg-tag-action-fg text-white',
  commit: 'border-tag-commit-fg bg-tag-commit-fg text-white',
  fyi: 'border-ink-muted bg-ink-muted text-canvas',
}

function GroupToggle({
  value,
  onChange,
}: {
  value: 'none' | 'source' | 'due'
  onChange: (g: 'none' | 'source' | 'due') => void
}) {
  const options: Array<{ key: 'none' | 'source' | 'due'; label: string }> = [
    { key: 'none', label: 'None' },
    { key: 'source', label: 'Source' },
    { key: 'due', label: 'Due' },
  ]
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded px-2 py-0.5 text-[12px] font-medium transition-colors',
            value === o.key
              ? 'bg-ink text-canvas'
              : 'text-ink-muted hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Grouping ───────────────────────────────────────────────────────────

interface ItemGroup {
  key: string
  label: string | null  // null = no header (used when groupBy = 'none')
  icon?: React.ReactNode
  items: MockItem[]
}

function groupItems(items: MockItem[], groupBy: 'none' | 'source' | 'due'): ItemGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }]
  }
  if (groupBy === 'source') {
    const buckets = new Map<Source, MockItem[]>()
    for (const it of items) {
      const list = buckets.get(it.source) ?? []
      list.push(it)
      buckets.set(it.source, list)
    }
    return SOURCE_ORDER.filter(s => buckets.has(s)).map(s => ({
      key: `src-${s}`,
      label: SOURCE_LABEL[s],
      icon: <BrandLogo brand={s} size={12} />,
      items: buckets.get(s) ?? [],
    }))
  }
  // groupBy === 'due'
  const now = Date.now()
  const tomorrow = now + 24 * 60 * 60 * 1000
  const endOfWeek = now + 7 * 24 * 60 * 60 * 1000
  const overdue: MockItem[] = []
  const today: MockItem[] = []
  const thisWeek: MockItem[] = []
  const later: MockItem[] = []
  const none: MockItem[] = []
  for (const it of items) {
    if (!it.due_at) {
      none.push(it)
      continue
    }
    const due = new Date(it.due_at).getTime()
    if (isNaN(due)) {
      none.push(it)
      continue
    }
    if (due < now) overdue.push(it)
    else if (due < tomorrow) today.push(it)
    else if (due < endOfWeek) thisWeek.push(it)
    else later.push(it)
  }
  const out: ItemGroup[] = []
  if (overdue.length) out.push({ key: 'overdue', label: 'Overdue', items: overdue })
  if (today.length) out.push({ key: 'today', label: 'Today', items: today })
  if (thisWeek.length) out.push({ key: 'this-week', label: 'This week', items: thisWeek })
  if (later.length) out.push({ key: 'later', label: 'Later', items: later })
  if (none.length) out.push({ key: 'no-due', label: 'No due date', items: none })
  return out
}

// ─── Prep tab ───────────────────────────────────────────────────────────
// Calendar-derived "Prep: <meeting>" briefs. Split out from Open so the
// main list stays focused on action items the user actually owes work on,
// not the read-it-before-the-meeting kind. Same row component so the
// interactions are consistent.

function PrepTab({
  items,
  selectedId,
  onSelect,
  onComplete,
  onDismiss,
  onSnooze,
}: {
  items: MockItem[]
  selectedId?: string
  onSelect: (item: MockItem) => void
  onComplete: (id: string) => void
  onDismiss: (id: string) => void
  onSnooze: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="m-0 text-[15px] font-medium text-ink">No meetings to prep for</p>
        <p className="mt-1 text-[13px] text-ink-faint m-0">
          Calendar prep briefs land here automatically the morning of a meeting.
        </p>
      </div>
    )
  }
  return (
    <div className="mt-4">
      <p className="m-0 mb-2 text-[12px] text-ink-faint">
        Briefs for upcoming meetings. Read them, then mark done — they don&apos;t
        clutter your Open list.
      </p>
      <ul className="list-none p-0 m-0 divide-y divide-line/70">
        {items.map(item => (
          <TaskRow
            key={item.id}
            item={item}
            isSelected={selectedId === item.id}
            onSelect={() => onSelect(item)}
            onComplete={() => onComplete(item.id)}
            onDismiss={() => onDismiss(item.id)}
            onSnooze={() => onSnooze(item.id)}
          />
        ))}
      </ul>
    </div>
  )
}

// ─── Cleared tab ────────────────────────────────────────────────────────

function ClearedTab({
  items,
  totalCount,
}: {
  items: MockItem[]
  totalCount: number
}) {
  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="m-0 text-[15px] font-medium text-ink">Nothing cleared yet today</p>
        <p className="mt-1 text-[13px] text-ink-faint m-0">
          Approve or check off items from the Open tab — they&apos;ll land here.
        </p>
      </div>
    )
  }
  return (
    <div className="mt-4">
      <ul className="list-none p-0 m-0">
        {items.map(item => (
          <CompletedRow key={item.id} item={item} />
        ))}
      </ul>
      {totalCount > items.length && (
        <div className="mt-3 text-center">
          <Link
            href="/handled"
            className="text-[13px] text-ink-faint underline hover:text-ink"
          >
            See everything that&apos;s been handled →
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Filter empty state ─────────────────────────────────────────────────

function FilterEmpty({
  source,
  tag,
  onClear,
}: {
  source: Source | null
  tag: NonNullable<Tag> | null
  onClear: () => void
}) {
  // Build a "Gmail + Replies" style description of the active filter.
  const parts: string[] = []
  if (source) parts.push(SOURCE_LABEL[source])
  if (tag) parts.push(TAG_LABEL[tag])
  const desc = parts.join(' + ')
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      {source && (
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-md bg-surface-muted">
          <BrandLogo brand={source} size={20} />
        </div>
      )}
      <p className="m-0 text-[15px] font-medium text-ink">
        No items match {desc}
      </p>
      <p className="mt-1 text-[13px] text-ink-faint m-0">
        Nothing in your morning digest hit this filter.{' '}
        <button onClick={onClear} className="underline hover:text-ink">
          Clear filters
        </button>
      </p>
    </div>
  )
}

// ─── Logo ───────────────────────────────────────────────────────────────

function NummoLogo() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full text-success-fg"
    >
      <svg viewBox="0 0 20 20" fill="none" className="size-4">
        <path
          d="M4 14V8c0-2 1-3 3-3s3 1 3 3v6h2V8c0-2 1-3 3-3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

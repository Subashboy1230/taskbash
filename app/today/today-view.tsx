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
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppHeader } from '@/app/_components/app-header'
import { BrandLogo } from '@/app/_components/brand-logo'
import { StatusPill, type StatusPillKind } from '@/app/_components/status-pill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/app/_components/ui/dropdown-menu'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/app/_components/ui/tabs'
import { Button } from '@/app/_components/ui/button'
import { Input } from '@/app/_components/ui/input'
import { Card } from '@/app/_components/ui/card'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { Priority, ProposedAction, Source, Tag, TaskBrief, UserFunction } from '@/lib/types'
import { functionColor } from '@/lib/function-color'
import { renderSubtitleWithEntities } from '@/app/_components/entity-chip'
import type { Entity } from '@/app/_components/entity-chip'
import { setItemFunctions } from '@/app/settings/functions/actions'
import {
  addSubtask,
  completeItem,
  deleteSubtask,
  dismissItem,
  executeProposedAction,
  markItemSlop,
  rejectDraft,
  requestRefresh,
  setItemPriority,
  snoozeItem,
  toggleSubtaskComplete,
  uncompleteItem,
  updateItemDescription,
  reorderItem,
} from './actions'

// ─── Top-level layout ───────────────────────────────────────────────────

export function TodayView({
  digest,
  userEmail,
  functions = [],
  hideHeader = false,
  hideDetailPanel = false,
  onSelectItem,
  externalSelectedItemId,
  dayFilter,
  onClearDayFilter,
  onAddTask,
  mainExpanded = false,
}: {
  digest: MockDigestSummary
  userEmail?: string
  functions?: UserFunction[]
  // When true (server page renders sidebar separately), don't render the
  // top AppHeader. Kept default false so existing callers don't break.
  hideHeader?: boolean
  // When true, this TodayView is being used inside the 3-column shell —
  // the shell owns the right-slot rendering, so we skip our internal
  // DetailPanel render and emit selection up via onSelectItem.
  hideDetailPanel?: boolean
  // Notify the parent shell when the user picks a row (or closes one).
  onSelectItem?: (item: MockItem | null) => void
  // Lets the parent control which row is highlighted (e.g. when the
  // shell already had a selected item from URL state).
  externalSelectedItemId?: string | null
  // YYYY-MM-DD — when set, filter the open list to items due that day.
  dayFilter?: string | null
  onClearDayFilter?: () => void
  // Open the add-task panel (controlled by the shell).
  onAddTask?: () => void
  // When the calendar column is collapsed, give the main column more
  // breathing room. Removes the 820px content cap.
  mainExpanded?: boolean
}) {
  const [selectedItemInternal, setSelectedItemInternal] = useState<MockItem | null>(null)
  // When the parent shell provides an externalSelectedItemId, resolve
  // it to the actual item from the digest. Otherwise use our internal
  // state. Either way, the row-highlight comes from `selectedItem`.
  const externalSelectedItem =
    externalSelectedItemId
      ? digest.open_items.find(i => i.id === externalSelectedItemId) ?? null
      : null
  // When the shell clears the selection (e.g. Sheet close button), mirror
  // that into internal state so the width constraint is also removed.
  useEffect(() => {
    if (externalSelectedItemId === null) setSelectedItemInternal(null)
  }, [externalSelectedItemId])
  const selectedItem = externalSelectedItem ?? selectedItemInternal
  // Wrapped setter that BOTH updates local state AND notifies the
  // parent shell. The shell needs the full item object to render its
  // own DetailPanel.
  const setSelectedItem = (item: MockItem | null) => {
    setSelectedItemInternal(item)
    onSelectItem?.(item)
  }
  const [tab, setTab] = useState<'open' | 'prep' | 'cleared'>('open')
  // Filter chips — null = "All". Persist in localStorage so the user's
  // filter survives a reload.
  const [sourceFilter, setSourceFilter] = useState<Source | null>(null)
  const [tagFilter, setTagFilter] = useState<NonNullable<Tag> | null>(null)
  // Function filter — multi-select. Empty set = no filter applied. Match
  // mode is OR (any selected function matches).
  const [functionFilter, setFunctionFilter] = useState<Set<string>>(new Set())
  const [groupBy, setGroupBy] = useState<'none' | 'source' | 'due' | 'function'>('none')
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
      const savedFns = localStorage.getItem('todoo:functionFilter')
      if (savedFns && savedFns !== 'null') {
        try {
          const parsed = JSON.parse(savedFns)
          if (Array.isArray(parsed)) setFunctionFilter(new Set(parsed))
        } catch {
          /* corrupt — ignore */
        }
      }
      const savedGroup = localStorage.getItem('todoo:groupBy')
      if (
        savedGroup === 'source' ||
        savedGroup === 'due' ||
        savedGroup === 'function' ||
        savedGroup === 'none'
      ) {
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
      localStorage.setItem('todoo:functionFilter', JSON.stringify(Array.from(functionFilter)))
      localStorage.setItem('todoo:groupBy', groupBy)
    } catch {
      /* ignore */
    }
  }, [sourceFilter, tagFilter, functionFilter, groupBy])

  // Items the user just dismissed/completed — hide them locally before revalidate lands
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())

  function handleReorder(draggedId: string, beforeId: string | null, afterId: string | null) {
    // Optimistic: move the row immediately in local state
    setOrderedOpen(prev => {
      const idx = prev.findIndex(i => i.id === draggedId)
      if (idx === -1) return prev
      const item = prev[idx]
      const without = prev.filter(i => i.id !== draggedId)
      const insertAfterIdx = afterId ? without.findIndex(i => i.id === afterId) : -1
      const next = [...without]
      if (afterId && insertAfterIdx !== -1) {
        next.splice(insertAfterIdx + 1, 0, item)
      } else if (beforeId) {
        const insertBeforeIdx = without.findIndex(i => i.id === beforeId)
        next.splice(Math.max(0, insertBeforeIdx), 0, item)
      } else {
        next.unshift(item)
      }
      return next
    })
    reorderItem(draggedId, beforeId, afterId).catch(() => {
      // revert on error — reset from server data
      setOrderedOpen(allVisible.filter(i => !isPrep(i)))
    })
  }

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
  function handleSnooze(id: string, hours: number = 24) {
    setHiddenIds(s => new Set(s).add(id))
    snoozeItem(id, hours).catch(() => {
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
        setRefreshError(result.error || 'Re-run failed')
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
  // Client-side sort by effective priority so AUTO-assigned defaults
  // float to the top alongside user-set ones (DB sort can't see auto
  // defaults). Stable within priority bucket: preserves the DB-side
  // proposed_action / due_at / first_seen order.
  // DB already orders by sort_order → priority → due_at → first_seen_at.
  // Client keeps a mutable ordered list so optimistic drag reorders are instant.
  const [orderedOpen, setOrderedOpen] = useState<MockItem[]>(() =>
    allVisible.filter(i => !isPrep(i))
  )
  const [orderedPrep, setOrderedPrep] = useState<MockItem[]>(() =>
    allVisible.filter(isPrep)
  )
  // Sync when server data changes (new revalidation, refresh, etc.)
  useEffect(() => {
    setOrderedOpen(allVisible.filter(i => !isPrep(i)))
    setOrderedPrep(allVisible.filter(isPrep))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digest.open_items])
  const visibleOpen = orderedOpen
  const visiblePrep = orderedPrep

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

  // Apply source+tag+function+day filter to the open list. Cleared tab is
  // unfiltered for now (small enough that it doesn't need it).
  const filteredOpen = useMemo(() => {
    let out = visibleOpen
    if (sourceFilter) out = out.filter(i => i.source === sourceFilter)
    if (tagFilter) out = out.filter(i => i.tag === tagFilter)
    if (functionFilter.size > 0) {
      out = out.filter(i => (i.function_ids ?? []).some(fid => functionFilter.has(fid)))
    }
    if (dayFilter) {
      out = out.filter(i => i.due_at && (i.due_at as string).slice(0, 10) === dayFilter)
    }
    return out
  }, [visibleOpen, sourceFilter, tagFilter, functionFilter, dayFilter])

  // Fast lookup map for chip rendering and the multi-select editor.
  const functionsById = useMemo(() => {
    const m = new Map<string, UserFunction>()
    for (const f of functions) m.set(f.id, f)
    return m
  }, [functions])

  const groups = useMemo(() => groupItems(filteredOpen, groupBy, functionsById), [filteredOpen, groupBy, functionsById])

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
    <div className={hideHeader ? '' : 'min-h-screen bg-canvas'}>
      {!hideHeader && (
        <AppHeader
          userInitial={digest.user_initials.charAt(0)}
          userEmail={userEmail}
        />
      )}

      <div className="flex">
        <main
          className={cn(
            'transition-all duration-200',
            hideHeader ? '' : 'mx-auto px-8 pt-4 pb-16',
            selectedItem
              ? 'max-w-[680px]'
              : hideHeader
              ? 'w-full max-w-none'
              : 'max-w-[920px] flex-1'
          )}
        >
          <h1 className="m-0 mb-4 text-[30px] font-semibold tracking-tight text-ink">
            {digest.greeting}
          </h1>

          {/* CalendarStrip removed — month grid + today's events now live
              in the right-column TodayCalendarColumn. */}

          {/* Tabs: Open / Prep / Cleared — shadcn Tabs (pill segment) */}
          <div className="mt-7 flex items-center justify-between">
            <Tabs value={tab} onValueChange={v => setTab(v as 'open' | 'prep' | 'cleared')}>
              <TabsList>
                <TabsTrigger value="open">
                  Open
                  <TabCount active={tab === 'open'}>{visibleOpen.length}</TabCount>
                </TabsTrigger>
                <TabsTrigger value="prep">
                  Prep
                  <TabCount active={tab === 'prep'}>{visiblePrep.length}</TabCount>
                </TabsTrigger>
                <TabsTrigger value="cleared">
                  Cleared today
                  <TabCount active={tab === 'cleared'}>{digest.completed_today_count}</TabCount>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              {onAddTask && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={onAddTask}
                  aria-label="Add task"
                  title="Add a manual task"
                  className="gap-1.5"
                >
                  <Plus size={14} />
                  Add task
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                aria-label="Re-run tasks"
                title="Re-pull latest items from your sources"
                className="gap-1.5"
              >
                {isRefreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Re-run tasks
              </Button>
            </div>
          </div>

          {refreshError && (
            <div className="mt-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
              Re-run failed: {refreshError}
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
              functionsById={functionsById}
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
                functions={functions}
                functionFilter={functionFilter}
                onFunctionToggle={fid => {
                  setFunctionFilter(prev => {
                    const next = new Set(prev)
                    if (next.has(fid)) next.delete(fid)
                    else next.add(fid)
                    return next
                  })
                }}
                onFunctionClear={() => setFunctionFilter(new Set())}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
              />

              {dayFilter && (
                <div className="mt-3 flex items-center justify-between rounded-md border border-line bg-surface-muted/40 px-3 py-2 text-[12px]">
                  <span className="text-ink">
                    Showing tasks due{' '}
                    <strong>{new Date(dayFilter + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => onClearDayFilter?.()}
                    className="rounded px-2 py-0.5 text-[11px] text-ink-faint hover:bg-surface-muted hover:text-ink"
                  >
                    Clear ×
                  </button>
                </div>
              )}

              {filteredOpen.length === 0 ? (
                sourceFilter || tagFilter || functionFilter.size > 0 ? (
                  <FilterEmpty
                    source={sourceFilter}
                    tag={tagFilter}
                    functionCount={functionFilter.size}
                    onClear={() => {
                      setSourceFilter(null)
                      setTagFilter(null)
                      setFunctionFilter(new Set())
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
                        {group.items.map((item, idx) => {
                          const allItems = group.items
                          return (
                            <TaskRow
                              key={item.id}
                              item={item}
                              isSelected={selectedItem?.id === item.id}
                              onSelect={() => setSelectedItem(item)}
                              onComplete={() => handleComplete(item.id)}
                              onDismiss={() => handleDismiss(item.id)}
                              onSnooze={hours => handleSnooze(item.id, hours)}
                              functionsById={functionsById}
                              onReorder={(draggedId, position) => {
                                if (position === 'before') {
                                  const beforeId = idx > 0 ? allItems[idx - 1].id : null
                                  handleReorder(draggedId, beforeId, item.id)
                                } else {
                                  const afterId = idx < allItems.length - 1 ? allItems[idx + 1].id : null
                                  handleReorder(draggedId, item.id, afterId)
                                }
                              }}
                            />
                          )
                        })}
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

        {!hideDetailPanel && selectedItem && (
          <DetailPanel
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onComplete={() => handleComplete(selectedItem.id)}
            allFunctions={functions}
          />
        )}
      </div>
    </div>
  )
}

// ─── Calendar strip ─────────────────────────────────────────────────────

function CalendarStrip({
  dateIso,
  items,
  onSelectItem,
}: {
  dateIso: string
  items: MockItem[]
  onSelectItem?: (item: MockItem) => void
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

  // Group items by day-key. Store the full items so the popover can
  // render clickable titles that open the detail panel.
  const itemsByDay = new Map<string, MockItem[]>()
  for (const item of items) {
    if (!item.due_at) continue
    const d = new Date(item.due_at)
    if (isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const list = itemsByDay.get(key) ?? []
    list.push(item)
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
      dayItems,
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
            {/* Hover popover — clickable item titles open the detail panel.
                pointer-events-auto so the inner buttons receive clicks; the
                whole popover sits over the next row so we make it absolute. */}
            {d.hasItems && (
              <div
                className="absolute top-full left-1/2 z-20 mt-1 w-64 -translate-x-1/2 rounded-md border border-line/70 bg-surface px-2 py-2 text-left text-[12px] leading-snug text-ink shadow-lg opacity-0 transition-opacity group-hover/day:opacity-100 pointer-events-none group-hover/day:pointer-events-auto"
                role="tooltip"
              >
                <p className="m-0 mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {d.dayItems.length} item{d.dayItems.length === 1 ? '' : 's'} due. Click to open
                </p>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {d.dayItems.slice(0, 6).map(it => (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => onSelectItem?.(it)}
                        className="block w-full truncate rounded px-1.5 py-1 text-left text-ink hover:bg-surface-muted"
                        title={it.title}
                      >
                        · {it.title}
                      </button>
                    </li>
                  ))}
                  {d.dayItems.length > 6 && (
                    <li className="px-1.5 text-ink-faint">
                      +{d.dayItems.length - 6} more
                    </li>
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
  functionsById,
  onReorder,
}: {
  item: MockItem
  isSelected: boolean
  onSelect: () => void
  onComplete: () => void
  onDismiss: () => void
  onSnooze: (hours: number) => void
  functionsById?: Map<string, UserFunction>
  onReorder?: (draggedId: string, position: 'before' | 'after') => void
}) {
  const [completed, setCompleted] = useState(false)
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null)
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
    setCompleted(true)
    setTimeout(() => onDismiss(), 250)
  }
  const onSnoozeWithHours = (hours: number) => {
    setCompleted(true)
    setTimeout(() => onSnooze(hours), 250)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', item.id)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (!onReorder) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDragOver(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
  }
  const handleDragLeave = () => setDragOver(null)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const draggedId = e.dataTransfer.getData('text/plain')
    if (draggedId && draggedId !== item.id && dragOver && onReorder) {
      onReorder(draggedId, dragOver)
    }
    setDragOver(null)
  }

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={onSelect}
      className={cn(
        'group relative cursor-pointer pl-12 pr-2 py-4 transition-colors',
        isSelected ? 'bg-success-bg/30' : 'hover:bg-surface-muted/50',
        completed && 'opacity-50',
        dragOver === 'before' && 'border-t-2 border-t-accent',
        dragOver === 'after' && 'border-b-2 border-b-accent',
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
          className="flex size-6 items-center justify-center rounded-md border border-success-fg/40 bg-success-bg text-success-fg hover:bg-success-fg hover:text-canvas"
        >
          <Check size={12} />
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityChip
              itemId={item.id}
              explicit={item.priority ?? null}
              resolved={effectivePriority(item)}
            />
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
            {(item.function_ids ?? []).map(fid => {
              const fn = functionsById?.get(fid)
              if (!fn) return null
              return <FunctionPill key={fid} fn={fn} />
            })}
            {item.due_at && <DeadlineBadge dueIso={item.due_at} />}
          </div>

          <p className="mt-1 truncate text-[13px] text-ink-faint m-0">
            {item.subtitle && item.entities && item.entities.length > 0
              ? renderSubtitleWithEntities(item.subtitle, item.entities as Entity[])
              : item.subtitle || item.brief?.why || item.description || item.parent_context || `From ${item.source}`}
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
                          ? 'border-success-fg bg-success-fg text-canvas'
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
            <SlopMenu
              itemId={item.id}
              onMarked={() => {
                // Fade the row then let the parent revalidate it away.
                setCompleted(true)
                setTimeout(() => onDismiss(), 250)
              }}
            />
            <SnoozeMenu onSnooze={hours => onSnoozeWithHours(hours)} />
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
        variant === 'primary' && 'border-success-fg/40 bg-success-bg text-success-fg hover:bg-success-fg hover:text-canvas',
        variant === 'completed' && 'border-success-fg bg-success-fg text-canvas hover:opacity-80',
        variant === 'default' && 'border-line bg-surface text-ink-faint hover:border-line-strong hover:text-ink'
      )}
    >
      <Icon size={12} />
    </button>
  )
}

// ─── Snooze menu ────────────────────────────────────────────────────────
// Always-clickable Clock icon with a dropdown of common snooze durations.
// Calls onSnooze(hours) which the parent persists via snoozeItem().

function SnoozeMenu({ onSnooze }: { onSnooze: (hours: number) => void }) {
  // Hours-until-tomorrow-9am, computed at click time so it's correct
  // regardless of when the user opens the menu.
  function hoursUntilTomorrow9am(): number {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    return Math.max(1, Math.round((tomorrow.getTime() - now.getTime()) / (1000 * 60 * 60)))
  }
  function hoursUntilNextMonday9am(): number {
    const now = new Date()
    const next = new Date(now)
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7
    next.setDate(now.getDate() + daysUntilMonday)
    next.setHours(9, 0, 0, 0)
    return Math.max(1, Math.round((next.getTime() - now.getTime()) / (1000 * 60 * 60)))
  }

  const options: Array<{ label: string; hours: () => number; hint: string }> = [
    { label: 'In 1 hour', hours: () => 1, hint: 'Back in an hour' },
    { label: 'In 4 hours', hours: () => 4, hint: 'Later today' },
    { label: 'Until tomorrow', hours: hoursUntilTomorrow9am, hint: 'Tomorrow at 9am' },
    { label: 'Until next week', hours: hoursUntilNextMonday9am, hint: 'Monday at 9am' },
  ]

  return (
    <div onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Snooze"
          title="Snooze for later"
          className="flex size-6 items-center justify-center rounded-md border border-line bg-surface text-ink-faint outline-none hover:border-line-strong hover:text-ink"
        >
          <Clock size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {options.map(o => (
            <DropdownMenuItem
              key={o.label}
              onSelect={() => onSnooze(o.hours())}
              className="flex items-center justify-between gap-2 text-[12px]"
            >
              <span className="text-ink">{o.label}</span>
              <span className="text-[11px] text-ink-faint">{o.hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── Slop menu ──────────────────────────────────────────────────────────
// "This shouldn't be here." Captures a training signal (item snapshot +
// the user's category) into the item_feedback table and dismisses the row
// so it leaves the list. Future extraction prompt iterations can replay
// against the slop corpus to verify they would have correctly skipped it.

type SlopReason =
  | 'irrelevant'
  | 'spam'
  | 'low_signal'
  | 'misread_title'
  | 'duplicate'
  | 'old_task'
  | 'other'

const SLOP_OPTIONS: Array<{ key: SlopReason; label: string; hint: string }> = [
  { key: 'irrelevant', label: 'Irrelevant', hint: "Don't extract this kind of thing" },
  { key: 'spam', label: 'Spam / noise', hint: 'Marketing, automated, junk' },
  { key: 'low_signal', label: 'Low signal', hint: "Real, but doesn't need my attention" },
  { key: 'duplicate', label: 'Repeat', hint: 'Already exists as another task' },
  { key: 'old_task', label: 'Old task', hint: 'Stale, no longer relevant' },
  { key: 'misread_title', label: 'Misread', hint: 'Title or details are wrong' },
  { key: 'other', label: 'Other', hint: 'Just wrong' },
]

function SlopMenu({
  itemId,
  onMarked,
}: {
  itemId: string
  onMarked: () => void
}) {
  const [busy, setBusy] = useState(false)

  function pick(reason: SlopReason) {
    setBusy(true)
    markItemSlop(itemId, reason)
      .then(() => onMarked())
      .catch(() => setBusy(false))
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Mark as slop (wrong / irrelevant)"
          disabled={busy}
          title="This shouldn't be here. Help the agent learn"
          className="flex size-6 items-center justify-center rounded-md border border-line bg-surface text-ink-faint outline-none hover:border-danger-fg hover:text-danger-fg disabled:opacity-40"
        >
          <Trash2 size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Why is this slop?</DropdownMenuLabel>
          {SLOP_OPTIONS.map(o => (
            <DropdownMenuItem
              key={o.key}
              onSelect={() => pick(o.key)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="text-[12px] font-medium text-ink">{o.label}</span>
              <span className="text-[11px] text-ink-faint">{o.hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── Function pill ──────────────────────────────────────────────────
// Small colored chip showing a function name. Rendered next to the row
// title; clickable to scope the row's filter (TODO).

function FunctionPill({ fn, onClick }: { fn: UserFunction; onClick?: () => void }) {
  const c = functionColor(fn)
  return (
    <span
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      style={{
        backgroundColor: c + '22', // ~13% alpha tint of the function color
        color: c,
      }}
      title={`Function: ${fn.name}`}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ backgroundColor: c }}
      />
      {fn.name}
    </span>
  )
}

// ─── Functions editor ───────────────────────────────────────────────
// Multi-select dropdown for the DetailPanel. Renders the full list of
// the user's functions as toggleable chips; clicking persists via
// setItemFunctions and updates local state.

function FunctionsEditor({
  itemId,
  initialIds,
  allFunctions,
}: {
  itemId: string
  initialIds: string[]
  allFunctions: UserFunction[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds))
  useEffect(() => {
    setSelected(new Set(initialIds))
  }, [initialIds])

  function toggle(id: string) {
    const prev = new Set(selected)
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    setItemFunctions(itemId, Array.from(next)).catch(() => setSelected(prev))
  }

  if (allFunctions.length === 0) {
    return (
      <div className="mb-5 rounded-lg border border-dashed border-line bg-surface px-3.5 py-3 text-[12px] text-ink-faint">
        No functions defined yet.{' '}
        <Link href="/settings/functions" className="underline hover:text-ink">
          Add some in Settings →
        </Link>
      </div>
    )
  }

  return (
    <div className="mb-5 rounded-lg border border-line/60 bg-canvas/40 px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
          Functions
        </h3>
        <Link
          href="/settings/functions"
          className="text-[11px] text-ink-faint hover:text-ink"
        >
          Manage →
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {allFunctions.map(fn => {
          const isOn = selected.has(fn.id)
          const c = functionColor(fn)
          return (
            <button
              key={fn.id}
              type="button"
              onClick={() => toggle(fn.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors'
              )}
              style={
                isOn
                  ? { backgroundColor: c, borderColor: c, color: '#fff' }
                  : { backgroundColor: 'transparent', borderColor: c + '66', color: c }
              }
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: isOn ? '#fff' : c }}
              />
              {fn.name}
            </button>
          )
        })}
      </div>
    </div>
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

type PrioritySet = 'P0' | 'P1' | 'P2' | 'P3'

const PRIORITY_STYLE: Record<PrioritySet, string> = {
  P0: 'bg-danger-fg text-canvas border-danger-fg',
  P1: 'bg-tag-action-fg text-canvas border-tag-action-fg',
  P2: 'bg-tag-reply-fg text-canvas border-tag-reply-fg',
  P3: 'bg-surface-muted text-ink-muted border-line-strong',
}

// Faded variant for AUTO-assigned defaults — lower contrast so the user
// can tell at a glance which priorities they've explicitly set vs. which
// ones the agent picked. Hover reveals the full color.
const PRIORITY_STYLE_AUTO: Record<PrioritySet, string> = {
  P0: 'bg-danger-bg text-danger-fg border-danger-border',
  P1: 'bg-tag-action-bg text-tag-action-fg border-tag-action-bg',
  P2: 'bg-tag-reply-bg text-tag-reply-fg border-tag-reply-bg',
  P3: 'bg-surface-muted text-ink-muted border-surface-muted',
}

const PRIORITY_OPTIONS: PrioritySet[] = ['P0', 'P1', 'P2', 'P3']

const PRIORITY_RANK: Record<PrioritySet, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * Compute a sensible default priority for an item that has none set
 * explicitly. The user can always override; this just keeps the list
 * pre-ranked the first time they see it so nothing gets buried under
 * "no priority".
 *
 * Rules (first match wins):
 *  - Overdue OR urgent OR due within 6h → P0
 *  - Draft ready, OR due within 24h → P1
 *  - FYI tag → P3
 *  - Everything else → P2
 */
function defaultPriority(item: MockItem): PrioritySet {
  const now = Date.now()
  if (item.due_at) {
    const due = new Date(item.due_at).getTime()
    if (!isNaN(due)) {
      const hours = (due - now) / (1000 * 60 * 60)
      if (hours < 6) return 'P0'
      if (hours < 24) return 'P1'
    }
  }
  if (item.urgent) return 'P0'
  if (item.proposed_action) return 'P1'
  if (item.tag === 'fyi') return 'P3'
  return 'P2'
}

/**
 * The priority the row should sort + display by. Falls back to default
 * when the user hasn't set one explicitly.
 */
function effectivePriority(item: MockItem): PrioritySet {
  return (item.priority as PrioritySet | null) ?? defaultPriority(item)
}

function PriorityChip({
  itemId,
  explicit,
  resolved,
}: {
  itemId: string
  // The priority the user explicitly set (null if they haven't).
  explicit: Priority
  // The priority the row is currently treated as — explicit if set,
  // otherwise the agent's auto-default. Always visible.
  resolved: PrioritySet
}) {
  const [current, setCurrent] = useState<Priority>(explicit)
  const [open, setOpen] = useState(false)
  // What we actually render: the user's choice if any, else the default.
  const displayed: PrioritySet = (current as PrioritySet | null) ?? resolved
  const isAuto = !current

  // Re-sync when the parent passes a new explicit value (after revalidate).
  useEffect(() => {
    setCurrent(explicit)
  }, [explicit])

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
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums uppercase tracking-wider transition-opacity hover:opacity-80',
          isAuto ? PRIORITY_STYLE_AUTO[displayed] : PRIORITY_STYLE[displayed]
        )}
        title={
          isAuto
            ? `Auto-set to ${displayed}. Click to override`
            : `Priority ${displayed}. Click to change`
        }
      >
        {displayed}
      </button>
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
              title="Reset to auto"
            >
              Auto
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
  const outcome = item.reply_outcome
  const pill =
    outcome === 'approved' ? (
      <span className="shrink-0 rounded-full bg-success-bg px-2.5 py-0.5 text-[12px] font-medium text-success-fg">
        Approved
      </span>
    ) : outcome === 'rejected' ? (
      <span className="shrink-0 rounded-full bg-danger-bg px-2.5 py-0.5 text-[12px] font-medium text-danger-fg">
        Rejected
      </span>
    ) : (
      <span className="shrink-0 rounded-full bg-success-bg px-2.5 py-0.5 text-[12px] font-medium text-success-fg">
        Done
      </span>
    )
  return (
    <li className="flex items-start justify-between gap-4 border-b border-line/50 py-4 px-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[15px] font-semibold leading-snug text-ink">
          {item.title}
        </p>
        <p className="mt-1 truncate text-[13px] text-ink-faint m-0">
          {item.subtitle || item.brief?.why || item.description || item.parent_context || `From ${item.source}`}
        </p>
      </div>
      {pill}
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

export function DetailPanel({
  item,
  onClose,
  onComplete,
  allFunctions = [],
}: {
  item: MockItem
  onClose: () => void
  onComplete: () => void
  allFunctions?: UserFunction[]
}) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(item.title)
  const [editDesc, setEditDesc] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setEditTitle(item.title)
    setEditDesc(item.description ?? '')
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      await updateItemDescription(item.id, {
        title: editTitle,
        description: editDesc,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setEditing(false)
    setEditTitle(item.title)
    setEditDesc(item.description ?? '')
  }

  return (
    <aside className="h-full w-full overflow-y-auto bg-surface px-5 py-5">
      {/* Close button is provided by the parent Sheet. Header only carries
          Edit + History, with right padding so they sit clear of Sheet's
          built-in close button (top-4 right-4). onClose stays on the
          props since the optimistic-complete flow in TodayShell needs it. */}
      <div className="mb-4 flex items-center justify-end gap-1 pr-10">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Edit"
          className={cn('h-8 w-8 hover:text-ink', editing ? 'text-ink' : 'text-ink-faint')}
          onClick={editing ? cancelEdit : startEdit}
        >
          <Edit3 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="History"
          className="h-8 w-8 text-ink-faint hover:text-ink"
        >
          <History size={15} />
        </Button>
      </div>

      {editing ? (
        <div className="mb-3">
          <input
            autoFocus
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
            className="mb-2 w-full rounded-md border border-line bg-surface-muted px-3 py-1.5 text-[18px] font-medium text-ink outline-none focus:ring-1 focus:ring-line"
          />
          <textarea
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
            rows={3}
            placeholder="Description (optional)"
            className="w-full resize-none rounded-md border border-line bg-surface-muted px-3 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-line"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={saveEdit}
              disabled={saving || !editTitle.trim()}
              className="rounded-md bg-success-fg px-3 py-1 text-[13px] font-medium text-canvas hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              className="rounded-md border border-line px-3 py-1 text-[13px] font-medium text-ink hover:bg-surface-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-start gap-2">
          <NummoLogo />
          <h2 className="m-0 text-[18px] font-medium leading-snug text-ink">{item.title}</h2>
        </div>
      )}

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

      {/* Function multi-select — Product, People Ops, Hiring, etc. Tag
          this item so it shows up under the right filter on /today. */}
      <FunctionsEditor
        itemId={item.id}
        initialIds={item.function_ids ?? []}
        allFunctions={allFunctions}
      />

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
            Brief pending. Run the brief generator to synthesize context for this task.
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
          className="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-surface-muted"
        >
          Close
        </button>
        {item.proposed_action && item.status !== 'completed' && (
          <button
            onClick={() => {
              rejectDraft(item.id).then(() => {
                onComplete()
                onClose()
              })
            }}
            className="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink-muted hover:bg-surface-muted"
          >
            Reject Draft
          </button>
        )}
        <button
          onClick={() => {
            onComplete()
            onClose()
          }}
          className="flex-1 rounded-md bg-success-fg px-4 py-2 text-[13px] font-medium text-canvas hover:opacity-90"
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
          className="inline-flex items-center gap-1.5 rounded-md bg-success-fg px-3 py-1.5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
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
        <Input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a subtask"
          disabled={busy}
          className="h-7 flex-1 border-0 bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {draft && (
          <Button type="submit" disabled={busy} size="sm" className="h-7 px-2.5">
            Add
          </Button>
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
// Small count pill that sits to the right of a tab label, e.g. "Open · 49".
// Active tab → success-green pill; inactive → muted pill.

function TabCount({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
        active ? 'bg-success-bg text-success-fg' : 'bg-surface-muted text-ink-faint'
      )}
    >
      {children}
    </span>
  )
}

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
  functions,
  functionFilter,
  onFunctionToggle,
  onFunctionClear,
  groupBy,
  onGroupByChange,
}: {
  availableSources: Source[]
  sourceFilter: Source | null
  onSourceChange: (s: Source | null) => void
  availableTags: NonNullable<Tag>[]
  tagFilter: NonNullable<Tag> | null
  onTagChange: (t: NonNullable<Tag> | null) => void
  functions: UserFunction[]
  functionFilter: Set<string>
  onFunctionToggle: (fid: string) => void
  onFunctionClear: () => void
  groupBy: 'none' | 'source' | 'due' | 'function'
  onGroupByChange: (g: 'none' | 'source' | 'due' | 'function') => void
}) {
  const orderedSources = SOURCE_ORDER.filter(s => availableSources.includes(s))
  const orderedTags = TAG_ORDER.filter(t => availableTags.includes(t))
  // Hide the bar entirely when there's nothing to filter or group.
  if (orderedSources.length === 0 && orderedTags.length === 0 && functions.length === 0) return null
  return (
    <Card className="mt-4 space-y-2 bg-surface/40 p-4">
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

      {/* Row 3: Function chips (multi-select) */}
      {functions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Function
          </span>
          <FilterChip active={functionFilter.size === 0} onClick={onFunctionClear}>
            All
          </FilterChip>
          {functions.map(fn => {
            const isOn = functionFilter.has(fn.id)
            const c = functionColor(fn)
            return (
              <button
                key={fn.id}
                type="button"
                onClick={() => onFunctionToggle(fn.id)}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors"
                style={
                  isOn
                    ? { backgroundColor: c, borderColor: c, color: '#fff' }
                    : { backgroundColor: 'transparent', borderColor: c + '66', color: c }
                }
              >
                <span
                  className="inline-block size-1.5 rounded-full"
                  style={{ backgroundColor: isOn ? '#fff' : c }}
                />
                {fn.name}
              </button>
            )
          })}
          <Link
            href="/settings/functions"
            className="ml-1 text-[11px] text-ink-faint underline hover:text-ink"
          >
            Manage
          </Link>
        </div>
      )}
    </Card>
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
  reply: 'border-tag-reply-fg bg-tag-reply-fg text-canvas',
  action: 'border-tag-action-fg bg-tag-action-fg text-canvas',
  commit: 'border-tag-commit-fg bg-tag-commit-fg text-canvas',
  fyi: 'border-ink-muted bg-ink-muted text-canvas',
}

function GroupToggle({
  value,
  onChange,
}: {
  value: 'none' | 'source' | 'due' | 'function'
  onChange: (g: 'none' | 'source' | 'due' | 'function') => void
}) {
  return (
    <Tabs
      value={value}
      onValueChange={v => onChange(v as 'none' | 'source' | 'due' | 'function')}
    >
      <TabsList className="h-7 p-0.5">
        <TabsTrigger value="none" className="h-6 px-2 text-[12px]">None</TabsTrigger>
        <TabsTrigger value="source" className="h-6 px-2 text-[12px]">Source</TabsTrigger>
        <TabsTrigger value="due" className="h-6 px-2 text-[12px]">Due</TabsTrigger>
        <TabsTrigger value="function" className="h-6 px-2 text-[12px]">Function</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

// ─── Grouping ───────────────────────────────────────────────────────────

interface ItemGroup {
  key: string
  label: string | null  // null = no header (used when groupBy = 'none')
  icon?: React.ReactNode
  items: MockItem[]
}

function groupItems(
  items: MockItem[],
  groupBy: 'none' | 'source' | 'due' | 'function',
  functionsById?: Map<string, UserFunction>
): ItemGroup[] {
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
  if (groupBy === 'function') {
    // Items can belong to multiple functions, so they appear in EVERY
    // bucket they're tagged with. Untagged items go to "Unassigned".
    const buckets = new Map<string, MockItem[]>()
    const unassigned: MockItem[] = []
    for (const it of items) {
      const fids = it.function_ids ?? []
      if (fids.length === 0) {
        unassigned.push(it)
        continue
      }
      for (const fid of fids) {
        const list = buckets.get(fid) ?? []
        list.push(it)
        buckets.set(fid, list)
      }
    }
    const out: ItemGroup[] = []
    // Order matches the user's defined function order.
    if (functionsById) {
      for (const [fid, fn] of functionsById.entries()) {
        if (!buckets.has(fid)) continue
        const c = functionColor(fn)
        out.push({
          key: `fn-${fid}`,
          label: fn.name,
          icon: (
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: c }}
            />
          ),
          items: buckets.get(fid) ?? [],
        })
      }
    }
    if (unassigned.length > 0) {
      out.push({
        key: 'fn-unassigned',
        label: 'Unassigned',
        items: unassigned,
      })
    }
    return out
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
  functionsById,
}: {
  items: MockItem[]
  selectedId?: string
  onSelect: (item: MockItem) => void
  onComplete: (id: string) => void
  onDismiss: (id: string) => void
  onSnooze: (id: string, hours: number) => void
  functionsById?: Map<string, UserFunction>
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
        Briefs for upcoming meetings. Read them, then mark done. They don&apos;t
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
            onSnooze={hours => onSnooze(item.id, hours)}
            functionsById={functionsById}
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
          Approve or check off items from the Open tab. They&apos;ll land here.
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
  functionCount = 0,
  onClear,
}: {
  source: Source | null
  tag: NonNullable<Tag> | null
  functionCount?: number
  onClear: () => void
}) {
  // Build a "Gmail + Replies" style description of the active filter.
  const parts: string[] = []
  if (source) parts.push(SOURCE_LABEL[source])
  if (tag) parts.push(TAG_LABEL[tag])
  if (functionCount > 0)
    parts.push(`${functionCount} function${functionCount === 1 ? '' : 's'}`)
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

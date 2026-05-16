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

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  Brain,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Command,
  Edit3,
  ExternalLink,
  Hash,
  History,
  Loader2,
  Mail,
  Mic,
  Pencil,
  RefreshCw,
  RotateCcw,
  UserPlus,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MockDigestSummary, MockItem } from '@/lib/mock-items'
import type { Source, Tag, TaskBrief } from '@/lib/types'
import {
  completeItem,
  dismissItem,
  requestRefresh,
  snoozeItem,
  uncompleteItem,
} from './actions'

// ─── Top-level layout ───────────────────────────────────────────────────

export function TodayView({ digest }: { digest: MockDigestSummary }) {
  const [selectedItem, setSelectedItem] = useState<MockItem | null>(null)
  const [showCompleted, setShowCompleted] = useState(true)
  const [isRefreshing, startRefresh] = useTransition()
  const router = useRouter()

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
      // Wait briefly then revalidate so the user sees motion
      await new Promise(r => setTimeout(r, 600))
      router.refresh()
    })
  }

  const visibleOpen = digest.open_items.filter(i => !hiddenIds.has(i.id))

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
      <AppHeader userInitials={digest.user_initials} />

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

          <CalendarStrip dateIso={digest.date_iso} />

          <StatsRow counts={digest.counts} />

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <NummoLogo />
              <span className="text-[15px] text-ink">{digest.active_tasks_label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success-fg">
                {visibleOpen.length} tasks
              </span>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                aria-label="Refresh"
                className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40"
                title="Re-pull latest items from your sources"
              >
                {isRefreshing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
            </div>
          </div>

          {refreshError && (
            <div className="mt-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-fg">
              Refresh failed: {refreshError}
            </div>
          )}

          {visibleOpen.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="mt-3 list-none p-0 m-0 space-y-2">
              {visibleOpen.map(item => (
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
          )}

          <div className="mt-10">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="flex w-full items-center justify-between border-t border-line py-3 text-xs uppercase tracking-wider text-ink-faint"
            >
              <span className="flex items-center gap-2">
                Completed today
                <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted normal-case tracking-normal">
                  {digest.completed_today_count}
                </span>
                <span className="ml-1 text-[11px] underline">View All</span>
              </span>
              {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showCompleted && (
              <ul className="list-none p-0 m-0">
                {digest.completed_today.map(item => (
                  <CompletedRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </div>
        </main>

        {selectedItem && (
          <DetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
        )}
      </div>
    </div>
  )
}

// ─── App header ─────────────────────────────────────────────────────────

function AppHeader({ userInitials }: { userInitials: string }) {
  return (
    <header className="flex items-center justify-end gap-3 px-6 py-3">
      <button
        aria-label="Command palette"
        className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-faint transition-colors hover:border-line-strong hover:text-ink md:flex"
      >
        <Command size={12} />
        <span className="font-medium">K</span>
        <span className="text-ink-faint">to search</span>
      </button>
      <button
        aria-label="AI assistant"
        className="rounded-full p-2 text-success-fg hover:bg-surface-muted"
      >
        <Brain size={18} />
      </button>
      <button
        aria-label="Notifications"
        className="relative rounded-full p-2 text-success-fg hover:bg-surface-muted"
      >
        <Bell size={18} />
        <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-success-bg text-[9px] font-semibold text-success-fg">
          9+
        </span>
      </button>
      <div className="flex size-7 items-center justify-center rounded-full border border-success-fg bg-success-bg text-[11px] font-semibold text-success-fg">
        {userInitials}
      </div>
    </header>
  )
}

// ─── Calendar strip ─────────────────────────────────────────────────────

function CalendarStrip({ dateIso }: { dateIso: string }) {
  const [year, month, day] = dateIso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const dayOfWeek = date.getDay()
  const sundayOfWeek = new Date(date)
  sundayOfWeek.setDate(date.getDate() - dayOfWeek)

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sundayOfWeek)
    d.setDate(sundayOfWeek.getDate() + i)
    return {
      letter: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][i],
      number: d.getDate(),
      isToday: d.toDateString() === date.toDateString(),
    }
  })

  const monthName = date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    day: 'numeric',
  })

  return (
    <div className="rounded-2xl bg-cal-strip px-6 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-cal-strip-text">{monthName}</span>
        <div className="flex items-center gap-1.5">
          <button
            aria-label="Calendar"
            className="rounded-full bg-white/60 p-1.5 text-cal-strip-text hover:bg-white/80"
          >
            <CalendarIcon size={14} />
          </button>
          <div className="flex items-center gap-1 rounded-full bg-white/60 pl-2 pr-1 text-cal-strip-text">
            <button aria-label="Previous" className="p-1 hover:opacity-70">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-medium px-1">Today</span>
            <button aria-label="Next" className="p-1 hover:opacity-70">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-center">
        {days.map((d, i) => (
          <div key={i} className="text-xs font-medium text-cal-strip-text/70">
            {d.letter}
          </div>
        ))}
        {days.map((d, i) => (
          <div key={`n-${i}`} className="flex justify-center pt-1">
            {d.isToday ? (
              <div className="flex size-9 items-center justify-center rounded-full bg-cal-strip-active text-sm font-medium text-white">
                {d.number}
              </div>
            ) : (
              <div className="flex size-9 items-center justify-center text-sm font-medium text-cal-strip-text">
                {d.number}
              </div>
            )}
          </div>
        ))}
      </div>
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
  const [subDone, setSubDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((item.sub_items ?? []).map(s => [s.id, !!s.completed]))
  )

  const toggleSub = (id: string) => setSubDone(prev => ({ ...prev, [id]: !prev[id] }))
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
        'group relative cursor-pointer rounded-lg border border-line/60 bg-surface px-4 py-3.5 transition-all',
        item.tag &&
          [
            'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r',
            TAG_BORDER[item.tag],
          ].join(' '),
        isSelected
          ? 'border-success-fg/40 bg-success-bg/20 shadow-sm'
          : 'hover:border-line-strong hover:shadow-sm',
        completed && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-3">
        <SourceIcon source={item.source} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-[15px] font-medium leading-snug text-ink',
                completed && 'line-through text-ink-faint'
              )}
            >
              {item.title}
            </span>
            {item.tag && <TagPill tag={item.tag} />}
            {item.due_at && <DeadlineBadge dueIso={item.due_at} />}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-faint m-0">
            {item.parent_context && <span>{item.parent_context}</span>}
            {item.parent_context && item.age_days > 0 && <span>·</span>}
            {item.age_days > 0 && <span>{item.age_days}d old</span>}
            {item.count_label && (
              <>
                <span>·</span>
                <span>{item.count_label}</span>
              </>
            )}
          </p>

          {item.sub_items && item.sub_items.length > 0 && (
            <ul className="mt-2 list-none p-0 m-0 space-y-1">
              {item.sub_items.map(sub => {
                const isDone = !!subDone[sub.id]
                return (
                  <li
                    key={sub.id}
                    className="flex items-center gap-2 text-[13px]"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggleSub(sub.id)}
                      className="size-3.5 cursor-pointer rounded border-line"
                      aria-label={sub.title}
                    />
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
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {item.status_label && (
            <span
              className={cn(
                'text-[12px]',
                item.status_label_tone === 'success' && 'text-success-fg',
                item.status_label_tone === 'danger' && 'text-danger-fg',
                item.status_label_tone === 'warning' && 'text-tag-action-fg',
                item.status_label_tone === 'info' && 'text-ink-muted',
                !item.status_label_tone && 'text-ink-muted'
              )}
            >
              {item.status_label}
            </span>
          )}
          <div
            className={cn(
              'flex gap-1 transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isSelected && 'opacity-100'
            )}
          >
            <ActionButton icon={X} label="Dismiss" onClick={handleDismissClick} />
            <ActionButton
              icon={UserPlus}
              label="Reassign"
              onClick={e => e.stopPropagation()}
            />
            <ActionButton icon={Clock} label="Snooze 24h" onClick={handleSnoozeClick} />
            <ActionButton
              icon={Check}
              label="Complete"
              variant="primary"
              onClick={handleCompleteClick}
            />
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

function SourceIcon({ source }: { source: Source }) {
  const map: Record<Source, { icon: React.ComponentType<{ size?: number; className?: string }>; tooltip: string }> = {
    granola: { icon: Mic, tooltip: 'Granola' },
    gmail: { icon: Mail, tooltip: 'Gmail' },
    slack: { icon: Hash, tooltip: 'Slack' },
    manual: { icon: Pencil, tooltip: 'Manual' },
  }
  const entry = map[source] || { icon: Pencil, tooltip: source }
  const Icon = entry.icon
  return (
    <div
      title={entry.tooltip}
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-muted"
    >
      <Icon size={14} />
    </div>
  )
}

// ─── Completed row ──────────────────────────────────────────────────────

function CompletedRow({ item }: { item: MockItem }) {
  return (
    <li className="flex items-center justify-between border-b border-line/40 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SourceIcon source={item.source} />
        <div>
          <p className="m-0 text-[14px] text-ink leading-snug line-through opacity-70">
            {item.title}
          </p>
          {item.count_label && (
            <p className="mt-0.5 text-[12px] text-ink-faint m-0">{item.count_label}</p>
          )}
        </div>
      </div>
      <span className="rounded-full bg-success-bg px-2.5 py-0.5 text-[12px] font-medium text-success-fg">
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

function DetailPanel({ item, onClose }: { item: MockItem; onClose: () => void }) {
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

      <div className="mb-4 flex items-center justify-between">
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

      {/* The brief — the differentiator. Why / Know / Done / Next. */}
      {item.brief ? (
        <BriefView brief={item.brief} />
      ) : (
        <div className="mb-5 rounded-md border border-line/60 bg-surface-muted/50 px-3.5 py-3">
          <p className="m-0 text-[13px] text-ink-muted">
            {item.description || 'No brief generated for this task yet.'}
          </p>
          <p className="m-0 mt-1 text-[12px] text-ink-faint">
            Brief pending — run the brief generator to synthesize context for this task.
          </p>
        </div>
      )}

      {/* Legacy mock transcript pull — only shows for mock data, real items use the brief */}
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
        <button className="flex-1 rounded-md border border-line bg-surface px-4 py-2 text-[14px] font-medium text-ink hover:bg-surface-muted">
          Reject Task
        </button>
        <button className="flex-1 rounded-md bg-success-fg px-4 py-2 text-[14px] font-medium text-white hover:opacity-90">
          <Check size={14} className="-mt-0.5 mr-1 inline" />
          Mark as Done
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-[13px] text-ink-muted">
        <button className="flex items-center gap-1.5 hover:text-ink">
          <Clock size={13} />
          Remind me later
        </button>
        <span className="text-ink-faint">·</span>
        <button className="flex items-center gap-1.5 hover:text-ink">
          <RotateCcw size={13} />
          Reassign
        </button>
      </div>
    </aside>
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

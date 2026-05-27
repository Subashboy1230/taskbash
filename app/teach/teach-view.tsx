'use client'

// Prototype — Mass auto-teach view.
// Two-column layout: suggested rules on the right, candidate items on the left
// with bulk-select + an apply-teach action bar.
// All state is local; no server writes wired yet.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Brain,
  Calendar as CalendarIcon,
  Check,
  Clock,
  Filter,
  Hash,
  Mail,
  Mic,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Source, Tag } from '@/lib/types'
import type { SuggestedRule, TeachCandidate } from '@/lib/mock-teach'

type TeachAction =
  | { kind: 'tag'; tag: NonNullable<Tag> }
  | { kind: 'dismiss' }
  | { kind: 'snooze'; hours: number }
  | { kind: 'route'; route: string }

const TAG_PILL: Record<NonNullable<Tag>, string> = {
  reply: 'bg-tag-reply-bg text-tag-reply-fg',
  action: 'bg-tag-action-bg text-tag-action-fg',
  commit: 'bg-tag-commit-bg text-tag-commit-fg',
  fyi: 'bg-tag-fyi-bg text-tag-fyi-fg',
}

export function TeachView({
  candidates,
  rules,
}: {
  candidates: TeachCandidate[]
  rules: SuggestedRule[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [appliedRules, setAppliedRules] = useState<Set<string>>(new Set())
  const [dismissedRules, setDismissedRules] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | Source>('all')
  const [taughtIds, setTaughtIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  const visible = useMemo(
    () =>
      candidates.filter(c => !taughtIds.has(c.id) && (filter === 'all' || c.source === filter)),
    [candidates, filter, taughtIds]
  )

  const allVisibleSelected = visible.length > 0 && visible.every(c => selected.has(c.id))

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        visible.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        visible.forEach(c => next.add(c.id))
        return next
      })
    }
  }

  function applyTeach(action: TeachAction) {
    if (selected.size === 0) return
    setTaughtIds(prev => new Set([...prev, ...selected]))
    setToast(`Taught ${selected.size} item${selected.size > 1 ? 's' : ''} — ${describeAction(action)}.`)
    setSelected(new Set())
    setTimeout(() => setToast(null), 2400)
  }

  function acceptRule(rule: SuggestedRule) {
    setAppliedRules(prev => new Set(prev).add(rule.id))
    // Auto-clear any visible candidates that match this rule's pattern
    setTaughtIds(prev => {
      const next = new Set(prev)
      candidates
        .filter(c => c.source_pattern === rule.pattern)
        .forEach(c => next.add(c.id))
      return next
    })
    setToast(`Rule applied — ${rule.matched_count} items folded in.`)
    setTimeout(() => setToast(null), 2400)
  }
  function rejectRule(rule: SuggestedRule) {
    setDismissedRules(prev => new Set(prev).add(rule.id))
  }

  const visibleRules = rules.filter(
    r => !appliedRules.has(r.id) && !dismissedRules.has(r.id)
  )

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar />

      <main className="mx-auto max-w-[1180px] px-8 pb-24 pt-2">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 text-[12px] text-ink-faint">
              <Sparkles size={12} />
              <span className="uppercase tracking-wider">Mass auto-teach</span>
            </div>
            <h1 className="m-0 mt-1 text-[28px] font-semibold tracking-tight text-ink">
              Teach the digest, in bulk
            </h1>
            <p className="m-0 mt-1 max-w-[640px] text-[14px] text-ink-muted">
              Review what the extractor was unsure about. Apply tags, route to other inboxes, or
              dismiss patterns — the system learns from every choice so tomorrow's digest is
              cleaner.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-ink-muted">
            <span className="rounded-full bg-surface-muted px-2.5 py-1 font-medium">
              {visible.length} pending
            </span>
            <span className="rounded-full bg-success-bg px-2.5 py-1 font-medium text-success-fg">
              {taughtIds.size} taught
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* ─── Left: candidate list ──────────────────────────────────── */}
          <section>
            <FilterBar
              filter={filter}
              onChange={setFilter}
              counts={countBySource(candidates, taughtIds)}
              allSelected={allVisibleSelected}
              onToggleAll={toggleAllVisible}
              visibleCount={visible.length}
              selectedCount={selected.size}
            />

            {visible.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="mt-3 list-none p-0 m-0 space-y-2">
                {visible.map(c => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    checked={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ─── Right: suggested rules ────────────────────────────────── */}
          <aside className="space-y-3">
            <div className="flex items-center gap-2">
              <Brain size={14} className="text-success-fg" />
              <span className="text-[12px] font-medium uppercase tracking-wider text-ink-faint">
                Suggested rules
              </span>
              <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                {visibleRules.length}
              </span>
            </div>
            {visibleRules.length === 0 ? (
              <div className="rounded-lg border border-line/60 bg-surface px-4 py-6 text-center text-[13px] text-ink-muted">
                No new patterns detected. We'll re-scan after tomorrow's digest.
              </div>
            ) : (
              visibleRules.map(rule => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onAccept={() => acceptRule(rule)}
                  onReject={() => rejectRule(rule)}
                />
              ))
            )}

            {appliedRules.size > 0 && (
              <div className="mt-4 rounded-lg border border-success-fg/30 bg-success-bg px-3 py-2 text-[12px] text-success-fg">
                <Check size={12} className="-mt-0.5 mr-1 inline" />
                {appliedRules.size} rule{appliedRules.size > 1 ? 's' : ''} active. The digest will
                apply them on the next run.
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* ─── Apply-teach action bar ─────────────────────────────────── */}
      {selected.size > 0 && <ActionBar count={selected.size} onApply={applyTeach} onClear={() => setSelected(new Set())} />}

      {/* ─── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Top bar ────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <header className="flex items-center justify-between px-6 py-3">
      <Link
        href="/today"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to today
      </Link>
      <div className="flex items-center gap-2 text-[12px] text-ink-faint">
        <span className="hidden sm:inline">Prototype</span>
        <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-medium text-ink-muted">
          v0
        </span>
      </div>
    </header>
  )
}

// ─── Filter bar ─────────────────────────────────────────────────────────

function FilterBar({
  filter,
  onChange,
  counts,
  allSelected,
  onToggleAll,
  visibleCount,
  selectedCount,
}: {
  filter: 'all' | Source
  onChange: (f: 'all' | Source) => void
  counts: Record<'all' | Source, number>
  allSelected: boolean
  onToggleAll: () => void
  visibleCount: number
  selectedCount: number
}) {
  const tabs: Array<{ id: 'all' | Source; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'gmail', label: 'Gmail' },
    { id: 'slack', label: 'Slack' },
    { id: 'granola', label: 'Granola' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'linear', label: 'Linear' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-surface px-3 py-2">
      <label className="flex cursor-pointer items-center gap-2 px-1 text-[13px] text-ink-muted">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          disabled={visibleCount === 0}
          className="size-3.5 cursor-pointer rounded border-line"
        />
        {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
      </label>
      <span className="text-ink-faint">·</span>
      <Filter size={12} className="text-ink-faint" />
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map(t => {
          const count = counts[t.id] ?? 0
          if (t.id !== 'all' && count === 0) return null
          const active = filter === t.id
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                active
                  ? 'bg-accent text-white'
                  : 'bg-transparent text-ink-muted hover:bg-surface-muted'
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  active ? 'bg-white/20 text-white' : 'bg-surface-muted text-ink-faint'
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function countBySource(
  candidates: TeachCandidate[],
  taughtIds: Set<string>
): Record<'all' | Source, number> {
  const acc: Record<string, number> = { all: 0, gmail: 0, slack: 0, granola: 0, calendar: 0, linear: 0, manual: 0 }
  for (const c of candidates) {
    if (taughtIds.has(c.id)) continue
    acc.all += 1
    acc[c.source] = (acc[c.source] ?? 0) + 1
  }
  return acc as Record<'all' | Source, number>
}

// ─── Candidate row ──────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: TeachCandidate
  checked: boolean
  onToggle: () => void
}) {
  const confPct = Math.round(candidate.confidence * 100)
  const confTone =
    candidate.confidence < 0.5
      ? 'bg-danger-bg text-danger-fg'
      : candidate.confidence < 0.75
        ? 'bg-tag-action-bg text-tag-action-fg'
        : 'bg-success-bg text-success-fg'

  return (
    <li
      onClick={onToggle}
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-lg border bg-surface px-4 py-3 transition-all',
        checked
          ? 'border-accent/40 bg-accent-soft/40 shadow-sm'
          : 'border-line/60 hover:border-line-strong hover:shadow-sm'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={e => e.stopPropagation()}
        className="mt-1 size-3.5 cursor-pointer rounded border-line"
        aria-label={`Select ${candidate.title}`}
      />
      <SourceIcon source={candidate.source} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium leading-snug text-ink">{candidate.title}</span>
          {candidate.current_tag && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                TAG_PILL[candidate.current_tag]
              )}
            >
              {candidate.current_tag}
            </span>
          )}
          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', confTone)}>
            {confPct}% confident
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-faint m-0">
          <span>{candidate.source_pattern}</span>
          <span>·</span>
          <span>{candidate.age_days}d ago</span>
        </p>
        <p className="mt-1.5 truncate text-[12px] italic text-ink-muted m-0">
          "{candidate.example_snippet}"
        </p>
      </div>
    </li>
  )
}

// ─── Rule card ──────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onAccept,
  onReject,
}: {
  rule: SuggestedRule
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-lg border border-line/60 bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SourceIcon source={rule.source} compact />
            <span className="text-[13px] font-medium text-ink">{rule.pattern}</span>
          </div>
          <p className="mt-1 text-[12px] text-ink-muted m-0">{rule.reasoning}</p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          {rule.matched_count} items
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <ProposedActionPill action={rule.proposed_action} />
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onReject}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-muted hover:border-line-strong hover:text-ink"
          >
            Skip
          </button>
          <button
            onClick={onAccept}
            className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:bg-accent-strong"
          >
            Apply rule
          </button>
        </div>
      </div>
    </div>
  )
}

function ProposedActionPill({ action }: { action: SuggestedRule['proposed_action'] }) {
  const label = describeAction(action)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1 text-[11px] font-medium text-ink-muted">
      <Sparkles size={11} />
      {label}
    </span>
  )
}

function describeAction(action: TeachAction): string {
  switch (action.kind) {
    case 'tag':
      return `Always tag as ${action.tag}`
    case 'dismiss':
      return 'Always dismiss'
    case 'snooze':
      return `Auto-snooze ${action.hours}h`
    case 'route':
      return `Route to ${action.route}`
  }
}

// ─── Action bar ─────────────────────────────────────────────────────────

function ActionBar({
  count,
  onApply,
  onClear,
}: {
  count: number
  onApply: (a: TeachAction) => void
  onClear: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-lg">
        <span className="px-2 text-[13px] font-medium text-ink">
          {count} selected
        </span>
        <span className="h-5 w-px bg-line" />

        <ActionBarButton onClick={() => onApply({ kind: 'tag', tag: 'reply' })}>
          <span className={cn('inline-block size-2 rounded-full', 'bg-tag-reply-fg')} />
          Tag reply
        </ActionBarButton>
        <ActionBarButton onClick={() => onApply({ kind: 'tag', tag: 'action' })}>
          <span className={cn('inline-block size-2 rounded-full', 'bg-tag-action-fg')} />
          Tag action
        </ActionBarButton>
        <ActionBarButton onClick={() => onApply({ kind: 'tag', tag: 'fyi' })}>
          <span className={cn('inline-block size-2 rounded-full', 'bg-tag-fyi-fg')} />
          Tag FYI
        </ActionBarButton>

        <span className="h-5 w-px bg-line" />

        <ActionBarButton onClick={() => onApply({ kind: 'snooze', hours: 24 })}>
          <Clock size={12} />
          Snooze 24h
        </ActionBarButton>
        <ActionBarButton onClick={() => onApply({ kind: 'dismiss' })} variant="danger">
          <Trash2 size={12} />
          Dismiss
        </ActionBarButton>

        <span className="h-5 w-px bg-line" />

        <button
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded-full p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

function ActionBarButton({
  children,
  onClick,
  variant = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
        variant === 'danger'
          ? 'text-danger-fg hover:bg-danger-bg'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

// ─── Source icon ────────────────────────────────────────────────────────

function SourceIcon({ source, compact = false }: { source: Source; compact?: boolean }) {
  const map: Record<
    Source,
    { icon: React.ComponentType<{ size?: number; className?: string }>; tooltip: string }
  > = {
    granola: { icon: Mic, tooltip: 'Granola' },
    gmail: { icon: Mail, tooltip: 'Gmail' },
    calendar: { icon: CalendarIcon, tooltip: 'Google Calendar' },
    slack: { icon: Hash, tooltip: 'Slack' },
    linear: { icon: Hash, tooltip: 'Linear' },
    manual: { icon: Pencil, tooltip: 'Manual' },
  }
  const entry = map[source] || { icon: Pencil, tooltip: source }
  const Icon = entry.icon
  return (
    <div
      title={entry.tooltip}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-muted',
        compact ? 'size-5' : 'mt-0.5 size-7'
      )}
    >
      <Icon size={compact ? 11 : 14} />
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="mt-3 rounded-lg border border-line/60 bg-surface px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-success-bg text-success-fg">
        <Check size={18} />
      </div>
      <p className="m-0 text-[15px] font-medium text-ink">Nothing left to teach</p>
      <p className="mt-1 text-[13px] text-ink-muted m-0">
        Every uncertain item has been resolved. Tomorrow's digest will be sharper.
      </p>
    </div>
  )
}

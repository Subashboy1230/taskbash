'use client'

// AgentActivityPanel — the live "what the agent is doing" view that
// replaces the calendar column while a digest Re-run is in flight, and
// the read-only replay opened from the history icon.
//
// Live mode polls GET /api/runs/[runId]/steps ~1s until the run reaches a
// terminal status, then shows a summary and auto-closes. History mode lists
// recent runs (server action) and replays a selected run's steps.

import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  Layers,
  Loader2,
  Minus,
  Play,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandLogo } from '@/app/_components/brand-logo'
import { getRecentRunsAction } from './run-activity-actions'
import type { RunStep, RunStepPhase, RunStepStatus } from '@/lib/types'
import type { RecentRun, RunSummary } from '@/lib/load-run-steps'

const COLUMN_CLASS =
  'sticky top-0 h-screen w-[384px] shrink-0 border-l border-line bg-canvas overflow-y-auto'

const PHASE_ICON: Record<string, typeof Sparkles> = {
  start: Play,
  classify: Layers,
  diff: GitCompare,
  finalize: Sparkles,
  done: Sparkles,
  error: AlertTriangle,
}

function isTerminal(status: string | null | undefined): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'superseded'
}

function StatusGlyph({ status }: { status: RunStepStatus }) {
  if (status === 'running')
    return <Loader2 size={14} className="animate-spin text-ink-muted" />
  if (status === 'done') return <Check size={14} className="text-success-fg" />
  if (status === 'skipped') return <Minus size={14} className="text-ink-muted" />
  return <AlertTriangle size={14} className="text-danger-fg" />
}

function StepLeading({ step }: { step: RunStep }) {
  const useBrand =
    step.phase === 'source' && step.source && step.source !== 'manual'
  const PhaseGlyph = PHASE_ICON[step.phase] ?? Sparkles
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg border',
        step.status === 'failed'
          ? 'border-danger-fg/30 bg-danger-bg'
          : step.status === 'running'
            ? 'border-line bg-surface'
            : step.status === 'skipped'
              ? 'border-line bg-surface-muted opacity-60'
              : 'border-line bg-surface'
      )}
    >
      {useBrand ? (
        <BrandLogo brand={step.source!} size={18} />
      ) : (
        <PhaseGlyph size={15} className="text-ink-muted" />
      )}
    </div>
  )
}

function StepRow({ step, isLast }: { step: RunStep; isLast: boolean }) {
  const [open, setOpen] = useState(false)
  const d = step.detail
  const hasDetail = !!(d && (d.tool || d.model || d.prompt_id || d.note))
  return (
    <div className="flex gap-3 animate-fade-in-up">
      <div className="flex flex-col items-center">
        <StepLeading step={step} />
        {!isLast && <div className="mt-1 w-px flex-1 bg-line" />}
      </div>
      <div className={cn('min-w-0 flex-1 pt-1', isLast ? 'pb-1' : 'pb-4')}>
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'text-sm leading-snug',
              step.status === 'skipped' ? 'text-ink-muted' : 'text-ink'
            )}
          >
            {step.label}
          </span>
          <span className="mt-0.5 shrink-0">
            <StatusGlyph status={step.status} />
          </span>
        </div>
        {(hasDetail ||
          (typeof step.item_count === 'number' &&
            step.item_count > 0 &&
            step.phase === 'source')) && (
          <div className="mt-1 flex items-center gap-2.5">
            {hasDetail && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted transition-colors hover:text-ink"
              >
                <ChevronRight
                  size={11}
                  className={cn('transition-transform', open && 'rotate-90')}
                />
                Details
              </button>
            )}
          </div>
        )}
        {open && hasDetail && (
          <div className="mt-1.5 space-y-0.5 rounded-md border border-line bg-surface-muted px-2.5 py-2 text-[11px] leading-relaxed text-ink-muted">
            {d?.tool && (
              <div>
                <span className="opacity-60">Tool:</span> {d.tool}
              </div>
            )}
            {d?.model && (
              <div>
                <span className="opacity-60">Model:</span> {d.model}
              </div>
            )}
            {d?.prompt_id && (
              <div>
                <span className="opacity-60">Prompt:</span> {d.prompt_id}
                {d.prompt_version ? ` v${d.prompt_version}` : ''}
              </div>
            )}
            {d?.note && <div className="opacity-90">{d.note}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Timeline({
  steps,
  loading,
}: {
  steps: RunStep[]
  loading: boolean
}) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Loader2 size={22} className="animate-spin text-ink-muted" />
        <p className="text-sm text-ink-muted">
          {loading ? 'Starting your refresh…' : 'No steps recorded for this run.'}
        </p>
      </div>
    )
  }
  return (
    <div className="px-4 py-3">
      {steps.map((s, i) => (
        <StepRow key={s.id} step={s} isLast={i === steps.length - 1} />
      ))}
    </div>
  )
}

function SummaryBanner({ run }: { run: RunSummary | null }) {
  const failed = run?.status === 'failed'
  const newCount = run?.new_count ?? 0
  return (
    <div
      className={cn(
        'mx-4 mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 animate-fade-in-up',
        failed
          ? 'border-danger-fg/30 bg-danger-bg'
          : 'border-success-fg/30 bg-success-bg'
      )}
    >
      {failed ? (
        <AlertTriangle size={16} className="shrink-0 text-danger-fg" />
      ) : (
        <Sparkles size={16} className="shrink-0 text-success-fg" />
      )}
      <p
        className={cn(
          'text-sm font-medium',
          failed ? 'text-danger-fg' : 'text-success-fg'
        )}
      >
        {failed
          ? 'The refresh ran into a problem'
          : newCount > 0
            ? `All done — ${newCount} new ${newCount === 1 ? 'task' : 'tasks'} added`
            : "All done — you're all caught up"}
      </p>
    </div>
  )
}

interface AgentActivityPanelProps {
  mode: 'live' | 'history'
  /** The run to watch live (mode === 'live'). */
  liveRunId?: string | null
  onClose: () => void
  /** Called once when a live run reaches a terminal status, before auto-close. */
  onFinished?: () => void
}

export function AgentActivityPanel({
  mode,
  liveRunId,
  onClose,
  onFinished,
}: AgentActivityPanelProps) {
  const [steps, setSteps] = useState<RunStep[]>([])
  const [run, setRun] = useState<RunSummary | null>(null)
  const [recentRuns, setRecentRuns] = useState<RecentRun[] | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Keep callbacks in refs so the polling effect doesn't resubscribe when the
  // parent re-renders with new function identities.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  // ── Live polling ────────────────────────────────────────────────────────
  const finishedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'live' || !liveRunId) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    finishedRef.current = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/runs/${liveRunId}/steps`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const data = (await res.json()) as {
            run: RunSummary | null
            steps: RunStep[]
          }
          if (!active) return
          setSteps(data.steps ?? [])
          setRun(data.run ?? null)
          if (isTerminal(data.run?.status)) {
            if (!finishedRef.current) {
              finishedRef.current = true
              onFinishedRef.current?.()
              timer = setTimeout(() => {
                if (active) onCloseRef.current()
              }, 2800)
            }
            return // stop polling
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (active) timer = setTimeout(tick, 1000)
    }
    tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [mode, liveRunId])

  // ── History: load the recent-runs list ───────────────────────────────────
  useEffect(() => {
    if (mode !== 'history') return
    let active = true
    getRecentRunsAction().then((r) => {
      if (active) setRecentRuns(r)
    })
    return () => {
      active = false
    }
  }, [mode])

  // ── History: fetch a selected run's steps once ────────────────────────────
  useEffect(() => {
    if (mode !== 'history' || !selectedRunId) return
    let active = true
    setSteps([])
    setRun(null)
    fetch(`/api/runs/${selectedRunId}/steps`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { run: RunSummary | null; steps: RunStep[] }) => {
        if (!active) return
        setSteps(data.steps ?? [])
        setRun(data.run ?? null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [mode, selectedRunId])

  const terminal = isTerminal(run?.status)
  const liveLoading = mode === 'live' && !terminal

  // ── History list view ────────────────────────────────────────────────────
  if (mode === 'history' && !selectedRunId) {
    return (
      <div className={COLUMN_CLASS}>
        <Header title="Run history" onClose={onClose} />
        {recentRuns === null ? (
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin text-ink-muted" />
          </div>
        ) : recentRuns.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-ink-muted">
            No runs yet. Hit Re-run tasks to see the agent work.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {recentRuns.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRunId(r.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RunStatusDot status={r.status} />
                      <span className="truncate text-sm text-ink">
                        {r.trigger === 'cron' ? 'Morning digest' : 'Manual re-run'}
                      </span>
                    </div>
                    <span className="text-[11px] text-ink-muted">
                      {r.started_at
                        ? formatDistanceToNow(new Date(r.started_at), {
                            addSuffix: true,
                          })
                        : 'pending'}
                      {typeof r.new_count === 'number'
                        ? ` · ${r.new_count} new`
                        : ''}
                    </span>
                  </div>
                  <ChevronRight size={15} className="shrink-0 text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // ── Timeline view (live, or a selected history run) ───────────────────────
  const headerTitle =
    mode === 'live'
      ? terminal
        ? 'Refresh complete'
        : 'Refreshing your tasks'
      : run?.trigger === 'cron'
        ? 'Morning digest'
        : 'Manual re-run'

  return (
    <div className={COLUMN_CLASS}>
      <Header
        title={headerTitle}
        onClose={onClose}
        onBack={
          mode === 'history' ? () => setSelectedRunId(null) : undefined
        }
        subtitle={
          mode === 'live' && !terminal
            ? 'Watching the agent work through your sources'
            : undefined
        }
      />
      {terminal && mode === 'live' && <SummaryBanner run={run} />}
      <Timeline steps={steps} loading={liveLoading} />
    </div>
  )
}

function Header({
  title,
  subtitle,
  onClose,
  onBack,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  onBack?: () => void
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to run history"
              className="-ml-1 rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      {subtitle && <p className="mt-0.5 text-[11px] text-ink-muted">{subtitle}</p>}
    </div>
  )
}

function RunStatusDot({ status }: { status: string | null }) {
  const cls =
    status === 'succeeded'
      ? 'bg-success-fg'
      : status === 'failed'
        ? 'bg-danger-fg'
        : status === 'running'
          ? 'bg-tag-action-fg'
          : 'bg-ink-muted'
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cls)} />
}

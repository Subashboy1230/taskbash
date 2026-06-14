'use client'

// AgentActivityPanel
//
// LIVE mode: plays a hardcoded, scripted demo sequence (see mock-run.ts) on
// every Re-run, round-robin across a few variants. It does NOT run the real
// digest — it's UI theater for the demo. Each step appears, spins, then
// resolves on its own timeline; at the end it shows a summary and auto-closes.
//
// HISTORY mode: read-only replay of real past runs (run_steps), opened from
// the history icon above the calendar.

import { useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  Layers,
  ListChecks,
  Loader2,
  Minus,
  Play,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandLogo } from '@/app/_components/brand-logo'
import { getRecentRunsAction } from './run-activity-actions'
import { pickMockRun, type MockRun } from './mock-run'
import type { RunStep, RunStepDetail, RunStepStatus } from '@/lib/types'
import type { RecentRun, RunSummary } from '@/lib/load-run-steps'

const COLUMN_CLASS =
  'sticky top-0 h-screen w-[384px] shrink-0 border-l border-line bg-canvas overflow-y-auto'

// Icons for non-source steps (sources use their brand logo via BrandLogo).
const ICON_MAP: Record<string, typeof Sparkles> = {
  start: Play,
  classify: Layers,
  diff: GitCompare,
  done: Sparkles,
  error: AlertTriangle,
  tasks: ListChecks,
}

// What the timeline renderer needs — satisfied by both the mock and real runs.
interface DisplayStep {
  id: string
  source: string | null
  img?: string
  iconKey?: string
  status: RunStepStatus
  label: string
  subLabel?: string
  detail: RunStepDetail | null
  itemCount: number | null
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

function StepLeading({ step }: { step: DisplayStep }) {
  const useBrand = step.source && step.source !== 'manual'
  const Glyph = (step.iconKey && ICON_MAP[step.iconKey]) || Sparkles
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border',
        step.status === 'failed'
          ? 'border-danger-fg/30 bg-danger-bg'
          : step.status === 'skipped'
            ? 'border-line bg-surface-muted opacity-60'
            : 'border-line bg-surface'
      )}
    >
      {step.img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={step.img}
          alt=""
          width={20}
          height={20}
          className="rounded"
          style={{ objectFit: 'contain' }}
        />
      ) : useBrand ? (
        <BrandLogo brand={step.source as never} size={18} />
      ) : (
        <Glyph size={15} className="text-ink-muted" />
      )}
    </div>
  )
}

function StepRow({ step, isLast }: { step: DisplayStep; isLast: boolean }) {
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
        {step.subLabel && step.status === 'running' && (
          <div className="mt-0.5 text-[11px] text-ink-muted">{step.subLabel}</div>
        )}
        {hasDetail && (
          <div className="mt-1">
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

function Timeline({ steps, loading }: { steps: DisplayStep[]; loading: boolean }) {
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

function SummaryBanner({ label, failed }: { label: string; failed: boolean }) {
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
        {failed ? 'The refresh ran into a problem' : `All done — ${label}`}
      </p>
    </div>
  )
}

interface AgentActivityPanelProps {
  mode: 'live' | 'history'
  liveRunId?: string | null
  onClose: () => void
  onFinished?: () => void
}

export function AgentActivityPanel({ mode, onClose, onFinished }: AgentActivityPanelProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  // ── LIVE: scripted demo player ────────────────────────────────────────────
  const [variant] = useState<MockRun | null>(() =>
    mode === 'live' ? pickMockRun() : null
  )
  const [elapsed, setElapsed] = useState(0)
  const doneRef = useRef(false)
  useEffect(() => {
    if (mode !== 'live' || !variant) return
    doneRef.current = false
    const started = performance.now()
    const iv = setInterval(() => {
      const e = performance.now() - started
      setElapsed(e)
      if (e >= variant.closeAt && !doneRef.current) {
        doneRef.current = true
        clearInterval(iv)
        onFinishedRef.current?.()
        onCloseRef.current()
      }
    }, 120)
    return () => clearInterval(iv)
  }, [mode, variant])

  // ── HISTORY: real past runs ───────────────────────────────────────────────
  const [recentRuns, setRecentRuns] = useState<RecentRun[] | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [histSteps, setHistSteps] = useState<RunStep[]>([])
  const [histRun, setHistRun] = useState<RunSummary | null>(null)
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
  useEffect(() => {
    if (mode !== 'history' || !selectedRunId) return
    let active = true
    setHistSteps([])
    setHistRun(null)
    fetch(`/api/runs/${selectedRunId}/steps`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { run: RunSummary | null; steps: RunStep[] }) => {
        if (!active) return
        setHistSteps(data.steps ?? [])
        setHistRun(data.run ?? null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [mode, selectedRunId])

  // ── History list view ─────────────────────────────────────────────────────
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
                        ? formatDistanceToNow(new Date(r.started_at), { addSuffix: true })
                        : 'pending'}
                      {typeof r.new_count === 'number' ? ` · ${r.new_count} new` : ''}
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

  // ── History detail (real run replay) ──────────────────────────────────────
  if (mode === 'history') {
    const display: DisplayStep[] = histSteps.map(realToDisplay)
    return (
      <div className={COLUMN_CLASS}>
        <Header
          title={histRun?.trigger === 'cron' ? 'Morning digest' : 'Manual re-run'}
          onClose={onClose}
          onBack={() => setSelectedRunId(null)}
        />
        <Timeline steps={display} loading={false} />
      </div>
    )
  }

  // ── LIVE render ───────────────────────────────────────────────────────────
  const liveSteps: DisplayStep[] = variant
    ? variant.steps
        .filter((st) => elapsed >= st.appearAt)
        .map((st) => {
          const resolved = elapsed >= st.resolveAt
          let subLabel: string | undefined
          if (!resolved && st.subStates && st.subStates.length) {
            const prog = (elapsed - st.appearAt) / Math.max(1, st.resolveAt - st.appearAt)
            const idx = Math.min(
              st.subStates.length - 1,
              Math.max(0, Math.floor(prog * st.subStates.length))
            )
            subLabel = st.subStates[idx]
          }
          return {
            id: st.id,
            source: null,
            img: st.img,
            iconKey: st.iconKey,
            status: (resolved ? st.status : 'running') as RunStepStatus,
            label: resolved ? st.doneLabel : st.runningLabel,
            subLabel,
            detail: (st.detail as RunStepDetail) ?? null,
            itemCount: null,
          }
        })
    : []
  const liveTerminal = !!variant && elapsed >= variant.summaryAt

  return (
    <div className={COLUMN_CLASS}>
      <Header
        title={liveTerminal ? 'Refresh complete' : 'Refreshing your tasks'}
        subtitle={liveTerminal ? undefined : 'Watching the agent work through your sources'}
        onClose={onClose}
      />
      {liveTerminal && variant && <SummaryBanner label={variant.summaryLabel} failed={false} />}
      <Timeline steps={liveSteps} loading />
    </div>
  )
}

function realToDisplay(s: RunStep): DisplayStep {
  const phaseIcon: Record<string, string> = {
    start: 'start',
    classify: 'classify',
    diff: 'diff',
    finalize: 'done',
    done: 'done',
    error: 'error',
  }
  return {
    id: s.id,
    source: s.source,
    iconKey: s.source ? undefined : phaseIcon[s.phase],
    status: s.status,
    label: s.label,
    detail: s.detail,
    itemCount: s.item_count,
  }
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

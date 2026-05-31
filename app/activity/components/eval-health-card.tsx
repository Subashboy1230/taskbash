import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { EvalSparkline } from './eval-sparkline'
import type { EvalHealth } from '../loaders'
import { formatRelativeTime } from '../lib/time'

function DeltaLabel({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[11px] text-ink-faint">-</span>
  if (Math.abs(delta) < 0.5) return <span className="text-[11px] text-ink-muted">flat</span>
  if (delta > 0) return <span className="text-[11px] text-success-fg">+{delta.toFixed(0)}pp</span>
  return <span className="text-[11px] text-danger-fg">{delta.toFixed(0)}pp</span>
}

export function EvalHealthCard({ health }: { health: EvalHealth }) {
  if (health.datasets.length === 0) return null

  const lastRan = health.lastCronRanAt
    ? `Last ran ${formatRelativeTime(health.lastCronRanAt)}`
    : 'Never run'

  return (
    <div className="mb-6 rounded-lg border border-line/60 bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/40 px-4 py-3">
        <h3 className="m-0 text-[13px] font-semibold text-ink">Eval health</h3>
        <span className="text-[12px] text-ink-muted">{lastRan}</span>
      </div>
      <div className="divide-y divide-line/30">
        {health.datasets.map(d => (
          <div key={d.datasetId} className="flex items-center gap-4 px-4 py-2.5">
            <span className="font-mono text-[12px] text-ink-muted w-48 truncate">{d.name}</span>
            <span className="tabular-nums text-[14px] font-medium text-ink w-10 shrink-0">
              {d.currentPassRate !== null ? `${d.currentPassRate}%` : '-'}
            </span>
            <span className={d.isRegression ? 'text-danger-fg' : d.deltaPP && d.deltaPP > 0 ? 'text-success-fg' : 'text-ink-muted'}>
              <EvalSparkline values={d.passRates} />
            </span>
            <DeltaLabel delta={d.deltaPP} />
            {d.isRegression && (
              <AlertTriangle size={13} className="text-danger-fg shrink-0" />
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-line/40 px-4 py-2.5">
        <Link href="/observability" className="text-[12px] text-ink-muted hover:text-ink">
          View all runs in /observability
        </Link>
      </div>
    </div>
  )
}

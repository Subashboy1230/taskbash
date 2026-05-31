import { History, RefreshCw, CheckSquare, Database, Edit3, Box } from 'lucide-react'
import { ActivitySection } from '../components/activity-section'
import { groupByDate, sectionTitle } from '../lib/time'
import type { ActivityRow } from '../loaders'

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon size={32} className="mb-3 text-ink-faint" />
      <p className="m-0 text-[13px] text-ink-muted">{message}</p>
    </div>
  )
}

function TabLayout({ rows, emptyIcon, emptyMessage, prefix }: {
  rows: ActivityRow[]
  emptyIcon: React.ElementType
  emptyMessage: string
  prefix: string
}) {
  if (rows.length === 0) return <EmptyState icon={emptyIcon} message={emptyMessage} />
  const { today, thisWeek, earlier } = groupByDate(rows)
  return (
    <div>
      <ActivitySection title={sectionTitle('today')}   rows={today}    defaultOpen storageKey={`${prefix}-today`} />
      <ActivitySection title={sectionTitle('week')}    rows={thisWeek}              storageKey={`${prefix}-week`} />
      <ActivitySection title={sectionTitle('earlier')} rows={earlier}               storageKey={`${prefix}-earlier`} />
    </div>
  )
}

export function AllTab({ rows }: { rows: ActivityRow[] }) {
  return <TabLayout rows={rows} emptyIcon={History} emptyMessage="Nothing here yet. Activity will appear as taskbash runs." prefix="all" />
}

export function RunsTab({ rows, evalHealth }: { rows: ActivityRow[]; evalHealth: import('../loaders').EvalHealth }) {
  return (
    <div>
      {evalHealth.datasets.length > 0 && (
        <EvalHealthCardLazy health={evalHealth} />
      )}
      <TabLayout rows={rows} emptyIcon={RefreshCw} emptyMessage="No agent runs yet. Re-run tasks or wait for the morning digest." prefix="runs" />
    </div>
  )
}

function EvalHealthCardLazy({ health }: { health: import('../loaders').EvalHealth }) {
  const { EvalHealthCard } = require('../components/eval-health-card')
  return <EvalHealthCard health={health} />
}

export function TasksTab({ rows }: { rows: ActivityRow[] }) {
  return <TabLayout rows={rows} emptyIcon={CheckSquare} emptyMessage="No task events yet. Events will appear as you triage items." prefix="tasks" />
}

export function DataSourcesTab({ rows }: { rows: ActivityRow[] }) {
  return <TabLayout rows={rows} emptyIcon={Database} emptyMessage="No data source syncs yet. Connect a source and run a digest." prefix="sources" />
}

export function ApprovalsTab({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Edit3 size={32} className="mb-3 text-ink-faint" />
        <p className="m-0 mb-3 text-[13px] text-ink-muted">No draft replies yet. Connect Gmail to start drafting.</p>
        <a href="/connections" className="rounded-md bg-surface-muted px-3 py-1.5 text-[13px] text-ink hover:bg-surface-muted/80">
          Go to Connections
        </a>
      </div>
    )
  }
  return <TabLayout rows={rows} emptyIcon={Edit3} emptyMessage="No approvals yet." prefix="approvals" />
}

export function RecordsTab({ rows }: { rows: ActivityRow[] }) {
  return <TabLayout rows={rows} emptyIcon={Box} emptyMessage="No records yet. Records appear after extractors run." prefix="records" />
}

import { cn } from '@/lib/utils'

export type PillKind =
  | 'synced' | 'succeeded' | 'completed' | 'approved' | 'rejected'
  | 'failed' | 'snoozed' | 'skipped' | 'slop' | 'running'
  | 'email' | 'meeting' | 'issue' | 'event'
  | 'attention' | 'regression'

const PILL: Record<PillKind, { label: string; bg: string; fg: string; pulse?: boolean }> = {
  synced:     { label: 'Synced',     bg: 'bg-success-bg',     fg: 'text-success-fg' },
  succeeded:  { label: 'Succeeded',  bg: 'bg-success-bg',     fg: 'text-success-fg' },
  completed:  { label: 'Completed',  bg: 'bg-tag-reply-bg',   fg: 'text-tag-reply-fg' },
  approved:   { label: 'Approved',   bg: 'bg-success-bg',     fg: 'text-success-fg' },
  rejected:   { label: 'Rejected',   bg: 'bg-danger-bg',      fg: 'text-danger-fg' },
  failed:     { label: 'Failed',     bg: 'bg-danger-bg',      fg: 'text-danger-fg' },
  snoozed:    { label: 'Snoozed',    bg: 'bg-tag-action-bg',  fg: 'text-tag-action-fg' },
  skipped:    { label: 'Skipped',    bg: 'bg-surface-muted',  fg: 'text-ink-faint' },
  slop:       { label: 'Slop',       bg: 'bg-surface-muted',  fg: 'text-ink-muted' },
  running:    { label: 'Running',    bg: 'bg-tag-reply-bg',   fg: 'text-tag-reply-fg', pulse: true },
  email:      { label: 'Email',      bg: 'bg-surface-muted',  fg: 'text-ink-muted' },
  meeting:    { label: 'Meeting',    bg: 'bg-surface-muted',  fg: 'text-ink-muted' },
  issue:      { label: 'Issue',      bg: 'bg-surface-muted',  fg: 'text-ink-muted' },
  event:      { label: 'Event',      bg: 'bg-surface-muted',  fg: 'text-ink-muted' },
  attention:  { label: 'Attention',  bg: 'bg-tag-action-bg',  fg: 'text-tag-action-fg' },
  regression: { label: 'Regression', bg: 'bg-danger-bg',      fg: 'text-danger-fg' },
}

export function ActivityPill({ kind }: { kind: PillKind }) {
  const p = PILL[kind]
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0',
      p.bg, p.fg,
      p.pulse && 'animate-pulse',
    )}>
      {p.label}
    </span>
  )
}

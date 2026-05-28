// Status pill — the consistent visual vocabulary for "what state is this
// task in?" Used on the row, in the detail panel, and on the /handled page.
//
// Five states map 1:1 to the Nummo vocabulary we audited:
//   awaiting  — agent drafted, user hasn't acted yet                 (orange)
//   draft     — agent has prepared an artifact ready to send         (sage)
//   done      — user approved (and the action ran, if any)           (green)
//   rejected  — user explicitly rejected the proposal                (red)
//   auto      — agent-completed informational item (no approval)     (grey)

import { Check, Clock, FileEdit, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusPillKind =
  | 'awaiting'
  | 'draft'
  | 'done'
  | 'rejected'
  | 'auto'

const CONFIG: Record<
  StatusPillKind,
  { label: string; cls: string; icon?: typeof Check }
> = {
  awaiting: {
    label: 'Awaiting approval',
    cls: 'bg-tag-action-bg text-tag-action-fg',
    icon: Clock,
  },
  draft: {
    label: 'Draft ready',
    cls: 'bg-success-bg text-success-fg',
    icon: FileEdit,
  },
  done: {
    label: 'Done',
    cls: 'bg-success-bg text-success-fg',
    icon: Check,
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-danger-bg text-danger-fg',
    icon: X,
  },
  auto: {
    label: 'Auto-completed',
    cls: 'bg-surface-muted text-ink-muted',
  },
}

export function StatusPill({
  kind,
  label,
  className,
}: {
  kind: StatusPillKind
  /** Override the default label. */
  label?: string
  className?: string
}) {
  const cfg = CONFIG[kind]
  const Icon = cfg.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        cfg.cls,
        className
      )}
    >
      {Icon && <Icon size={10} />}
      {label ?? cfg.label}
    </span>
  )
}

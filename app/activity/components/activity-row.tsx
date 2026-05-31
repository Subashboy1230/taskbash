import { BrandLogo } from '@/app/_components/brand-logo'
import { ActivityPill } from './activity-pill'
import { renderMentions } from './mention-chip'
import { formatActivityTime } from '../lib/time'
import type { ActivityRow as ActivityRowData } from '../loaders'
import {
  RefreshCw, CheckSquare, Trash2, BellOff, AlertTriangle,
  Edit3, Database, History,
} from 'lucide-react'

function RowIcon({ row }: { row: ActivityRowData }) {
  if (row.source && ['gmail', 'granola', 'calendar', 'linear', 'slack'].includes(row.source)) {
    return <BrandLogo brand={row.source as 'gmail' | 'granola' | 'calendar' | 'linear' | 'slack'} size={16} />
  }
  const iconClass = 'size-4 shrink-0 text-ink-faint'
  switch (row.icon) {
    case 'refresh':    return <RefreshCw size={16} className={iconClass} />
    case 'check':      return <CheckSquare size={16} className={iconClass} />
    case 'trash':      return <Trash2 size={16} className={iconClass} />
    case 'snooze':     return <BellOff size={16} className={iconClass} />
    case 'alert':      return <AlertTriangle size={16} className="size-4 shrink-0 text-danger-fg" />
    case 'edit':       return <Edit3 size={16} className={iconClass} />
    case 'database':   return <Database size={16} className={iconClass} />
    default:           return <History size={16} className={iconClass} />
  }
}

export function ActivityRow({ row }: { row: ActivityRowData }) {
  return (
    <div className="flex items-start gap-3 border-t border-line/50 px-4 py-3 first:border-t-0">
      <span className="mt-0.5 w-[90px] shrink-0 text-[12px] tabular-nums text-ink-muted">
        {formatActivityTime(row.event_at)}
      </span>
      <span className="mt-0.5 shrink-0">
        <RowIcon row={row} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[14px] text-ink">
          {renderMentions(row.label)}
        </p>
        {row.subtitle && (
          <p className="m-0 truncate text-[12px] text-ink-muted">{row.subtitle}</p>
        )}
      </div>
      {row.kind && (
        <div className="shrink-0 mt-0.5">
          <ActivityPill kind={row.kind} />
        </div>
      )}
    </div>
  )
}

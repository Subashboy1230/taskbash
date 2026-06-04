// Centralised date/time formatters.
//
// All functions that produce UI strings take an explicit `now: Date` so
// the server component can pass a stable timestamp down to client
// components — eliminating the React hydration mismatch (#418) caused by
// server and client computing `new Date()` at different moments.

export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'future'

export interface DeadlineInfo {
  label: string
  tone: DeadlineTone
}

/** "Overdue 1d" / "Overdue 3h" / "Due in 5h" / "Due tomorrow" / "Due Friday" / "Due May 31" */
export function formatDeadline(dueIso: string, now: Date): DeadlineInfo | null {
  const due = new Date(dueIso)
  if (isNaN(due.getTime())) return null
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

/** Returns milliseconds since epoch from a stable server timestamp or Date.now() fallback. */
export function nowMs(nowFromServer?: Date | string): number {
  if (!nowFromServer) return Date.now()
  const d = nowFromServer instanceof Date ? nowFromServer : new Date(nowFromServer)
  return isNaN(d.getTime()) ? Date.now() : d.getTime()
}

/** "3:42 PM" — local time of day, used in activity feeds and handled log. */
export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "May 28, 3:42 PM" — local timestamp, used on profile and detail surfaces. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

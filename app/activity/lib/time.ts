import { formatDistanceToNow, isThisWeek, isToday, format } from 'date-fns'

export function formatActivityTime(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isThisWeek(d)) return format(d, 'EEE h:mm a')
  return format(d, 'MMM d h:mm a')
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (diffDays > 7) return format(d, 'MMM d h:mm a')
  return formatDistanceToNow(d, { addSuffix: true })
}

export function groupByDate<T extends { event_at: string }>(rows: T[]): { today: T[]; thisWeek: T[]; earlier: T[] } {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay())

  const today: T[] = []
  const thisWeek: T[] = []
  const earlier: T[] = []

  for (const row of rows) {
    const d = new Date(row.event_at)
    if (d >= startOfToday) today.push(row)
    else if (d >= startOfWeek) thisWeek.push(row)
    else earlier.push(row)
  }

  return { today, thisWeek, earlier }
}


export function sectionTitle(bucket: 'today' | 'week' | 'earlier'): string {
  const now = new Date()
  if (bucket === 'today') return `Today - ${format(now, 'MMM d, yyyy')}`
  if (bucket === 'week') return 'Earlier This Week'
  return 'Earlier'
}

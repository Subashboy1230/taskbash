// Loader for /handled — every completed item, grouped by day, newest first.
// Same DB shape as load-digest but no "open items" / "counts" envelope —
// the handled page is purely a chronological log.

import { supabase } from './supabase'
import { resolveUserId } from './supabase-server'
import type { Item, Source } from './types'

const PAGE_SIZE = 100

export interface HandledItem {
  id: string
  title: string
  description: string
  source: Source
  status: 'completed' | 'dismissed'
  completed_at: string | null
  auto_completed_reason: string | null
  proposed_action_kind: string | null
}

export interface HandledDay {
  /** YYYY-MM-DD key used for grouping; also serves as the section heading anchor. */
  date_iso: string
  /** Display label: "Today", "Yesterday", or e.g. "Tuesday, May 27". */
  label: string
  items: HandledItem[]
}

export async function loadHandled(): Promise<HandledDay[]> {
  const USER_ID = await resolveUserId()

  // Pull the most recently completed/dismissed items. We grab a generous
  // page size — date grouping happens client-side after the round-trip.
  const { data, error } = await supabase
    .from('items')
    .select(
      'id, title, status, source, parent_context, brief, completed_at, ' +
        'auto_completed_reason, proposed_action'
    )
    .eq('user_id', USER_ID)
    .in('status', ['completed', 'dismissed'])
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(PAGE_SIZE)
  if (error) {
    throw new Error(`loadHandled failed: ${error.message}`)
  }

  const items = ((data as unknown as Item[] | null) ?? []).map(toHandledItem)
  return groupByDay(items)
}

function toHandledItem(item: Item): HandledItem {
  const description =
    item.brief?.why ||
    (item.parent_context
      ? `From ${labelFor(item.source)} — ${item.parent_context}`
      : `From ${labelFor(item.source)}`)
  const pa = (
    item as Item & { proposed_action?: { kind?: string } | null }
  ).proposed_action
  return {
    id: item.id,
    title: item.title,
    description,
    source: item.source as Source,
    status: item.status === 'dismissed' ? 'dismissed' : 'completed',
    completed_at: item.completed_at,
    auto_completed_reason: item.auto_completed_reason,
    proposed_action_kind: pa?.kind ?? null,
  }
}

function groupByDay(items: HandledItem[]): HandledDay[] {
  const buckets = new Map<string, HandledItem[]>()
  for (const item of items) {
    const ts = item.completed_at
    if (!ts) continue
    const d = new Date(ts)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const list = buckets.get(key) ?? []
    list.push(item)
    buckets.set(key, list)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, items]) => ({
      date_iso: key,
      label: labelForDate(key, today, yesterday),
      items,
    }))
}

function labelForDate(key: string, today: Date, yesterday: Date): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function labelFor(source: Source): string {
  const map: Record<Source, string> = {
    granola: 'Granola',
    gmail: 'Gmail',
    calendar: 'Google Calendar',
    slack: 'Slack',
    linear: 'Linear',
    manual: 'manual entry',
  }
  return map[source] || source
}

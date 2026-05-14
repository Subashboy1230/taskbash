// Server-side data loader — replaces getMockDigest() with real Supabase queries.
// Returns the same shape (MockDigestSummary) so the UI doesn't need to change.

import { supabase } from './supabase'
import type { Item, Source, Tag } from './types'
import type { MockDigestSummary, MockItem } from './mock-items'

const USER_ID = process.env.APP_USER_ID!

export async function loadDigest(): Promise<MockDigestSummary> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')

  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  // Open items (the main list)
  // Sort by deadline: soonest due first (so overdue floats to the top),
  // items with no deadline come last, newest-seen first within that group.
  const { data: openRows, error: openErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', USER_ID)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('first_seen_at', { ascending: false })
    .limit(50)
  if (openErr) throw new Error(`loadDigest openItems failed: ${openErr.message}`)

  // Completed today (the cleared section)
  const { data: completedRows, error: completedErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('status', 'completed')
    .gte('completed_at', today.toISOString())
    .order('completed_at', { ascending: false })
    .limit(20)
  if (completedErr) throw new Error(`loadDigest completed failed: ${completedErr.message}`)

  const openItems = (openRows || []) as Item[]
  const completedItems = (completedRows || []) as Item[]

  // Counts — computed from the open + completed lists
  const newToday = openItems.filter(i => new Date(i.first_seen_at) >= today).length
  const carryover = openItems.length - newToday
  const overdue = openItems.filter(i => i.due_at && new Date(i.due_at) < now).length

  return {
    user_name: 'Subash',
    user_initials: 'SR',
    greeting: getGreeting(now),
    date_iso: now.toISOString().split('T')[0],
    active_tasks_label:
      openItems.length === 0
        ? "All clear. Take the morning back."
        : "A few left. Let's clear them.",
    active_count: openItems.length,
    completed_today_count: completedItems.length,
    counts: {
      new: newToday,
      carryover,
      cleared_overnight: completedItems.length,
      overdue,
    },
    open_items: openItems.map(toUIItem),
    completed_today: completedItems.map(toUIItem),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function toUIItem(item: Item): MockItem {
  const ageDays = computeAgeDays(item.first_seen_at)
  return {
    id: item.id,
    title: item.title,
    task_type: item.task_type,
    tag: item.tag as Tag,
    parent_context: item.parent_context,
    status: item.status === 'in_progress' ? 'in_progress' : item.status === 'completed' ? 'completed' : 'open',
    source: item.source as Source,
    urgent: !!item.urgent,
    age_days: ageDays,
    due_at: item.due_at,
    is_new_today: ageDays === 0,
    count_label: countLabelFor(item.source as Source, item.task_type),
    status_label: statusLabelFor(item),
    status_label_tone: statusLabelTone(item),
    completed_at: item.completed_at ?? undefined,
    // The synthesized brief — null until backfill-briefs.ts runs / extractor generates it
    brief: item.brief ?? null,
    detail_status:
      item.status === 'completed'
        ? 'Approved'
        : item.urgent
        ? 'Needs your review'
        : 'Review needed',
    // Fallback description shown only when there's no brief yet
    description: item.parent_context
      ? `Auto-extracted from ${labelFor(item.source as Source)} — ${item.parent_context}.`
      : `Auto-extracted from ${labelFor(item.source as Source)}.`,
  }
}

function computeAgeDays(firstSeenIso: string): number {
  const seen = new Date(firstSeenIso)
  const ms = Date.now() - seen.getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

function countLabelFor(source: Source, taskType: string): string {
  if (taskType === 'context_prep' || taskType === 'post_call') return '1 brief'
  if (source === 'gmail' || source === 'slack') return '1 to-do'
  return '1 to-do'
}

function statusLabelFor(item: Item): string | undefined {
  if (item.urgent && item.due_at && new Date(item.due_at) < new Date()) {
    return 'Needs your review'
  }
  if (item.tag === 'reply') return 'Reply owed'
  if (item.tag === 'action') return 'Action needed'
  if (item.tag === 'commit') return 'You committed to this'
  if (item.tag === 'fyi') return 'FYI'
  return undefined
}

function statusLabelTone(item: Item): 'success' | 'warning' | 'danger' | 'info' | undefined {
  if (item.urgent && item.due_at && new Date(item.due_at) < new Date()) return 'danger'
  if (item.tag === 'action') return 'warning'
  if (item.tag === 'commit') return 'success'
  if (item.tag === 'reply') return 'info'
  return 'info'
}

function labelFor(source: Source): string {
  const map: Record<Source, string> = {
    granola: 'Granola',
    gmail: 'Gmail',
    slack: 'Slack',
    manual: 'manual entry',
  }
  return map[source] || source
}

function getGreeting(now: Date): string {
  const hour = now.getHours()
  const name = 'Subash'
  if (hour < 5) return `Up late, ${name}`
  if (hour < 12) return `Good morning, ${name}`
  if (hour < 17) return `Good afternoon, ${name}`
  if (hour < 21) return `Good evening, ${name}`
  return `Late night, ${name}`
}

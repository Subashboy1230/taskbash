// Server-side data loader — replaces getMockDigest() with real Supabase queries.
// Returns the same shape (MockDigestSummary) so the UI doesn't need to change.

import { supabase } from './supabase'
import { resolveUserId } from './supabase-server'
import type { Item, Source, Tag } from './types'
import type { MockDigestSummary, MockItem } from './mock-items'

export async function loadDigest(): Promise<MockDigestSummary> {
  const USER_ID = await resolveUserId()

  const now = new Date()
  // "Today" boundary = midnight America/Los_Angeles.
  // en-CA gives YYYY-MM-DD; appending the fixed PST offset gives a proper ISO string.
  // In May, Los Angeles is on PDT (UTC-7).
  const todayDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const today = new Date(`${todayDateStr}T00:00:00-07:00`)

  // Auto-unsnooze: any snoozed item whose window has passed flips back to open
  // BEFORE we load the open list, so it reappears at the right time on the very
  // next page load (not only on the next digest cron run).
  await supabase
    .from('items')
    .update({ status: 'open', snooze_until: null })
    .eq('user_id', USER_ID)
    .eq('status', 'snoozed')
    .lt('snooze_until', now.toISOString())

  // Open items (the main list)
  // Sort priority order:
  //   1. priority (P0 → P1 → P2 → P3, then unassigned) — user-curated importance
  //   2. proposed_action present (the agent did work; never bury a draft)
  //   3. due_at (soonest first; overdue floats up)
  //   4. first_seen_at (newest within a group)
  const { data: openRows, error: openErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', USER_ID)
    .in('status', ['open', 'in_progress'])
    .is('parent_id', null)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('priority', { ascending: true, nullsFirst: false })
    .order('proposed_action', { ascending: false, nullsFirst: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('first_seen_at', { ascending: false })
    .limit(200)
  if (openErr) throw new Error(`loadDigest openItems failed: ${openErr.message}`)

  // Completed today (the cleared section) — fetch rows + exact count separately
  // so the tab badge shows the real total even when the row list is capped.
  const { data: completedRows, error: completedErr, count: completedCount } = await supabase
    .from('items')
    .select('*', { count: 'exact' })
    .eq('user_id', USER_ID)
    .eq('status', 'completed')
    .gte('completed_at', today.toISOString())
    .order('completed_at', { ascending: false })
    .limit(20)
  if (completedErr) throw new Error(`loadDigest completed failed: ${completedErr.message}`)

  // Still-snoozed items (window in the future, after the auto-unsnooze above),
  // soonest-to-return first → drives the Snoozed tab.
  const { data: snoozedRows, error: snoozedErr } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('status', 'snoozed')
    .is('parent_id', null)
    .order('snooze_until', { ascending: true, nullsFirst: false })
    .limit(100)
  if (snoozedErr) throw new Error(`loadDigest snoozed failed: ${snoozedErr.message}`)

  const openItems = (openRows || []) as Item[]
  const completedItems = (completedRows || []) as Item[]
  const snoozedItems = (snoozedRows || []) as Item[]

  // Load subtasks for every parent in either list. One query, then bucket
  // them onto the right parent by parent_id. We include completed subtasks so
  // the UI can show "2/5 done" as progress.
  const parentIds = [
    ...openItems.map(i => i.id),
    ...completedItems.map(i => i.id),
    ...snoozedItems.map(i => i.id),
  ]
  const subtasksByParent = new Map<
    string,
    Array<{ id: string; title: string; completed: boolean }>
  >()
  if (parentIds.length > 0) {
    const { data: subRows, error: subErr } = await supabase
      .from('items')
      .select('id, title, status, parent_id, first_seen_at')
      .eq('user_id', USER_ID)
      .in('parent_id', parentIds)
      .neq('status', 'dismissed')
      .order('first_seen_at', { ascending: true })
    if (subErr) throw new Error(`loadDigest subtasks failed: ${subErr.message}`)
    for (const row of subRows || []) {
      const r = row as {
        id: string
        title: string
        status: string
        parent_id: string
      }
      const list = subtasksByParent.get(r.parent_id) ?? []
      list.push({
        id: r.id,
        title: r.title,
        completed: r.status === 'completed',
      })
      subtasksByParent.set(r.parent_id, list)
    }
  }

  // Counts — computed from the open + completed lists
  const newToday = openItems.filter(i => new Date(i.first_seen_at) >= today).length
  const carryover = openItems.length - newToday
  const overdue = openItems.filter(i => i.due_at && new Date(i.due_at) < now).length

  // Derive display name from email (e.g. subash@sigiq.ai → Subash)
  const { data: userRow } = await supabase.from('users').select('email').eq('id', USER_ID).maybeSingle()
  const userDisplayName = userRow?.email
    ? userRow.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    : 'You'
  const userInitials = userDisplayName.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase()

  return {
    user_name: userDisplayName,
    user_initials: userInitials,
    greeting: pickGreeting(openItems.length, completedItems.length, parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }))),
    date_iso: now.toISOString().split('T')[0],
    active_tasks_label:
      openItems.length === 0
        ? "All clear. Take the morning back."
        : "A few left. Let's clear them.",
    active_count: openItems.length,
    completed_today_count: completedCount ?? completedItems.length,
    counts: {
      new: newToday,
      carryover,
      cleared_overnight: completedItems.length,
      overdue,
    },
    open_items: openItems.map(item => toUIItem(item, subtasksByParent.get(item.id))),
    completed_today: completedItems.map(item => toUIItem(item, subtasksByParent.get(item.id))),
    snoozed_items: snoozedItems.map(item => toUIItem(item, subtasksByParent.get(item.id))),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function toUIItem(
  item: Item,
  subtasks?: Array<{ id: string; title: string; completed: boolean }>
): MockItem {
  const ageDays = computeAgeDays(item.first_seen_at)
  return {
    id: item.id,
    title: item.title,
    subtitle: (item as any).subtitle ?? null,
    task_type: item.task_type,
    tag: item.tag as Tag,
    parent_context: item.parent_context,
    status: item.status === 'in_progress' ? 'in_progress' : item.status === 'completed' ? 'completed' : 'open',
    source: item.source as Source,
    priority: item.priority,
    urgent: !!item.urgent,
    function_ids: (item as { function_ids?: string[] }).function_ids ?? [],
    age_days: ageDays,
    due_at: item.due_at,
    is_new_today: ageDays === 0,
    snooze_until: (item as { snooze_until?: string | null }).snooze_until ?? null,
    count_label: countLabelFor(item.source as Source, item.task_type),
    status_label: statusLabelFor(item),
    status_label_tone: statusLabelTone(item),
    completed_at: item.completed_at ?? undefined,
    // The synthesized brief — null until backfill-briefs.ts runs / extractor generates it
    brief: item.brief ?? null,
    // Nummo-style approval-queue fields (migration 006)
    proposed_action: item.proposed_action ?? null,
    source_excerpt: item.source_excerpt ?? null,
    detail_status:
      item.status === 'completed'
        ? 'Approved'
        : item.proposed_action
        ? 'Draft ready'
        : item.urgent
        ? 'Needs your review'
        : 'Review needed',
    // AI-generated description (migration 018). Falls back to null so the UI
    // knows it hasn't been generated yet and can trigger generateItemDetails.
    description: (item as any).description ?? null,
    reply_outcome: (item as any).reply_outcome ?? null,
    sub_items: subtasks ?? [],
    sort_order: (item as { sort_order?: number | null }).sort_order ?? null,
    gmail_thread_id: (item as any).source_ref?.gmail_thread_id ?? null,
    source_ref: (item as any).source_ref ?? null,
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
    calendar: 'Google Calendar',
    slack: 'Slack',
    linear: 'Linear',
    manual: 'manual entry',
  }
  return map[source] || source
}

function pickGreeting(open: number, completed: number, hour: number): string {
  if (open === 0) return 'All clear. Beautiful.'
  if (completed > 0 && open < 5) return "A few left. Let's clear them."
  if (open > 30) return 'Heavy day. Triage the top of the list first.'
  if (hour < 12) return `Morning, Subash. Here's what's queued.`
  if (hour < 18) return 'Afternoon check-in.'
  return 'Late, but still time to clear a few.'
}

import { supabase } from '@/lib/supabase'
import type { PillKind } from './components/activity-pill'

export type ActivityIcon =
  | 'refresh' | 'check' | 'trash' | 'snooze' | 'alert' | 'edit' | 'database' | 'history'

export interface ActivityRow {
  id: string
  event_at: string
  kind: PillKind | null
  source: string | null
  icon: ActivityIcon
  label: string
  subtitle?: string
  expand_payload?: unknown
}

export interface EvalHealth {
  lastCronRanAt: string | null
  nextCronAt: string | null
  datasets: Array<{
    datasetId: string
    name: string
    promptId: string
    passRates: number[]
    currentPassRate: number | null
    deltaPP: number | null
    isRegression: boolean
  }>
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function loadRuns(userId: string, limit = 50, before?: string): Promise<ActivityRow[]> {
  let q = supabase
    .from('runs')
    .select('id, started_at, completed_at, trigger, sources_run, fresh_count, new_count, carryover_count, status, error_message')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (before) q = q.lt('started_at', before)

  const { data, error } = await q
  if (error || !data) return []

  return data.map(r => {
    const sources = (r.sources_run as string[] | null) ?? []
    const subtitle = [
      `${sources.length} source${sources.length !== 1 ? 's' : ''}`,
      r.new_count ? `${r.new_count} new` : null,
      r.carryover_count ? `${r.carryover_count} carried` : null,
    ].filter(Boolean).join(' · ')

    return {
      id: r.id,
      event_at: r.started_at,
      kind: r.status === 'succeeded' ? 'succeeded'
          : r.status === 'failed' ? 'failed'
          : 'running' as PillKind,
      source: null,
      icon: 'refresh' as ActivityIcon,
      label: r.trigger === 'cron' ? 'Morning digest ran' : 'Re-ran tasks',
      subtitle,
      expand_payload: r.error_message ?? undefined,
    }
  })
}

// ─── Task events ─────────────────────────────────────────────────────────────

export async function loadTaskEvents(userId: string, limit = 50, before?: string): Promise<ActivityRow[]> {
  let q = supabase
    .from('task_events')
    .select('id, created_at, kind, item_id, payload, items(title, source)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) q = q.lt('created_at', before)

  const { data, error } = await q
  if (error || !data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((e: {
    id: string
    created_at: string
    kind: string
    item_id: string
    payload: unknown
    items: { title: string; source: string } | { title: string; source: string }[] | null
  }) => {
    const itemsRaw = Array.isArray(e.items) ? e.items[0] ?? null : e.items
    const title = itemsRaw?.title ?? 'Unknown task'
    const source = itemsRaw?.source ?? null

    let label = title
    let icon: ActivityIcon = 'check'
    let kind: PillKind | null = null

    switch (e.kind) {
      case 'created':
        label = `Found "${title}"`
        icon = 'database'
        kind = null
        break
      case 'completed':
        icon = 'check'
        kind = 'completed'
        break
      case 'dismissed':
        icon = 'trash'
        kind = 'rejected'
        break
      case 'snoozed':
        icon = 'snooze'
        kind = 'snoozed'
        break
      case 'slop':
        icon = 'trash'
        kind = 'slop'
        break
    }

    return {
      id: e.id,
      event_at: e.created_at,
      kind,
      source,
      icon,
      label,
    }
  })
}

// ─── Data source syncs ────────────────────────────────────────────────────────

export async function loadDataSourceSyncs(userId: string, limit = 100, before?: string): Promise<ActivityRow[]> {
  let q = supabase
    .from('runs')
    .select('id, started_at, sources_run, sources_failed, status')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(Math.ceil(limit / 4))

  if (before) q = q.lt('started_at', before)

  const { data, error } = await q
  if (error || !data) return []

  const rows: ActivityRow[] = []
  for (const r of data) {
    const run = r as {
      id: string
      started_at: string
      sources_run: string[] | null
      sources_failed: string[] | null
      status: string
    }
    for (const src of (run.sources_run ?? [])) {
      const failed = (run.sources_failed ?? []).includes(src)
      rows.push({
        id: `${run.id}-${src}`,
        event_at: run.started_at,
        kind: failed ? 'failed' : run.status === 'succeeded' ? 'synced' : 'failed',
        source: src,
        icon: 'refresh',
        label: sourceLabel(src),
      })
    }
  }
  return rows
}

function sourceLabel(src: string): string {
  const map: Record<string, string> = {
    gmail: 'Gmail',
    granola: 'Meeting Notes',
    calendar: 'Calendar',
    linear: 'Linear',
    slack: 'Slack',
  }
  return map[src] ?? src.charAt(0).toUpperCase() + src.slice(1)
}

// ─── Approvals ───────────────────────────────────────────────────────────────

export async function loadApprovals(userId: string, limit = 50, before?: string): Promise<ActivityRow[]> {
  let q = supabase
    .from('items')
    .select('id, title, completed_at, reply_outcome, proposed_action')
    .eq('user_id', userId)
    .not('reply_outcome', 'is', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (before) q = q.lt('completed_at', before)

  const { data, error } = await q
  if (error || !data) return []

  return data
    .filter(i => i.completed_at)
    .map(i => ({
      id: i.id,
      event_at: i.completed_at as string,
      kind: (i.reply_outcome === 'approved' ? 'approved'
           : i.reply_outcome === 'rejected' ? 'rejected'
           : 'completed') as PillKind,
      source: null,
      icon: 'edit' as ActivityIcon,
      label: i.title,
      expand_payload: (i.proposed_action as { body?: string } | null)?.body?.slice(0, 200),
    }))
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function loadRecords(userId: string, limit = 100, before?: string): Promise<ActivityRow[]> {
  let q = supabase
    .from('llm_calls')
    .select('id, created_at, prompt_id, input_content')
    .eq('user_id', userId)
    .in('prompt_id', ['extract.gmail', 'extract.granola', 'extract.linear', 'extract.calendar'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) q = q.lt('created_at', before)

  const { data, error } = await q
  if (error || !data) return []

  return data.map(c => {
    const content = c.input_content as Record<string, unknown> | null
    const promptId = c.prompt_id as string

    let label = 'Unknown record'
    let source: string | null = null
    let kind: PillKind = 'email'

    if (promptId === 'extract.gmail') {
      label = (content?.subject as string | null) ?? 'Email thread'
      source = 'gmail'
      kind = 'email'
    } else if (promptId === 'extract.granola') {
      label = (content?.title as string | null) ?? 'Meeting note'
      source = 'granola'
      kind = 'meeting'
    } else if (promptId === 'extract.linear') {
      const identifier = content?.identifier as string | null
      const title = content?.title as string | null
      label = [identifier, title].filter(Boolean).join(' - ') || 'Linear issue'
      source = 'linear'
      kind = 'issue'
    } else if (promptId === 'extract.calendar') {
      label = (content?.summary as string | null) ?? 'Calendar event'
      source = 'calendar'
      kind = 'event'
    }

    return {
      id: c.id,
      event_at: c.created_at,
      kind,
      source,
      icon: 'database' as ActivityIcon,
      label,
    }
  })
}

// ─── All Activity ─────────────────────────────────────────────────────────────

export async function loadAllActivity(userId: string, limit = 50, before?: string): Promise<ActivityRow[]> {
  const [runs, tasks, syncs, approvals, records] = await Promise.all([
    loadRuns(userId, 30, before),
    loadTaskEvents(userId, 30, before),
    loadDataSourceSyncs(userId, 30, before),
    loadApprovals(userId, 30, before),
    loadRecords(userId, 30, before),
  ])

  return [...runs, ...tasks, ...syncs, ...approvals, ...records]
    .sort((a, b) => b.event_at.localeCompare(a.event_at))
    .slice(0, limit)
}

// ─── Eval health ──────────────────────────────────────────────────────────────

export async function loadEvalHealth(userId: string): Promise<EvalHealth> {
  const { data: datasets } = await supabase
    .from('eval_datasets')
    .select('id, name, prompt_id')
    .eq('user_id', userId)

  if (!datasets || datasets.length === 0) {
    return { lastCronRanAt: null, nextCronAt: null, datasets: [] }
  }

  const { data: runs } = await supabase
    .from('eval_runs')
    .select('dataset_id, passed, failed, started_at')
    .in('dataset_id', datasets.map(d => d.id))
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })

  const runsByDataset = new Map<string, { passed: number; failed: number; started_at: string }[]>()
  for (const r of (runs ?? [])) {
    const arr = runsByDataset.get(r.dataset_id) ?? []
    arr.push(r)
    runsByDataset.set(r.dataset_id, arr)
  }

  const { data: lastCron } = await supabase
    .from('agent_events')
    .select('created_at')
    .eq('user_id', userId)
    .eq('kind', 'eval.cron_completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    lastCronRanAt: lastCron?.created_at ?? null,
    nextCronAt: null,
    datasets: datasets.map(d => {
      const dRuns = (runsByDataset.get(d.id) ?? []).slice(0, 10).reverse()
      const passRates = dRuns.map(r => {
        const total = r.passed + r.failed
        return total > 0 ? Math.round((r.passed / total) * 1000) / 10 : 0
      })
      const currentPassRate = passRates.length > 0 ? passRates[passRates.length - 1] : null
      const deltaPP = passRates.length >= 2
        ? passRates[passRates.length - 1] - passRates[passRates.length - 2]
        : null
      return {
        datasetId: d.id,
        name: d.name,
        promptId: d.prompt_id,
        passRates,
        currentPassRate,
        deltaPP,
        isRegression: deltaPP !== null && deltaPP < -5,
      }
    }),
  }
}

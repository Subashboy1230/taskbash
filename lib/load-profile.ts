import { supabase } from './supabase'
import { PROMPTS } from './prompt-registry'
import type { VoiceExamples } from './types'

export async function loadProfileOverview(userId: string) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [
    { count: openCount },
    { count: clearedToday },
    { count: draftsReady },
    { data: connections },
  ] = await Promise.all([
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open'),
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString()),
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open')
      .not('proposed_action', 'is', null),
    supabase.from('connections').select('provider').eq('user_id', userId),
  ])

  const connectedSources = new Set((connections ?? []).map(c => c.provider as string))

  return {
    openCount: openCount ?? 0,
    clearedToday: clearedToday ?? 0,
    draftsReady: draftsReady ?? 0,
    connectedSources,
  }
}

export async function loadVoiceProfile(userId: string) {
  const { data } = await supabase
    .from('users')
    .select('communication_style, voice_examples, voice_updated_at')
    .eq('id', userId)
    .maybeSingle()

  return {
    voice: (data?.communication_style as string | null) ?? null,
    examples: (data?.voice_examples as VoiceExamples | null) ?? null,
    updatedAt: (data?.voice_updated_at as string | null) ?? null,
  }
}

export async function loadPromptsWithSlopRates(userId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: slopFeedback }, { data: callData }] = await Promise.all([
    supabase
      .from('item_feedback')
      .select('item_id')
      .eq('user_id', userId)
      .eq('kind', 'slop')
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('llm_calls')
      .select('id, prompt_id, produced_item_ids')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo)
      .not('produced_item_ids', 'is', null),
  ])

  const slopItemIds = new Set((slopFeedback ?? []).map(s => s.item_id as string))
  const slopRateByPrompt: Record<string, number> = {}

  if (callData) {
    const totalByPrompt: Record<string, number> = {}
    const slopByPrompt: Record<string, number> = {}
    for (const call of callData) {
      const pid = call.prompt_id as string
      const ids: string[] = (call.produced_item_ids as string[]) ?? []
      totalByPrompt[pid] = (totalByPrompt[pid] ?? 0) + ids.length
      slopByPrompt[pid] = (slopByPrompt[pid] ?? 0) + ids.filter(id => slopItemIds.has(id)).length
    }
    for (const pid of Object.keys(totalByPrompt)) {
      const total = totalByPrompt[pid]
      slopRateByPrompt[pid] = total > 0 ? Math.round((slopByPrompt[pid] ?? 0) / total * 100) : 0
    }
  }

  return Object.values(PROMPTS).map(p => ({
    ...p,
    slopRate: slopRateByPrompt[p.id] ?? null,
  }))
}

export async function loadStats(userId: string) {
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [
    { count: clearedToday },
    { count: clearedWeek },
    { count: clearedMonth },
    { data: items30 },
    { data: slop30 },
    { data: weekItems },
    { data: fns },
  ] = await Promise.all([
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString()),
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', weekStart.toISOString()),
    supabase
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', monthStart.toISOString()),
    supabase
      .from('items')
      .select('id, source, created_at')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString()),
    supabase
      .from('item_feedback')
      .select('item_id')
      .eq('user_id', userId)
      .eq('kind', 'slop'),
    supabase
      .from('items')
      .select('function_ids')
      .eq('user_id', userId)
      .gte('created_at', weekStart.toISOString())
      .not('function_ids', 'is', null),
    supabase
      .from('user_functions')
      .select('id, name')
      .eq('user_id', userId)
      .is('deleted_at', null),
  ])

  const slopIds = new Set((slop30 ?? []).map(s => s.item_id as string))

  type SlopPoint = { date: string; source: string; slopPct: number }
  const daySourceTotal: Record<string, Record<string, number>> = {}
  const daySourceSlop: Record<string, Record<string, number>> = {}

  for (const item of items30 ?? []) {
    const day = (item.created_at as string).slice(0, 10)
    const src = item.source as string
    daySourceTotal[day] ??= {}
    daySourceSlop[day] ??= {}
    daySourceTotal[day][src] = (daySourceTotal[day][src] ?? 0) + 1
    if (slopIds.has(item.id as string)) {
      daySourceSlop[day][src] = (daySourceSlop[day][src] ?? 0) + 1
    }
  }

  const slopTimeSeries: SlopPoint[] = []
  for (const day of Object.keys(daySourceTotal).sort()) {
    for (const src of Object.keys(daySourceTotal[day])) {
      const total = daySourceTotal[day][src]
      const slop = daySourceSlop[day]?.[src] ?? 0
      slopTimeSeries.push({ date: day, source: src, slopPct: Math.round(slop / total * 100) })
    }
  }

  const fnMap = new Map((fns ?? []).map(f => [f.id as string, f.name as string]))
  const fnCount: Record<string, number> = {}
  let weekTotal = 0

  for (const item of weekItems ?? []) {
    for (const fid of (item.function_ids as string[]) ?? []) {
      fnCount[fid] = (fnCount[fid] ?? 0) + 1
      weekTotal++
    }
  }

  const topFnId = Object.entries(fnCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topFunction = topFnId
    ? {
        name: fnMap.get(topFnId) ?? topFnId,
        count: fnCount[topFnId],
        pct: weekTotal > 0 ? Math.round((fnCount[topFnId] / weekTotal) * 100) : 0,
      }
    : null

  return {
    clearedToday: clearedToday ?? 0,
    clearedWeek: clearedWeek ?? 0,
    clearedMonth: clearedMonth ?? 0,
    slopTimeSeries,
    topFunction,
  }
}

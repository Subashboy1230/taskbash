// Server loader for /observability — pulls aggregates from llm_calls
// and item_feedback for the admin dashboard.

import { supabase } from './supabase'
import { resolveUserId } from './supabase-server'

export interface PromptStat {
  prompt_id: string
  prompt_version: number
  calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  avg_latency_ms: number
  errors: number
  // Items this prompt produced that the user later marked as slop.
  slop_count: number
  // Items produced ÷ items slopped — quality signal.
  slop_rate: number
}

export interface ObservabilitySummary {
  // Top of the funnel — last 24h
  calls_today: number
  cost_today: number
  tokens_today: number
  errors_today: number
  // Per prompt + per version
  per_prompt: PromptStat[]
  // Slop corpus size — drives the "training data" call-to-action
  slop_total: number
  slop_today: number
  // Most recent calls for the live feed
  recent_calls: Array<{
    id: string
    prompt_id: string
    prompt_version: number
    request_model: string
    finish_reason: string | null
    input_tokens: number | null
    output_tokens: number | null
    cost_usd: number | null
    latency_ms: number | null
    started_at: string
    error: string | null
    response_text: string | null
  }>
  // Eval dataset suggestions for the Promote modal
  dataset_suggestions: Array<{ id: string; name: string; prompt_id: string }>
}

export async function loadObservability(): Promise<ObservabilitySummary> {
  const userId = await resolveUserId()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ─── Top-of-funnel aggregates (last 24h) ─────────────────────────
  const { data: callsToday, error: ctErr } = await supabase
    .from('llm_calls')
    .select('input_tokens, output_tokens, cost_usd, finish_reason')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .gte('started_at', since24h)
    .limit(5000)
  if (ctErr) throw new Error(`loadObservability calls failed: ${ctErr.message}`)

  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  let totalErrors = 0
  for (const c of callsToday ?? []) {
    totalInput += c.input_tokens ?? 0
    totalOutput += c.output_tokens ?? 0
    totalCost += Number(c.cost_usd ?? 0)
    if (c.finish_reason === 'error') totalErrors++
  }

  // ─── Per-prompt aggregates (all time so the slop rate is meaningful) ─
  const { data: allCalls, error: acErr } = await supabase
    .from('llm_calls')
    .select(
      'id, prompt_id, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms, finish_reason, produced_item_ids'
    )
    .or(`user_id.eq.${userId},user_id.is.null`)
    .limit(5000)
  if (acErr) throw new Error(`loadObservability per-prompt failed: ${acErr.message}`)

  // Build a map of llm_call_id → was_slopped (any feedback row links).
  const { data: feedbackRows, error: fbErr } = await supabase
    .from('item_feedback')
    .select('llm_call_id, kind, created_at')
    .eq('user_id', userId)
    .eq('kind', 'slop')
    .limit(5000)
  if (fbErr) throw new Error(`loadObservability feedback failed: ${fbErr.message}`)
  const slopCallIds = new Set<string>()
  let slopToday = 0
  for (const f of feedbackRows ?? []) {
    if (f.llm_call_id) slopCallIds.add(f.llm_call_id)
    if (f.created_at >= since24h) slopToday++
  }

  // Group calls by (prompt_id, prompt_version).
  const bucketKey = (p: string, v: number) => `${p}::v${v}`
  const buckets = new Map<
    string,
    {
      prompt_id: string
      prompt_version: number
      calls: number
      input_tokens: number
      output_tokens: number
      cost_usd: number
      latency_sum_ms: number
      errors: number
      slop_count: number
    }
  >()
  for (const c of allCalls ?? []) {
    const key = bucketKey(c.prompt_id, c.prompt_version)
    const b =
      buckets.get(key) ??
      {
        prompt_id: c.prompt_id,
        prompt_version: c.prompt_version,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        latency_sum_ms: 0,
        errors: 0,
        slop_count: 0,
      }
    b.calls += 1
    b.input_tokens += c.input_tokens ?? 0
    b.output_tokens += c.output_tokens ?? 0
    b.cost_usd += Number(c.cost_usd ?? 0)
    b.latency_sum_ms += c.latency_ms ?? 0
    if (c.finish_reason === 'error') b.errors += 1
    if (slopCallIds.has(c.id)) b.slop_count += 1
    buckets.set(key, b)
  }

  const per_prompt: PromptStat[] = Array.from(buckets.values())
    .map(b => ({
      prompt_id: b.prompt_id,
      prompt_version: b.prompt_version,
      calls: b.calls,
      input_tokens: b.input_tokens,
      output_tokens: b.output_tokens,
      cost_usd: Number(b.cost_usd.toFixed(4)),
      avg_latency_ms: Math.round(b.latency_sum_ms / Math.max(1, b.calls)),
      errors: b.errors,
      slop_count: b.slop_count,
      slop_rate: b.calls > 0 ? Number((b.slop_count / b.calls).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.calls - a.calls)

  // ─── Recent live feed ────────────────────────────────────────────
  const { data: recentRows, error: rrErr } = await supabase
    .from('llm_calls')
    .select(
      'id, prompt_id, prompt_version, request_model, finish_reason, input_tokens, output_tokens, cost_usd, latency_ms, started_at, error, response_text'
    )
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('started_at', { ascending: false })
    .limit(30)
  if (rrErr) throw new Error(`loadObservability recent failed: ${rrErr.message}`)

  // ─── Dataset suggestions for the Promote modal ──────────────────
  const { data: dsRows, error: dsErr } = await supabase
    .from('eval_datasets')
    .select('id, name, prompt_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (dsErr) {
    // Don't fail the whole load — the migration may not have been
    // applied yet. Just return an empty suggestion list.
    console.warn('loadObservability dataset suggestions:', dsErr.message)
  }

  // ─── Slop corpus size (count, not row) ────────────────────────────
  const { count: slopTotal, error: stErr } = await supabase
    .from('item_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', 'slop')
  if (stErr) throw new Error(`loadObservability slop count failed: ${stErr.message}`)

  return {
    calls_today: callsToday?.length ?? 0,
    cost_today: Number(totalCost.toFixed(4)),
    tokens_today: totalInput + totalOutput,
    errors_today: totalErrors,
    per_prompt,
    slop_total: slopTotal ?? 0,
    slop_today: slopToday,
    recent_calls: (recentRows ?? []) as ObservabilitySummary['recent_calls'],
    dataset_suggestions: (dsRows ?? []) as ObservabilitySummary['dataset_suggestions'],
  }
}

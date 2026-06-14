// Loaders for the Agent Activity panel.
//   - loadRunSteps(runId): the live/replayed step timeline for one run.
//   - loadRecentRuns(userId): the run-history list behind the history icon.
// Both scope by user_id so a caller only ever sees their own runs.

import { supabase } from './supabase'
import type { RunStep } from './types'

export interface RunSummary {
  status: 'running' | 'succeeded' | 'failed' | 'superseded' | null
  trigger: 'cron' | 'manual' | null
  started_at: string | null
  completed_at: string | null
  new_count: number | null
  carryover_count: number | null
  sources_run: string[] | null
  sources_failed: string[] | null
}

export interface RunStepsResult {
  run: RunSummary | null
  steps: RunStep[]
}

const RUN_FIELDS =
  'status, trigger, started_at, completed_at, new_count, carryover_count, sources_run, sources_failed'

export async function loadRunSteps(
  runId: string,
  userId: string
): Promise<RunStepsResult> {
  const [runRes, stepRes] = await Promise.all([
    supabase
      .from('runs')
      .select(RUN_FIELDS)
      .eq('id', runId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('run_steps')
      .select('*')
      .eq('run_id', runId)
      .eq('user_id', userId)
      .order('seq', { ascending: true }),
  ])
  return {
    run: (runRes.data as RunSummary | null) ?? null,
    steps: (stepRes.data as RunStep[] | null) ?? [],
  }
}

export interface RecentRun extends RunSummary {
  id: string
}

export async function loadRecentRuns(
  userId: string,
  limit = 15
): Promise<RecentRun[]> {
  const { data } = await supabase
    .from('runs')
    .select(`id, ${RUN_FIELDS}`)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data as RecentRun[] | null) ?? []
}

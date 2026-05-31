// Headless eval runner. Same scoring logic as scripts/run-eval.ts but
// returns a structured result instead of printing to stdout, so it can
// be called from an Inngest cron, a server action, or the CLI wrapper.
//
// Phase B2: when a case has input_content + the prompt_id has a replay
// function registered in lib/eval/replay.ts, we test the CURRENT prompt
// in the codebase. Otherwise we re-send the saved request_payload (B1
// fallback). The summary reports which path each case took.

import type Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../supabase'
import { anthropic } from '../anthropic'
import { replayByPromptId } from './replay'

export interface RunDatasetOpts {
  /** auth.users.id — used to insert the eval_runs row. */
  userId: string
  /** Dataset row id. */
  datasetId: string
  /** Dataset row name (for logging). */
  datasetName: string
  /** Dataset row prompt_id (used by the replay dispatch). */
  promptId: string
  /** Cap on how many cases to score this run. */
  limit?: number
  /** Free-text note saved on eval_runs (e.g. cron tag, manual note). */
  notes?: string | null
}

export interface RunDatasetResult {
  runId: string
  datasetName: string
  promptId: string
  total: number
  passed: number
  failed: number
  errored: number
  currentPromptUsed: number
  savedPromptUsed: number
  /** passed / (passed + failed) as a 0..1 float, or null when denom = 0. */
  passRate: number | null
}

interface RawCase {
  id: string
  request_payload: {
    model: string
    max_tokens: number
    system?: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  input_content: unknown | null
  expected_output: string | null
  expected_behavior: 'exact' | 'contains' | 'empty' | 'manual_review'
  notes: string | null
}

export async function runDataset(opts: RunDatasetOpts): Promise<RunDatasetResult> {
  const limit = opts.limit ?? 999

  const { data: cases, error: casesErr } = await supabase
    .from('eval_cases')
    .select('id, request_payload, input_content, expected_output, expected_behavior, notes')
    .eq('dataset_id', opts.datasetId)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (casesErr) throw new Error(`load cases: ${casesErr.message}`)
  if (!cases || cases.length === 0) {
    // Open an empty run row anyway so it's auditable.
    const { data: runRow, error } = await supabase
      .from('eval_runs')
      .insert({
        dataset_id: opts.datasetId,
        prompt_id: opts.promptId,
        model: null,
        total: 0,
        passed: 0,
        failed: 0,
        errored: 0,
        notes: opts.notes ?? null,
        ended_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !runRow) throw new Error(`insert empty run: ${error?.message}`)
    return {
      runId: runRow.id,
      datasetName: opts.datasetName,
      promptId: opts.promptId,
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      currentPromptUsed: 0,
      savedPromptUsed: 0,
      passRate: null,
    }
  }

  const sampleModel = (cases[0] as RawCase).request_payload.model
  const { data: runRow, error: runInsertErr } = await supabase
    .from('eval_runs')
    .insert({
      dataset_id: opts.datasetId,
      prompt_id: opts.promptId,
      model: sampleModel,
      total: cases.length,
      passed: 0,
      failed: 0,
      errored: 0,
      notes: opts.notes ?? null,
    })
    .select('id')
    .single()
  if (runInsertErr || !runRow) throw new Error(`start run: ${runInsertErr?.message}`)
  const runId = runRow.id

  let passed = 0
  let failed = 0
  let errored = 0
  let currentPromptUsed = 0
  let savedPromptUsed = 0

  for (const raw of cases) {
    const c = raw as RawCase
    try {
      let output: string
      if (c.input_content) {
        const replayResult = await replayByPromptId(opts.promptId, c.input_content, anthropic)
        if (replayResult) {
          output = replayResult.responseText.trim()
          currentPromptUsed++
        } else {
          output = await replaySaved(anthropic, c.request_payload)
          savedPromptUsed++
        }
      } else {
        output = await replaySaved(anthropic, c.request_payload)
        savedPromptUsed++
      }

      const expected = (c.expected_output ?? '').trim()
      const { isPassing, diff } = scoreCase(c.expected_behavior, expected, output)

      await supabase.from('eval_case_results').insert({
        run_id: runId,
        case_id: c.id,
        output,
        passed: isPassing,
        diff,
        error: null,
      })

      if (isPassing) passed++
      else failed++
    } catch (err) {
      errored++
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('eval_case_results').insert({
        run_id: runId,
        case_id: c.id,
        output: null,
        passed: false,
        diff: null,
        error: msg.slice(0, 500),
      })
    }
  }

  await supabase
    .from('eval_runs')
    .update({
      ended_at: new Date().toISOString(),
      passed,
      failed,
      errored,
    })
    .eq('id', runId)

  const denom = passed + failed
  return {
    runId,
    datasetName: opts.datasetName,
    promptId: opts.promptId,
    total: cases.length,
    passed,
    failed,
    errored,
    currentPromptUsed,
    savedPromptUsed,
    passRate: denom > 0 ? passed / denom : null,
  }
}

async function replaySaved(
  client: Anthropic,
  payload: RawCase['request_payload']
): Promise<string> {
  const response = await client.messages.create(payload)
  return response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

function scoreCase(
  behavior: RawCase['expected_behavior'],
  expected: string,
  output: string
): { isPassing: boolean; diff: string | null } {
  switch (behavior) {
    case 'exact':
      return output === expected
        ? { isPassing: true, diff: null }
        : { isPassing: false, diff: compactDiff(expected, output) }
    case 'contains':
      return expected.length === 0 || output.includes(expected)
        ? { isPassing: true, diff: null }
        : { isPassing: false, diff: `expected substring not found: ${expected.slice(0, 80)}` }
    case 'empty':
      return output.length === 0 ||
        output === '[]' ||
        output === '{}' ||
        /no items|no actions|nothing to extract/i.test(output)
        ? { isPassing: true, diff: null }
        : { isPassing: false, diff: `expected empty, got ${output.length} chars: ${output.slice(0, 80)}` }
    case 'manual_review':
    default:
      return { isPassing: true, diff: null }
  }
}

function compactDiff(expected: string, actual: string): string {
  const maxLen = 120
  if (expected.length === 0) return `expected empty, got ${actual.length} chars`
  let i = 0
  while (i < Math.min(expected.length, actual.length) && expected[i] === actual[i]) {
    i++
  }
  const before = expected.slice(Math.max(0, i - 20), i)
  const expectedAt = expected.slice(i, Math.min(expected.length, i + 60))
  const actualAt = actual.slice(i, Math.min(actual.length, i + 60))
  return `…${before}[exp:${expectedAt}|got:${actualAt}]`.slice(0, maxLen)
}

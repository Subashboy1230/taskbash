'use server'

// Server Actions for /observability.
//
// promoteToDataset: takes a recorded llm_calls row and creates an
// eval_cases entry from it. Auto-creates the dataset if it doesn't
// exist. The expected_output defaults to the response we got — assumes
// the user is promoting a GOOD call. Set expected_behavior='empty' for
// a slop case.

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { resolveUserId } from '@/lib/supabase-server'

export type ExpectedBehavior = 'exact' | 'contains' | 'empty' | 'manual_review'
export type CaseSource = 'promoted_from_trace' | 'manual' | 'slop_negative'

/**
 * Look up (and create if missing) a dataset for the current user, and
 * insert a case into it from an existing llm_calls row.
 *
 * The case's request_payload is copied verbatim from the call so
 * `npm run eval` can replay it byte-for-byte.
 */
export async function promoteCallToDataset(args: {
  callId: string
  datasetName: string
  description?: string
  expectedOutput?: string
  expectedBehavior?: ExpectedBehavior
  source?: CaseSource
  notes?: string
}): Promise<
  | { ok: true; datasetId: string; caseId: string; createdDataset: boolean }
  | { ok: false; error: string }
> {
  const userId = await resolveUserId()

  // 1. Pull the call we're promoting.
  const { data: call, error: callErr } = await supabase
    .from('llm_calls')
    .select('id, prompt_id, prompt_version, request_payload, response_text, input_content')
    .eq('id', args.callId)
    .maybeSingle()
  if (callErr) return { ok: false, error: callErr.message }
  if (!call) return { ok: false, error: 'LLM call not found.' }

  // 2. Find or create the dataset (scoped to user + prompt_id).
  let datasetId: string | null = null
  let createdDataset = false
  const { data: existing, error: lookupErr } = await supabase
    .from('eval_datasets')
    .select('id, prompt_id')
    .eq('user_id', userId)
    .eq('name', args.datasetName)
    .maybeSingle()
  if (lookupErr) return { ok: false, error: lookupErr.message }

  if (existing) {
    // Sanity check — datasets are pinned to a single prompt_id so the
    // runner can pick the right replay strategy later.
    if (existing.prompt_id !== call.prompt_id) {
      return {
        ok: false,
        error: `Dataset "${args.datasetName}" is for ${existing.prompt_id}; this call is ${call.prompt_id}.`,
      }
    }
    datasetId = existing.id
  } else {
    const { data: newDs, error: insertDsErr } = await supabase
      .from('eval_datasets')
      .insert({
        user_id: userId,
        name: args.datasetName,
        prompt_id: call.prompt_id,
        description: args.description ?? null,
      })
      .select('id')
      .single()
    if (insertDsErr) return { ok: false, error: insertDsErr.message }
    datasetId = newDs.id
    createdDataset = true
  }

  // 3. Insert the case.
  const expectedOutput =
    args.expectedOutput ?? call.response_text ?? ''
  const expectedBehavior: ExpectedBehavior =
    args.expectedBehavior ??
    (args.source === 'slop_negative' ? 'empty' : 'exact')

  const { data: caseRow, error: caseErr } = await supabase
    .from('eval_cases')
    .insert({
      dataset_id: datasetId!,
      source: args.source ?? 'promoted_from_trace',
      source_llm_call_id: call.id,
      request_payload: call.request_payload,
      // Copy the structured input from the producing call. When
      // present, the eval runner uses replayByPromptId() to test the
      // CURRENT prompt against this input; when absent, falls back to
      // replaying request_payload as-is.
      input_content: (call as { input_content?: unknown }).input_content ?? null,
      expected_output: expectedOutput,
      expected_behavior: expectedBehavior,
      notes: args.notes ?? null,
    })
    .select('id')
    .single()
  if (caseErr) return { ok: false, error: caseErr.message }

  revalidatePath('/observability')
  revalidatePath('/evals')
  return {
    ok: true,
    datasetId: datasetId!,
    caseId: caseRow.id,
    createdDataset,
  }
}

/**
 * List the current user's datasets — used by the Promote modal to
 * populate the dropdown of existing datasets.
 */
export async function listDatasets(): Promise<
  Array<{ id: string; name: string; prompt_id: string; case_count: number }>
> {
  const userId = await resolveUserId()
  const { data, error } = await supabase
    .from('eval_datasets')
    .select('id, name, prompt_id, eval_cases(count)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listDatasets failed: ${error.message}`)
  return (data ?? []).map(d => {
    const counts = (d as unknown as { eval_cases: Array<{ count: number }> })
      .eval_cases
    return {
      id: d.id,
      name: d.name,
      prompt_id: d.prompt_id,
      case_count: counts?.[0]?.count ?? 0,
    }
  })
}

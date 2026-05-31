// scripts/run-eval.ts — CLI wrapper around lib/eval/run-dataset.ts.
//
// The actual scoring logic lives in lib/eval/run-dataset.ts so it can
// be shared between this CLI and the eval-cron Inngest function. This
// file is now just a thin wrapper that resolves a dataset by name and
// prints a summary.
//
// Run:
//   npm run eval -- --dataset gold-extract.gmail
//   npm run eval -- --dataset slop-extract.gmail --limit 5
//   npm run eval -- --dataset gold-extract.gmail --notes "v3 prompt"

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

interface RawCase {
  id: string
  request_payload: {
    model: string
    max_tokens: number
    system?: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }
  // Optional structured input. When present, the runner builds a fresh
  // request via lib/eval/replay.ts using the CURRENT prompt template
  // rather than re-sending request_payload (which has the old prompt
  // baked in). This is the B2 path — true prompt regression testing.
  input_content: unknown | null
  expected_output: string | null
  expected_behavior: 'exact' | 'contains' | 'empty' | 'manual_review'
  notes: string | null
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env.local')
    process.exit(1)
  }
  if (!process.env.APP_USER_ID) {
    console.error('Missing APP_USER_ID in .env.local')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const datasetName = flag(args, '--dataset')
  const limit = Number(flag(args, '--limit') ?? '999')
  const notes = flag(args, '--notes') ?? null

  if (!datasetName) {
    console.error('Usage: npm run eval -- --dataset <name> [--limit N] [--notes "..."]')
    process.exit(1)
  }

  const { supabase } = await import('../lib/supabase')
  const { anthropic } = await import('../lib/anthropic')

  // ─── Look up the dataset ────────────────────────────────────────
  const { data: dataset, error: dsErr } = await supabase
    .from('eval_datasets')
    .select('id, name, prompt_id, description')
    .eq('user_id', process.env.APP_USER_ID!)
    .eq('name', datasetName)
    .maybeSingle()
  if (dsErr || !dataset) {
    console.error(`Dataset "${datasetName}" not found.`)
    process.exit(1)
  }

  // ─── Pull cases ─────────────────────────────────────────────────
  const { data: cases, error: casesErr } = await supabase
    .from('eval_cases')
    .select('id, request_payload, input_content, expected_output, expected_behavior, notes')
    .eq('dataset_id', dataset.id)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (casesErr) {
    console.error('Failed to load cases:', casesErr.message)
    process.exit(1)
  }
  if (!cases || cases.length === 0) {
    console.log('No cases in this dataset.')
    return
  }

  console.log(
    `\nRunning ${cases.length} case(s) from "${dataset.name}" (${dataset.prompt_id})\n`
  )

  // ─── Open an eval_runs row ──────────────────────────────────────
  const sampleModel = (cases[0] as RawCase).request_payload.model
  const { data: runRow, error: runInsertErr } = await supabase
    .from('eval_runs')
    .insert({
      dataset_id: dataset.id,
      prompt_id: dataset.prompt_id,
      // prompt_version: TODO — read from the relevant extractor module
      //   once Phase B2 adds replay functions. For now, leave null.
      model: sampleModel,
      total: cases.length,
      passed: 0,
      failed: 0,
      errored: 0,
      notes,
    })
    .select('id')
    .single()
  if (runInsertErr || !runRow) {
    console.error('Failed to start run:', runInsertErr?.message)
    process.exit(1)
  }
  const runId = runRow.id

  // Map prompt_id → "current prompt" replay function. When a case has
  // input_content AND its prompt_id is supported, we test the CURRENT
  // codebase prompt (B2). Otherwise we fall back to replaying the
  // saved request_payload (B1).
  const { replayByPromptId } = await import('../lib/eval/replay')
  let currentPromptUsed = 0
  let savedPromptUsed = 0

  // ─── Score each case ───────────────────────────────────────────
  let passed = 0
  let failed = 0
  let errored = 0
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as RawCase
    const tag = `[${i + 1}/${cases.length}]`
    try {
      // B2 path: structured input → current prompt
      let output: string
      let pathTag: 'current' | 'saved' = 'saved'
      if (c.input_content) {
        const replayResult = await replayByPromptId(
          dataset.prompt_id,
          c.input_content,
          anthropic
        )
        if (replayResult) {
          output = replayResult.responseText.trim()
          pathTag = 'current'
          currentPromptUsed++
        } else {
          // Prompt not supported yet — fall through to saved.
          const response = await anthropic.messages.create(c.request_payload)
          output = response.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map(b => b.text)
            .join('\n')
            .trim()
          savedPromptUsed++
        }
      } else {
        // B1 path: no structured input on this case → replay saved request
        const response = await anthropic.messages.create(c.request_payload)
        output = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim()
        savedPromptUsed++
      }
      void pathTag // logged in the per-case line below

      const expected = (c.expected_output ?? '').trim()
      let isPassing: boolean
      let diff: string | null = null
      switch (c.expected_behavior) {
        case 'exact':
          isPassing = output === expected
          if (!isPassing) diff = compactDiff(expected, output)
          break
        case 'contains':
          isPassing = expected.length === 0 || output.includes(expected)
          if (!isPassing) diff = `expected substring not found: ${expected.slice(0, 80)}`
          break
        case 'empty':
          // A response is "empty" if the model returns nothing or
          // returns an empty-array / empty-object signal. Tolerate
          // common JSON-empty markers.
          isPassing =
            output.length === 0 ||
            output === '[]' ||
            output === '{}' ||
            /no items|no actions|nothing to extract/i.test(output)
          if (!isPassing) diff = `expected empty, got ${output.length} chars: ${output.slice(0, 80)}…`
          break
        case 'manual_review':
        default:
          isPassing = true // counts as passed; mark in notes
          diff = null
          break
      }

      await supabase.from('eval_case_results').insert({
        run_id: runId,
        case_id: c.id,
        output,
        passed: isPassing,
        diff,
        error: null,
      })

      if (isPassing) {
        passed++
        console.log(`${tag} ✓ pass [${pathTag}] — ${c.expected_behavior}`)
      } else {
        failed++
        console.log(`${tag} ✗ fail [${pathTag}] — ${c.expected_behavior} — ${diff?.slice(0, 100) ?? ''}`)
      }
    } catch (err) {
      errored++
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${tag} ! error — ${msg.slice(0, 100)}`)
      await supabase.from('eval_case_results').insert({
        run_id: runId,
        case_id: c.id,
        output: null,
        passed: false,
        diff: null,
        error: msg,
      })
    }
  }

  // ─── Finalize the run ─────────────────────────────────────────
  await supabase
    .from('eval_runs')
    .update({
      ended_at: new Date().toISOString(),
      passed,
      failed,
      errored,
    })
    .eq('id', runId)

  console.log('\n─── Summary ────────────────────────────────────')
  console.log(`  Dataset:        ${dataset.name}`)
  console.log(`  Prompt:         ${dataset.prompt_id}`)
  console.log(`  Model:          ${sampleModel}`)
  console.log(`  Total:          ${cases.length}`)
  console.log(`  Passed:         ${passed}`)
  console.log(`  Failed:         ${failed}`)
  console.log(`  Errored:        ${errored}`)
  console.log(`  Current prompt: ${currentPromptUsed} cases  (B2 — tests today's prompt)`)
  console.log(`  Saved request:  ${savedPromptUsed} cases  (B1 fallback)`)
  const denom = passed + failed
  if (denom > 0) {
    const pct = ((passed / denom) * 100).toFixed(1)
    console.log(`  Pass rate: ${pct}%`)
  }
  console.log(`\n  Run id: ${runId}`)
  console.log('  See full results in supabase: select * from eval_case_results where run_id = ...')
}

/**
 * Return a short snippet of the diff between expected and actual,
 * highlighting the first divergence so the CLI summary is scannable.
 */
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

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  return idx >= 0 ? argv[idx + 1] : undefined
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

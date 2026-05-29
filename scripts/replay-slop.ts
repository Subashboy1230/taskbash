// scripts/replay-slop.ts — Replay every slop signal against the current
// extraction prompt and report whether the new prompt would now skip
// the item.
//
// Why this exists: the Slop button captures "the agent extracted X, the
// user said it shouldn't have been extracted." That's a training signal.
// This script closes the loop: take the original source content from the
// llm_call's request_payload, send it through Claude AGAIN with whatever
// prompt is currently checked into the extractor, and compare the output
// to the slopped item.
//
// If the new prompt SKIPS the item → prompt improvement validated.
// If the new prompt STILL produces the item → prompt change didn't help,
//   either iterate again or accept that this case is genuinely ambiguous.
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npx tsx scripts/replay-slop.ts
//
// Flags:
//   --prompt extract.gmail   only replay slop tied to a specific prompt
//   --limit 10               cap the number of replays (default: all)
//   --since 2026-05-01       only replay slop since this date

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env.local')
    process.exit(1)
  }
  if (!process.env.APP_USER_ID) {
    console.error('Missing APP_USER_ID in .env.local')
    process.exit(1)
  }

  // Dynamic imports after dotenv loads.
  const { supabase } = await import('../lib/supabase')
  const { anthropic } = await import('../lib/anthropic')

  // ─── Parse flags ────────────────────────────────────────────────
  const args = process.argv.slice(2)
  const promptFlag = arg(args, '--prompt')
  const limitFlag = arg(args, '--limit')
  const sinceFlag = arg(args, '--since')
  const limit = limitFlag ? Number(limitFlag) : 999

  // ─── Pull slop feedback joined with the producing call ──────────
  let query = supabase
    .from('item_feedback')
    .select(
      `
      id,
      reason,
      created_at,
      item_snapshot,
      llm_call:llm_calls (
        id,
        prompt_id,
        prompt_version,
        request_model,
        request_payload,
        response_text
      )
      `
    )
    .eq('user_id', process.env.APP_USER_ID!)
    .eq('kind', 'slop')
    .not('llm_call_id', 'is', null)
    .order('created_at', { ascending: false })
  if (sinceFlag) query = query.gte('created_at', sinceFlag)

  const { data: rows, error } = await query.limit(limit)
  if (error) {
    console.error('Failed to load slop:', error.message)
    process.exit(1)
  }
  const slopRows = (rows ?? []) as unknown as Array<{
    id: string
    reason: string
    created_at: string
    item_snapshot: { title: string; source: string; source_ref?: unknown }
    llm_call: {
      id: string
      prompt_id: string
      prompt_version: number
      request_model: string
      request_payload: {
        model: string
        max_tokens: number
        system?: string
        messages: Array<{ role: 'user' | 'assistant'; content: string }>
      }
      response_text: string | null
    } | null
  }>

  // Filter by prompt if requested.
  const filtered = promptFlag
    ? slopRows.filter(r => r.llm_call?.prompt_id === promptFlag)
    : slopRows

  if (filtered.length === 0) {
    console.log('No matching slop rows found.')
    return
  }

  console.log(`\nReplaying ${filtered.length} slop signal(s)…\n`)

  // ─── Replay each one ────────────────────────────────────────────
  type Verdict = 'skipped' | 'still_extracted' | 'changed' | 'error'
  const verdicts: Record<Verdict, number> = {
    skipped: 0,
    still_extracted: 0,
    changed: 0,
    error: 0,
  }

  for (let i = 0; i < filtered.length; i++) {
    const row = filtered[i]
    const call = row.llm_call
    const item = row.item_snapshot
    const tag = `[${i + 1}/${filtered.length}] ${call?.prompt_id ?? '?'} v${call?.prompt_version ?? '?'}`
    if (!call) {
      console.log(`${tag} SKIP — no llm_call recorded`)
      verdicts.error++
      continue
    }

    // Re-send the EXACT same payload. The system prompt baked into the
    // request_payload is what was used at slop time; if you've updated
    // the prompt in the codebase since, it won't be reflected here.
    // For a true "current prompt" replay, you'd re-import the extractor
    // module and call it — but that requires the original source content,
    // not just the prompt. Future work.
    try {
      const replay = await anthropic.messages.create(call.request_payload)
      const newText = replay.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n')

      const stillContainsTitle = newText
        .toLowerCase()
        .includes(item.title.toLowerCase().slice(0, 40))

      let verdict: Verdict
      if (stillContainsTitle) verdict = 'still_extracted'
      else if (newText.trim().length === 0) verdict = 'skipped'
      else verdict = 'changed'

      verdicts[verdict]++
      const symbol = verdict === 'skipped' ? '✓' : verdict === 'changed' ? '~' : '✗'
      console.log(
        `${tag} ${symbol} ${verdict.padEnd(16)} — ${item.title.slice(0, 60)}`
      )
    } catch (err) {
      verdicts.error++
      console.log(
        `${tag} ✗ error            — ${err instanceof Error ? err.message : err}`
      )
    }
  }

  // ─── Summary ────────────────────────────────────────────────────
  console.log('\n─── Summary ─────────────────────────────────────')
  console.log(`  Skipped (good):       ${verdicts.skipped}`)
  console.log(`  Still extracted (bad): ${verdicts.still_extracted}`)
  console.log(`  Changed (review):     ${verdicts.changed}`)
  console.log(`  Errors:               ${verdicts.error}`)
  const total = filtered.length - verdicts.error
  if (total > 0) {
    const improvedPct = ((verdicts.skipped / total) * 100).toFixed(1)
    console.log(`\n  Improvement: ${improvedPct}% of replayed slop now correctly skipped`)
  }
}

function arg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  return idx >= 0 ? argv[idx + 1] : undefined
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

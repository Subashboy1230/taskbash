// scripts/backfill-functions.ts — assign function tags to existing
// items.
//
// The auto-tagger runs inside the morning digest for FRESH items. This
// script handles the back-catalog: items that landed before functions
// were defined / before the auto-tagger shipped.
//
// What it does:
//   1. Pulls every open + in_progress item that has no function_ids yet
//   2. Loads the user's defined functions
//   3. Runs them through classifyAndTagFunctions
//   4. Writes the assigned ids back to items.function_ids
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run backfill:functions
//
// Flags:
//   --limit 50    cap the number of items processed (default: 500)
//   --status open  filter by status (default: 'open,in_progress')

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.APP_USER_ID) {
    console.error('Missing ANTHROPIC_API_KEY or APP_USER_ID in .env.local')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const limit = Number(flag(args, '--limit') ?? '500')
  const statusFilter = (flag(args, '--status') ?? 'open,in_progress').split(',')

  // Dynamic imports after dotenv loads.
  const { supabase } = await import('../lib/supabase')
  const { loadUserFunctions } = await import('../lib/load-functions')
  const { classifyAndTagFunctions } = await import('../lib/classify/functions')

  const functions = await loadUserFunctions()
  if (functions.length === 0) {
    console.error(
      'No user functions defined yet. Visit /settings/functions and either Seed defaults or add some, then re-run this.'
    )
    process.exit(1)
  }
  console.log(
    `Loaded ${functions.length} function(s): ${functions.map(f => f.name).join(', ')}\n`
  )

  // Pull items that have no function tags yet.
  const { data: rows, error } = await supabase
    .from('items')
    .select('id, title, parent_context, source, source_excerpt, function_ids')
    .eq('user_id', process.env.APP_USER_ID!)
    .in('status', statusFilter)
    .or('function_ids.is.null,function_ids.eq.{}')
    .order('first_seen_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('Failed to load items:', error.message)
    process.exit(1)
  }
  const items = (rows ?? []) as Array<{
    id: string
    title: string
    parent_context: string | null
    source: string
    source_excerpt: string | null
    function_ids: string[] | null
  }>

  if (items.length === 0) {
    console.log('No untagged items — nothing to backfill.')
    return
  }
  console.log(`Found ${items.length} untagged item(s). Classifying…\n`)

  // Convert DB rows into the shape classifyAndTagFunctions expects
  // (ExtractedItem-like, but we only need title + parent_context +
  // source + source_excerpt for the classifier).
  const synthetic = items.map(it => ({
    id: it.id,
    title: it.title,
    parent_context: it.parent_context,
    source: it.source as unknown as never,
    source_ref: {},
    task_type: 'manual' as const,
    source_excerpt: it.source_excerpt,
    function_ids: [] as string[],
  })) as unknown as import('../lib/types').ExtractedItem[]

  const { classifyCallId } = await classifyAndTagFunctions({
    items: synthetic,
    functions,
    userId: process.env.APP_USER_ID,
  })
  void classifyCallId // intentionally unused — backfill doesn't persist classify_call_id

  // Persist assigned ids back to the DB.
  let tagged = 0
  let skipped = 0
  for (let i = 0; i < synthetic.length; i++) {
    const fids = synthetic[i].function_ids ?? []
    if (fids.length === 0) {
      skipped++
      continue
    }
    const { error: updErr } = await supabase
      .from('items')
      .update({ function_ids: fids })
      .eq('id', items[i].id)
    if (updErr) {
      console.error(`  [${i + 1}] FAIL ${items[i].title.slice(0, 60)}: ${updErr.message}`)
      continue
    }
    tagged++
    const names = fids
      .map(id => functions.find(f => f.id === id)?.name ?? '?')
      .join(', ')
    console.log(`  [${i + 1}] [${names}] ${items[i].title.slice(0, 70)}`)
  }

  console.log(`\nDone. Tagged ${tagged} item(s); ${skipped} left untagged (no clear function fit).`)
}

function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name)
  return idx >= 0 ? argv[idx + 1] : undefined
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

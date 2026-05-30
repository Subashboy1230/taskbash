// Debug: run the full digest pipeline locally and print every stage's
// output. Use this to see exactly where Gmail items are getting dropped.
//
//   npx tsx scripts/debug-digest.ts
//   npx tsx scripts/debug-digest.ts gmail        # one source
//   npx tsx scripts/debug-digest.ts gmail 14     # custom lookback days
//
// IMPORTANT: dotenv must run BEFORE any lib import that validates env
// at module load (e.g. lib/nango.ts throws on missing NANGO_SECRET_KEY
// as soon as it's imported). Static imports hoist; dynamic imports
// don't. So we config() first then import().

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { extractGmailActionItems } = await import('../lib/extract/gmail')
  const { extractGranolaActionItems } = await import('../lib/extract/granola')
  const { extractLinearActionItems } = await import('../lib/extract/linear')
  const { extractCalendarPrepItems } = await import('../lib/extract/calendar')
  const { diffSingleSource } = await import('../lib/diff')
  const { computeSemanticHash } = await import('../lib/normalize')
  type ExtractedItem = import('../lib/types').ExtractedItem
  type Item = import('../lib/types').Item
  type Source = import('../lib/types').Source
  type SourceRef = import('../lib/types').SourceRef

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const userEmail = 'subash@sigiq.ai'
  const supabase = createClient(url, key)

  function sourceRefKey(source: Source, ref: SourceRef | null | undefined): string | null {
    if (!ref) return null
    switch (source) {
      case 'gmail':
        return ref.gmail_thread_id
          ? `gmail:${ref.gmail_thread_id}:${ref.gmail_message_id ?? ''}`
          : null
      case 'granola':
        return ref.granola_meeting_id ? `granola:${ref.granola_meeting_id}` : null
      case 'calendar':
        return ref.google_calendar_event_id ? `calendar:${ref.google_calendar_event_id}` : null
      case 'linear':
        return ref.linear_issue_id ? `linear:${ref.linear_issue_id}` : null
      case 'slack':
        return ref.slack_ts ? `slack:${ref.slack_channel_id ?? ''}:${ref.slack_ts}` : null
      default:
        return null
    }
  }

  const onlySource = process.argv[2] as Source | undefined
  const days = Number(process.argv[3] ?? 7)

  console.log(`\n=== Debug digest run ===`)
  console.log(`user: ${userEmail}`)
  console.log(`days: ${days}`)
  console.log(`source filter: ${onlySource ?? 'all'}\n`)

  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('email', userEmail)
    .single()
  if (!userRow) {
    console.error('user not found in public.users')
    return
  }
  const userId = userRow.id

  const lookbackCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const [openRes, clearedRes] = await Promise.all([
    supabase.from('items').select('*').eq('user_id', userId).in('status', ['open', 'in_progress']),
    supabase
      .from('items')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['completed', 'dismissed', 'snoozed'])
      .gte('updated_at', lookbackCutoff),
  ])
  const currentItems = [
    ...((openRes.data ?? []) as Item[]),
    ...((clearedRes.data ?? []) as Item[]),
  ]
  console.log(
    `current items in DB: ${openRes.data?.length ?? 0} open + ${clearedRes.data?.length ?? 0} cleared (60d)\n`
  )

  const sources: Array<{ name: Source; fn: () => Promise<ExtractedItem[]> }> = [
    { name: 'gmail', fn: () => extractGmailActionItems({ userEmail, days }) },
    { name: 'granola', fn: () => extractGranolaActionItems({ userEmail, days }) },
    { name: 'calendar', fn: () => extractCalendarPrepItems({ userEmail }) },
    { name: 'linear', fn: () => extractLinearActionItems({ userEmail }) },
  ]

  for (const { name, fn } of sources) {
    if (onlySource && onlySource !== name) continue

    console.log(`\n────── ${name.toUpperCase()} ──────`)
    let fresh: ExtractedItem[] = []
    try {
      fresh = await fn()
    } catch (err) {
      console.error(`extractor error:`, err instanceof Error ? err.message : err)
      continue
    }
    console.log(`extractor returned: ${fresh.length} item(s)`)
    for (const it of fresh) {
      const refKey = sourceRefKey(it.source, it.source_ref as SourceRef | null)
      const hash = computeSemanticHash(it.source, it.parent_context, it.title)
      console.log(`  • "${it.title}"`)
      console.log(`      ref_key=${refKey}`)
      console.log(`      hash=${hash}`)
    }

    const result = diffSingleSource(currentItems, fresh, name)
    console.log(`\n  diff:`)
    console.log(`    new (would insert): ${result.newItems.length}`)
    for (const it of result.newItems) {
      console.log(`      + "${it.title}"`)
    }
    console.log(`    carryover: ${result.carryover.length}`)
    for (const { existing } of result.carryover) {
      console.log(`      = "${existing.title}" (id=${existing.id.slice(0, 8)})`)
    }
    console.log(`    suppressed (cleared, skipped): ${result.suppressed.length}`)
    for (const { fresh: f, existing } of result.suppressed) {
      console.log(
        `      x "${f.title}" matched cleared id=${existing.id.slice(0, 8)} (status=${existing.status})`
      )
    }
  }

  console.log(`\n=== done ===\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

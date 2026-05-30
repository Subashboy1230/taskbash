// Emergency restore: undo the wrongful auto-completion that happened
// when the digest ran with the diff still treating "missing from fresh"
// as "user finished it". Sets every items row that the digest auto-
// closed (auto_completed_reason='source_signal_gone') back to open.
//
// Run from project root:
//   npx tsx scripts/restore-auto-completed.ts
//
// Optional flag: --since=2026-05-30T00:00:00Z (default: last 24h)
// to limit the restore window to just the recent wrongful sweep.

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

function parseSinceArg(): string {
  const arg = process.argv.find(a => a.startsWith('--since='))
  if (arg) return arg.slice('--since='.length)
  // Default: last 24h
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

async function main() {
  const since = parseSinceArg()
  console.log(`Restoring tasks auto-completed since ${since}`)

  const { data: rows, error } = await supabase
    .from('items')
    .select('id, user_id, title, source, status, completed_at, auto_completed_reason')
    .eq('status', 'completed')
    .eq('auto_completed_reason', 'source_signal_gone')
    .gte('completed_at', since)
  if (error) {
    console.error('Failed to fetch auto-completed rows:', error.message)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log('No auto-completed rows in that window. Nothing to restore.')
    return
  }
  console.log(`Found ${rows.length} auto-completed row(s) to restore:`)
  for (const r of rows) {
    console.log(`  [${r.source}] ${r.title}`)
  }

  const ids = rows.map(r => r.id)
  const { error: upErr } = await supabase
    .from('items')
    .update({
      status: 'open',
      completed_at: null,
      auto_completed_reason: null,
    })
    .in('id', ids)
  if (upErr) {
    console.error('Failed to restore:', upErr.message)
    process.exit(1)
  }
  console.log(`Restored ${ids.length} task(s) to status=open.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

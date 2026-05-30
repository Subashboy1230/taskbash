// One-off helper to rename Subash's existing function rows to the new
// short canonical names. After this runs the chips on /today will pick
// up the new name-based color overrides in lib/function-color too.
//
// Run from project root:
//   npx tsx scripts/rename-functions.ts
//
// Idempotent: rows that already have the new name are skipped.

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

const RENAMES: Record<string, string> = {
  'Product Management': 'Product',
  'People Ops': 'Ops',
  'Go-to-Market': 'GTM',
  'Go to Market': 'GTM',
  'Marketing': 'GTM',
}

async function main() {
  const { data: rows, error } = await supabase
    .from('user_functions')
    .select('id, user_id, name, color')
  if (error) {
    console.error('Failed to fetch user_functions:', error.message)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log('No user_functions rows. Nothing to rename.')
    return
  }
  let updated = 0
  for (const r of rows) {
    const next = RENAMES[r.name]
    if (!next) continue
    if (next === r.name) continue
    const { error: upErr } = await supabase
      .from('user_functions')
      .update({ name: next })
      .eq('id', r.id)
    if (upErr) {
      console.error(`Failed to rename ${r.name} (${r.id}):`, upErr.message)
      continue
    }
    console.log(`Renamed: "${r.name}" -> "${next}" (user ${r.user_id})`)
    updated++
  }
  console.log(`Done. ${updated} row(s) renamed.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

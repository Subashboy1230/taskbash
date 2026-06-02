// One-time backfill: decode HTML entities (&#39; etc.) in existing item subtitles.
// Run with:
//   cd ~/Desktop/Screenshots/cos-app-v1 && npx tsx scripts/backfill-decode-entities.ts
//
// Only touches source='gmail' items whose subtitle contains HTML entities.
// Safe to re-run (idempotent — decoded text won't match entity patterns).

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

import { decodeEntities } from '../lib/html'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  const ENTITY_RE = /&#\d+;|&[a-z]+;/i

  const { data: items, error } = await supabase
    .from('items')
    .select('id, subtitle')
    .eq('source', 'gmail')
    .not('subtitle', 'is', null)

  if (error) throw error
  if (!items?.length) { console.log('No Gmail items with subtitles found.'); return }

  const toFix = items.filter(i => i.subtitle && ENTITY_RE.test(i.subtitle))
  console.log(`Found ${toFix.length} items with HTML entities (out of ${items.length} Gmail items).`)

  let updated = 0
  for (const item of toFix) {
    const decoded = decodeEntities(item.subtitle!)
    if (decoded === item.subtitle) continue
    const { error: upErr } = await supabase
      .from('items')
      .update({ subtitle: decoded })
      .eq('id', item.id)
    if (upErr) { console.error(`Failed to update ${item.id}:`, upErr); continue }
    updated++
  }

  console.log(`Done. Updated ${updated} items.`)
}

main().catch(err => { console.error(err); process.exit(1) })

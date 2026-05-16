// One-time seed: move the Granola API key from .env.local into the
// connections table in the database, where the new code reads it from.
//
// The Gmail connection row is seeded by migration 003 (its nango_connection_id
// is non-secret, so it lives in the SQL file).
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run seed:connections
//
// After running this AND migration 003 in Supabase, you can remove these
// env vars from .env.local (and from Vercel later):
//   GRANOLA_API_KEY
//   NANGO_GMAIL_PROVIDER_KEY
//   APP_NANGO_GMAIL_CONNECTION_ID
//   NANGO_GRANOLA_PROVIDER_KEY            (was already unused)
//   APP_NANGO_GRANOLA_CONNECTION_ID       (was already unused)

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const USER_ID = process.env.APP_USER_ID
  const GRANOLA_API_KEY = process.env.GRANOLA_API_KEY
  if (!USER_ID) {
    console.error('APP_USER_ID is not set in .env.local')
    process.exit(1)
  }
  if (!GRANOLA_API_KEY) {
    console.error(
      'GRANOLA_API_KEY is not set in .env.local — nothing to seed for Granola.'
    )
    process.exit(1)
  }

  const { upsertConnection, getActiveConnection } = await import(
    '../lib/connections'
  )

  // Granola — seed the API key.
  const existing = await getActiveConnection('granola')
  if (existing?.api_key === GRANOLA_API_KEY) {
    console.log('✓ Granola connection already seeded with the same API key.')
  } else {
    const conn = await upsertConnection({
      provider: 'granola',
      api_key: GRANOLA_API_KEY,
    })
    console.log(`✓ Granola connection seeded (id: ${conn.id})`)
  }

  // Sanity check: Gmail connection should already exist from migration 003.
  const gmail = await getActiveConnection('gmail')
  if (gmail) {
    console.log(
      `✓ Gmail connection found (nango_connection_id: ${gmail.nango_connection_id})`
    )
  } else {
    console.log(
      '⚠ Gmail connection not found. Did you run migration 003 in Supabase?'
    )
  }

  console.log(
    '\nDone. You can now remove GRANOLA_API_KEY and the NANGO_*_GMAIL_* env vars from .env.local.'
  )
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

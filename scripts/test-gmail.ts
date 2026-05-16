// Quick test: run the Gmail extractor and print what it finds — WITHOUT
// touching the database. Use this to verify the full path works end-to-end
// (Nango auth → Gmail API → Claude extraction → parsed items) before deploying.
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run test:gmail

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  // Check env vars. Gmail credentials now live in the DB (connections table)
  // instead of env vars — only NANGO_SECRET_KEY and ANTHROPIC_API_KEY are needed
  // at the process level.
  const required = ['NANGO_SECRET_KEY', 'APP_USER_ID', 'ANTHROPIC_API_KEY']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('Missing env vars in .env.local:', missing.join(', '))
    process.exit(1)
  }

  // Dynamic import AFTER dotenv loads — lib/nango.ts validates env at module load.
  const { extractGmailActionItems } = await import('../lib/extract/gmail')

  const userEmail = 'subashraj411@gmail.com'
  const days = 3
  console.log(`Scanning the last ${days} days of inbox for ${userEmail}...\n`)

  const items = await extractGmailActionItems({ userEmail, days })

  if (items.length === 0) {
    console.log('No action items found.')
    console.log('That can be correct (a quiet few days) — or the window is too tight.')
    console.log('If you expected items, bump `days` in this script and re-run.')
    return
  }

  console.log(`Found ${items.length} action item(s):\n`)
  for (const item of items) {
    const due = item.due_at
      ? new Date(item.due_at).toLocaleDateString()
      : 'no deadline'
    const urgent = item.urgent ? ' [URGENT]' : ''
    console.log(`  • ${item.title}${urgent}`)
    console.log(`    from:  ${item.parent_context}`)
    console.log(`    tag:   ${item.tag ?? 'none'}   due: ${due}`)
    for (const sub of item.sub_items ?? []) {
      console.log(`      - ${sub.title}`)
    }
    console.log('')
  }
  console.log('Gmail extraction path works end-to-end.')
}

main().catch(err => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)

  // Dig into the underlying HTTP error so we can tell WHO returned the 404:
  // Nango (connection/integration not found — usually an env mismatch) vs
  // Google (the Gmail API path is wrong).
  const e = err as {
    response?: { status?: number; data?: unknown }
    status?: number
    config?: { url?: string; baseURL?: string }
  }
  console.error('\n--- error detail ---')
  console.error('status:', e?.response?.status ?? e?.status ?? '(none)')
  console.error('request url:', e?.config?.baseURL ?? '', e?.config?.url ?? '(none)')
  console.error(
    'response body:',
    JSON.stringify(e?.response?.data ?? null, null, 2)
  )
  console.error('error keys:', Object.keys((err as object) ?? {}).join(', '))
  process.exit(1)
})

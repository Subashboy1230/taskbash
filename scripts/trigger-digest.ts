// Trigger the morning digest immediately — same code path as the 7am PT cron,
// but on-demand. Useful for testing changes without waiting for the next run.
//
// Sends a `digest/requested` event to Inngest, which causes morning-digest.ts
// to run: extract from all connected sources → diff against open items →
// persist new/carryover/completed → log to agent_events.
//
// Run with:
//   cd ~/Desktop/ToDoo/cos-app-v1 && npm run digest

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const required = ['INNGEST_EVENT_KEY', 'APP_USER_ID']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('Missing env vars in .env.local:', missing.join(', '))
    process.exit(1)
  }

  const { inngest, EVENTS } = await import('../inngest/client')

  console.log('Sending digest/requested event to Inngest...')
  const result = await inngest.send({
    name: EVENTS.digestRequested,
    data: { triggeredBy: 'manual-script', at: new Date().toISOString() },
  })

  console.log('Event sent. Inngest IDs:', result.ids)
  console.log('\nWatch it run at: https://app.inngest.com/env/production/runs')
  console.log('Then visit /today to see new items: http://localhost:3000/today')
  console.log('\n(Takes ~10-60s — Calendar prep-brief generation is the slow step.)')
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

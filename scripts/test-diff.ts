// Manual trigger for the morning digest. Run via:
//   npm run test:diff
//
// This sends an Inngest event that the morningDigest function listens for.
// Make sure the Inngest dev server is running (npm run inngest) and the
// Next.js dev server is up (npm run dev) before running this.

import { inngest, EVENTS } from '../inngest/client'

async function main() {
  if (!process.env.INNGEST_EVENT_KEY) {
    // Local dev: Inngest CLI proxies without a real event key.
    // In production this would fail; here it's fine.
    console.log('Note: INNGEST_EVENT_KEY not set — assuming local dev')
  }

  const result = await inngest.send({
    name: EVENTS.digestRequested,
    data: { source: 'test-script', requested_at: new Date().toISOString() },
  })

  console.log('✓ Event sent. Watch the Inngest dev UI at http://localhost:8288')
  console.log('  Event IDs:', result.ids)
}

main().catch(err => {
  console.error('✗ Failed to send event:', err)
  process.exit(1)
})

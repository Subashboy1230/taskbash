import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { runDigestForUser } = await import('../lib/digest/run')

  console.log('Running digest for d470e729...')
  const result = await runDigestForUser({
    userId: 'd470e729-29eb-41bb-8785-9dddedbe8597',
    userEmail: 'subash@sigiq.ai',
    trigger: 'manual',
  })
  console.log('Result:', JSON.stringify(result, null, 2))
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })

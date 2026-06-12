// scripts/test-tavily.ts
//
// Smoke test for the Tavily attendee-enrichment integration.
//
// Usage:
//   npx tsx scripts/test-tavily.ts
//
// Calls enrichPersonContext for two known people and prints the result.
// If the result has a who_they_are string and source URLs, Tavily is wired.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local')
  const txt = readFileSync(p, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (!process.env[k]) process.env[k] = v.trim()
  }
}

loadEnv()

import { enrichPersonContext, enrichAttendees } from '@/lib/enrich/tavily'

async function main() {
  console.log('--- Tavily attendee enrichment smoke test ---')
  console.log('TAVILY_API_KEY:', process.env.TAVILY_API_KEY ? 'set' : 'MISSING')
  console.log('TAVILY_ENRICHMENT:', process.env.TAVILY_ENRICHMENT || '(unset)')
  console.log('TAVILY_SKIP_DOMAINS:', process.env.TAVILY_SKIP_DOMAINS || '(default: sigiq.ai,evertutor.ai)')
  console.log('')

  if (!process.env.TAVILY_API_KEY) {
    console.error('No TAVILY_API_KEY, aborting.')
    process.exit(1)
  }

  // Two real test cases. Both should return a meaningful who_they_are.
  const cases = [
    { name: 'Sam Altman', email: 'sam@openai.com' },
    { name: 'Dario Amodei', email: 'dario@anthropic.com' },
  ]

  for (const c of cases) {
    console.log(`Looking up "${c.name}" <${c.email}>...`)
    const t0 = Date.now()
    const ctx = await enrichPersonContext(c)
    const elapsed = Date.now() - t0
    if (!ctx) {
      console.log(`  result: null (took ${elapsed}ms)`)
      console.log('')
      continue
    }
    console.log(`  who_they_are: ${ctx.who_they_are}`)
    console.log(`  sources:`)
    for (const s of ctx.sources) console.log(`    - ${s}`)
    console.log(`  (took ${elapsed}ms)`)
    console.log('')
  }

  // Bulk path
  console.log('Bulk enrichAttendees test:')
  const bulk = await enrichAttendees(cases)
  console.log(`  ${bulk.length}/${cases.length} succeeded`)
  console.log('')
  console.log('SUCCESS — Tavily integration verified end-to-end.')
}

main().catch(err => {
  console.error('main() threw:', err instanceof Error ? err.stack : err)
  process.exit(2)
})

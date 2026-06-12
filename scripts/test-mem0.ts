// scripts/test-mem0.ts
//
// End-to-end smoke test for mem0:
//   1. Records a synthetic slop feedback memory
//   2. Queries mem0 with a relevant question
//   3. Renders the prompt block we'd inject into classify.functions
//
// Run:
//   npx tsx scripts/test-mem0.ts
//
// Expected: a returned memory with score > 0 and a non-empty prompt
// block. If the search returns empty immediately, mem0 may still be
// indexing — re-run after a few seconds.

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

async function main() {
  loadEnv()

  console.log('--- mem0 smoke test ---')
  console.log('MEM0_API_KEY:', process.env.MEM0_API_KEY ? 'set' : 'MISSING')
  console.log('APP_USER_ID:', process.env.APP_USER_ID ?? '(unset, will use tb-default)')
  console.log('')

  if (!process.env.MEM0_API_KEY) {
    console.error('No MEM0_API_KEY, aborting. Get one at mem0.ai.')
    process.exit(1)
  }

  const { mem0Configured } = await import('@/lib/memory/mem0')
  const { recordFeedbackMemory } = await import('@/lib/memory/record')
  const { fetchRelevantMemories, renderMemoriesForPrompt } = await import(
    '@/lib/memory/fetch'
  )

  console.log('mem0Configured():', mem0Configured())
  console.log('')

  const userId = process.env.APP_USER_ID ?? null

  console.log('Step 1: record a synthetic slop feedback memory...')
  const t0 = Date.now()
  await recordFeedbackMemory({
    userId,
    kind: 'slop',
    reason: 'irrelevant',
    note: 'Cold VC outreach asking for a 15-min meeting. Never actionable for me.',
    itemTitle: 'Reply to Jane from VeeCee Capital re: meeting next week',
    itemSource: 'gmail',
    itemContext: 'From: jane@veeceecapital.com — Subject: 15 min next week?',
  })
  console.log(`  recorded in ${Date.now() - t0}ms`)
  console.log('')

  console.log('Step 2: wait briefly for mem0 to index (it auto-distills facts)...')
  await new Promise(r => setTimeout(r, 3000))

  console.log('Step 3: search mem0 with a relevant classify-time query...')
  const memories = await fetchRelevantMemories({
    userId,
    query: 'Classify these tasks: Reply to investor pitch email | Schedule intro call with new VC',
    limit: 5,
  })
  console.log(`  found ${memories.length} memories`)
  for (const m of memories) {
    console.log(`  - score=${m.score.toFixed(2)} memory="${m.memory}"`)
  }
  console.log('')

  console.log('Step 4: render the prompt block we would inject...')
  const block = renderMemoriesForPrompt(memories)
  console.log(block || '(empty — no memories yet, try re-running in a moment)')
  console.log('')

  if (memories.length > 0) {
    console.log('SUCCESS — mem0 integration verified end-to-end.')
  } else {
    console.log(
      'PARTIAL — recording succeeded but search returned empty. mem0 may still be indexing. Re-run in 10–30s.'
    )
  }
}

main().catch(err => {
  console.error('main() threw:', err instanceof Error ? err.stack : err)
  process.exit(99)
})

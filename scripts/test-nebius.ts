// scripts/test-nebius.ts
//
// Smoke test for the Nebius Token Factory classifier integration.
//
// Usage:
//   npx tsx scripts/test-nebius.ts
//
// Calls nebiusTracedMessage with a tiny prompt, then checks Supabase's
// llm_calls table for the matching row (system='nebius'). If both land,
// Nebius is fully wired and CLASSIFY_PROVIDER=nebius will route real
// classifier calls through it during digests.
//
// NOTE: top-level `import` statements get hoisted above `loadEnv()` so
// lib/supabase.ts (which throws on missing env at module load) blows up.
// We use dynamic imports below so env is loaded first.

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

  console.log('--- Nebius Token Factory smoke test ---')
  console.log('NEBIUS_API_KEY:', process.env.NEBIUS_API_KEY ? 'set' : 'MISSING')
  console.log('CLASSIFY_PROVIDER:', process.env.CLASSIFY_PROVIDER || '(unset)')
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'set' : 'MISSING')
  console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING')
  console.log('')

  if (!process.env.NEBIUS_API_KEY) {
    console.error('No NEBIUS_API_KEY, aborting.')
    process.exit(1)
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase env not set; needed for llm_calls verification.')
    process.exit(1)
  }

  const { nebiusTracedMessage } = await import('@/lib/nebius-trace')
  const { supabase } = await import('@/lib/supabase')

  console.log('Calling nebiusTracedMessage with a tiny classification prompt...')
  const t0 = Date.now()
  const res = await nebiusTracedMessage(
    {
      prompt_id: 'smoke.nebius',
      prompt_version: 1,
      user_id: process.env.APP_USER_ID ?? null,
      input_content: { test: 'nebius smoke' },
    },
    {
      max_tokens: 256,
      system:
        'You are a helpful assistant. Reply with strict JSON only, no prose, no markdown.',
      messages: [
        {
          role: 'user',
          content:
            'Classify this task into exactly one of: ["product", "hiring", "ops"]. Task: "Review the Q4 hiring funnel and approve new req for ML eng." Return {"label": "..."}.',
        },
      ],
    }
  )
  const elapsed = Date.now() - t0

  const text = res.content[0]?.text ?? ''
  console.log('')
  console.log('Response text:', text)
  console.log('llmCallId:', res._llmCallId)
  console.log(`Took: ${elapsed}ms`)
  console.log('')

  // Brief pause so the fire-and-forget insert lands.
  await new Promise(r => setTimeout(r, 1500))

  console.log('Checking llm_calls table for the row...')
  const { data, error } = await supabase
    .from('llm_calls')
    .select('id, system, request_model, prompt_id, prompt_version, error, started_at, input_tokens, output_tokens, cost_usd')
    .eq('id', res._llmCallId)
    .maybeSingle()

  if (error) {
    console.error('Supabase lookup failed:', error.message)
    process.exit(2)
  }
  if (!data) {
    console.error('NO ROW found for id', res._llmCallId)
    console.error('  Fire-and-forget insert may have failed silently. Check Sentry / Supabase logs.')
    process.exit(2)
  }
  console.log('llm_calls row:')
  console.log(JSON.stringify(data, null, 2))
  console.log('')
  if (data.system === 'nebius') {
    console.log('SUCCESS — Nebius integration verified end-to-end (call returned + traced).')
  } else {
    console.error(`Unexpected system='${data.system}' on the inserted row (expected 'nebius').`)
    process.exit(3)
  }
}

main().catch(err => {
  console.error('main() threw:', err instanceof Error ? err.stack : err)
  process.exit(99)
})

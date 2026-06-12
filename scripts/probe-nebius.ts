// Quick probe: try both Nebius base URLs and list available models so we
// can pick a real model slug + base URL.

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

const BASES = [
  'https://api.studio.nebius.com/v1',
  'https://api.studio.nebius.ai/v1',
]

async function probe(base: string) {
  const apiKey = process.env.NEBIUS_API_KEY!
  console.log(`\n=== ${base} ===`)
  // List models
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    console.log(`  GET /models -> ${res.status}`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log('  body:', body.slice(0, 300))
      return false
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    const models = (data.data || []).map(m => m.id)
    console.log(`  ${models.length} models. Llama / Qwen variants:`)
    for (const m of models.filter(x => /llama|qwen/i.test(x)).slice(0, 15)) {
      console.log(`    - ${m}`)
    }
    return true
  } catch (err) {
    console.log('  THREW:', err instanceof Error ? err.message : err)
    return false
  }
}

async function main() {
  console.log('NEBIUS_API_KEY:', process.env.NEBIUS_API_KEY ? 'set' : 'MISSING')
  for (const b of BASES) await probe(b)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

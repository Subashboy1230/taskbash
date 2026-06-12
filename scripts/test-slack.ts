// scripts/test-slack.ts
//
// End-to-end smoke test for the Composio v3 Slack integration.
// Bypasses the digest pipeline so we can verify the SDK call works.
//
// Usage:
//   npx tsx scripts/test-slack.ts
//
// What it does:
//   1. Loads .env.local
//   2. Lists connected accounts for COMPOSIO_ENTITY_ID, finds the Slack one
//   3. Calls SLACK_FIND_CHANNELS to list channels you're in
//   4. Calls SLACK_FETCH_CONVERSATION_HISTORY on the first channel
//   5. Prints the message shape so we know what to map to ExtractedItem

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

import { composioExecuteTool, composioSlackConfigured } from '@/lib/connectors/composio'

function dump(label: string, v: unknown, max = 2000) {
  console.log(`  ${label}:`, JSON.stringify(v, null, 2).slice(0, max))
}

async function main() {
  console.log('--- Composio Slack v3 smoke test ---')
  console.log('COMPOSIO_API_KEY:', process.env.COMPOSIO_API_KEY ? 'set' : 'MISSING')
  console.log('COMPOSIO_ENTITY_ID:', process.env.COMPOSIO_ENTITY_ID || 'MISSING')
  console.log('COMPOSIO_SLACK_CONNECTION_ID (env):', process.env.COMPOSIO_SLACK_CONNECTION_ID || 'MISSING')
  console.log('COMPOSIO_SLACK_USER_HANDLE:', process.env.COMPOSIO_SLACK_USER_HANDLE || 'MISSING')
  console.log('composioSlackConfigured():', composioSlackConfigured())
  console.log('')

  if (!composioSlackConfigured()) {
    console.error('Configuration incomplete; aborting.')
    process.exit(1)
  }

  // Step 0: confirm the connection exists.
  const { Composio } = await import('@composio/core')
  const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! })
  const entityId = process.env.COMPOSIO_ENTITY_ID as string
  console.log('--- Step 0: confirm Slack connection is ACTIVE ---')
  try {
    const list = await c.connectedAccounts.list({ userIds: [entityId] } as Parameters<typeof c.connectedAccounts.list>[0])
    const items = (list as { items?: Array<Record<string, unknown>> }).items || []
    const slack = items.find(a => {
      const slug = (a.toolkit as { slug?: string } | undefined)?.slug || ''
      return /slack/i.test(String(slug))
    })
    if (!slack) {
      console.error('Still no Slack connected account. Re-run composio-init-slack.ts.')
      process.exit(1)
    }
    console.log(`  Slack account id=${slack.id} status=${slack.status}`)
    console.log('')
  } catch (err) {
    console.error('list failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  const connectionId = process.env.COMPOSIO_SLACK_CONNECTION_ID as string

  // Step 1: list channels.
  console.log('--- Step 1: SLACK_FIND_CHANNELS (list channels) ---')
  let firstChannelId: string | null = null
  try {
    const res = await composioExecuteTool({
      tool: 'SLACK_FIND_CHANNELS',
      params: { limit: 10, exclude_archived: true } as Record<string, unknown>,
      connectedAccountId: connectionId,
    })
    console.log('  successful:', res.successful)
    console.log('  error:', res.error)
    const data = res.data as Record<string, unknown> | undefined
    console.log('  data keys:', data ? Object.keys(data) : 'no data')
    // Common Slack shapes: { channels: [...] } or { items: [...] }.
    const channels = (data?.channels || data?.items || []) as Array<{ id?: string; name?: string }>
    console.log(`  Got ${channels.length} channel(s). First 5:`)
    for (const ch of channels.slice(0, 5)) {
      console.log(`    - id=${ch.id} name=${ch.name}`)
    }
    if (channels[0]?.id) firstChannelId = String(channels[0].id)
    console.log('')
  } catch (err) {
    console.error('SLACK_FIND_CHANNELS threw:')
    unwrap(err)
    process.exit(2)
  }

  if (!firstChannelId) {
    console.error('No channels available, cannot test history fetch.')
    process.exit(2)
  }

  // Step 2: fetch conversation history.
  console.log(`--- Step 2: SLACK_FETCH_CONVERSATION_HISTORY (channel ${firstChannelId}) ---`)
  try {
    const res = await composioExecuteTool({
      tool: 'SLACK_FETCH_CONVERSATION_HISTORY',
      params: { channel: firstChannelId, limit: 5 } as Record<string, unknown>,
      connectedAccountId: connectionId,
    })
    console.log('  successful:', res.successful)
    console.log('  error:', res.error)
    const data = res.data as Record<string, unknown> | undefined
    console.log('  data keys:', data ? Object.keys(data) : 'no data')
    const messages = (data?.messages || []) as Array<Record<string, unknown>>
    console.log(`  Got ${messages.length} message(s). First 3 (truncated):`)
    for (const m of messages.slice(0, 3)) {
      dump('    msg', { ts: m.ts, user: m.user, text: (m.text as string || '').slice(0, 200) }, 400)
    }
    console.log('')
    console.log('SUCCESS — Composio Slack v3 integration verified end-to-end.')
  } catch (err) {
    console.error('SLACK_FETCH_CONVERSATION_HISTORY threw:')
    unwrap(err)
    process.exit(3)
  }
}

function unwrap(err: unknown) {
  console.error('  message:', err instanceof Error ? err.message : String(err))
  const anyErr = err as { cause?: { message?: string; error?: unknown }; error?: unknown }
  if (anyErr.cause) {
    console.error('  cause.message:', anyErr.cause.message)
    if (anyErr.cause.error) console.error('  cause.error:', JSON.stringify(anyErr.cause.error, null, 2).slice(0, 1500))
  }
}

main().catch(err => {
  console.error('main() threw:', err)
  process.exit(99)
})

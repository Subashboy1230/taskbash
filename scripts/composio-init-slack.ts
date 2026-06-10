#!/usr/bin/env node
/**
 * scripts/composio-init-slack.ts
 *
 * One-off script: kick off Composio's hosted Slack OAuth flow for your
 * entity, then print the redirect URL and the resulting connection id
 * so you can paste them into .env.local.
 *
 * Run:
 *   npx tsx scripts/composio-init-slack.ts
 *
 * Prereqs:
 *   - .env.local has COMPOSIO_API_KEY set (from app.composio.dev)
 *   - .env.local has COMPOSIO_ENTITY_ID set (defaults to 'subash')
 *   - You have Slack added as an integration in your Composio dashboard
 *
 * Output:
 *   1. Composio's redirect URL — open this in your browser
 *   2. Authorize Slack in the popup that opens
 *   3. The connection id printed here goes into .env.local as
 *      COMPOSIO_SLACK_CONNECTION_ID
 *   4. Add your Slack handle (no @) as COMPOSIO_SLACK_USER_HANDLE
 *   5. Trigger a digest; Slack items now appear on /today
 *
 * If anything fails the script prints the raw Composio error so you
 * can paste it into chat for help.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), '.env.local')
  let content: string
  try {
    content = readFileSync(envPath, 'utf8')
  } catch {
    console.error(`Could not read ${envPath}. Run this from the repo root.`)
    process.exit(1)
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const eq = trimmed.indexOf('=')
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (k && !(k in process.env)) process.env[k] = v
  }
}

async function main(): Promise<void> {
  loadEnvLocal()

  const apiKey = process.env.COMPOSIO_API_KEY
  if (!apiKey) {
    console.error('\nCOMPOSIO_API_KEY is missing in .env.local.')
    console.error('Sign up at https://app.composio.dev to get one.\n')
    process.exit(1)
  }

  const entityId = process.env.COMPOSIO_ENTITY_ID || 'subash'
  const base = process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev'

  console.log('')
  console.log('═══════════════════════════════════════════════')
  console.log(' Composio Slack OAuth initiator')
  console.log('═══════════════════════════════════════════════')
  console.log(` Entity:    ${entityId}`)
  console.log(` Base URL:  ${base}`)
  console.log('')

  const url = `${base}/api/v1/connections/initiate`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      integrationId: 'slack',
      entityId,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`\nComposio returned HTTP ${res.status}.`)
    console.error('Response body:')
    console.error(text || '(empty)')
    console.error('')
    console.error('Most common causes:')
    console.error('  - API key invalid or revoked')
    console.error("  - Slack integration not enabled on your Composio project")
    console.error('  - Entity id does not exist (create it in Composio dashboard)')
    process.exit(2)
  }

  const body = (await res.json()) as {
    redirectUrl?: string
    connectionId?: string
    connectionStatus?: string
  }

  if (!body.redirectUrl || !body.connectionId) {
    console.error('\nComposio response missing expected fields:')
    console.error(JSON.stringify(body, null, 2))
    process.exit(3)
  }

  console.log(' STEP 1 — open this URL in your browser:')
  console.log('')
  console.log(`   ${body.redirectUrl}`)
  console.log('')
  console.log(' STEP 2 — authorize Slack when Composio asks.')
  console.log('')
  console.log(' STEP 3 — paste this into .env.local:')
  console.log('')
  console.log(`   COMPOSIO_SLACK_CONNECTION_ID=${body.connectionId}`)
  console.log('')
  console.log(' STEP 4 — also paste your Slack @-handle (no @):')
  console.log('')
  console.log('   COMPOSIO_SLACK_USER_HANDLE=<your_slack_handle>')
  console.log('')
  console.log(' STEP 5 — trigger a digest (Re-run tasks on /today).')
  console.log(' Slack items appear under source=slack.')
  console.log('')
  console.log('═══════════════════════════════════════════════')
  console.log('')
}

main().catch(err => {
  console.error('\nUnhandled error:')
  console.error(err instanceof Error ? err.message : err)
  process.exit(99)
})

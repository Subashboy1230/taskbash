#!/usr/bin/env node
/**
 * scripts/composio-init-slack.ts
 *
 * Composio v3 — create a Connected Account for the Slack toolkit by
 * generating a Connect Link, waiting for the user to authorize, and
 * printing the resulting ca_xxx so it can be pasted into .env.local.
 *
 * Run:
 *   npx tsx scripts/composio-init-slack.ts
 *
 * Prereqs:
 *   - .env.local has COMPOSIO_API_KEY set
 *   - .env.local has COMPOSIO_ENTITY_ID set (the user handle on Composio,
 *     e.g. "subash")
 *   - dashboard.composio.dev has a Slack Auth Config created and Enabled
 *
 * Output:
 *   1. Discovers the Slack Auth Config in your Composio project
 *   2. Generates a Connect Link
 *   3. Prints the URL — open it, complete Slack OAuth
 *   4. Polls Composio until status=ACTIVE, then prints ca_xxx
 *   5. You paste ca_xxx into .env.local as COMPOSIO_SLACK_CONNECTION_ID
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
    console.error('\nCOMPOSIO_API_KEY missing in .env.local. Get one at dashboard.composio.dev.\n')
    process.exit(1)
  }
  const userId = process.env.COMPOSIO_ENTITY_ID || 'subash'

  console.log('')
  console.log('=== Composio v3 Slack connector init ===')
  console.log(`User ID (entity): ${userId}`)
  console.log('')

  const { Composio } = await import('@composio/core')
  const c = new Composio({ apiKey })

  // Step 1: find the Slack Auth Config.
  let authConfigId = process.env.COMPOSIO_SLACK_AUTH_CONFIG_ID
  if (!authConfigId) {
    console.log('Looking up your Slack Auth Config...')
    const list = await c.authConfigs.list({} as Parameters<typeof c.authConfigs.list>[0])
    const items = (list as { items?: Array<Record<string, unknown>> }).items || []
    console.log(`Found ${items.length} auth config(s) total. Filtering for Slack...`)
    for (const cfg of items) {
      const toolkit = (cfg.toolkit as { slug?: string } | undefined)?.slug
      const slug = (cfg.slug as string) || ''
      console.log(`  - id=${cfg.id} toolkit=${toolkit || slug} status=${cfg.status} name=${cfg.name}`)
    }
    const slack = items.find(cfg => {
      const tk = (cfg.toolkit as { slug?: string } | undefined)?.slug || ''
      const slug = (cfg.slug as string) || ''
      return /slack/i.test(String(tk)) || /slack/i.test(String(slug))
    })
    if (!slack) {
      console.error('\nNO SLACK AUTH CONFIG FOUND in your Composio project.')
      console.error('Go to dashboard.composio.dev > Auth Configs > New > pick Slack > Composio Managed > Save.')
      process.exit(2)
    }
    authConfigId = String(slack.id)
    console.log(`Using Auth Config: ${authConfigId} (${slack.name})`)
  } else {
    console.log(`Using Auth Config from env: ${authConfigId}`)
  }
  console.log('')

  // Step 2: create the Connect Link.
  console.log('Creating Connect Link...')
  const connReq = await c.connectedAccounts.link(userId, authConfigId)
  const redirectUrl = (connReq as { redirectUrl?: string }).redirectUrl
  const connectionId = (connReq as { id?: string }).id
  if (!redirectUrl || !connectionId) {
    console.error('Composio did not return redirectUrl + id. Raw response:')
    console.error(JSON.stringify(connReq, null, 2))
    process.exit(3)
  }

  console.log('')
  console.log('============================================================')
  console.log('STEP 1 — OPEN THIS URL IN YOUR BROWSER NOW:')
  console.log('')
  console.log(`   ${redirectUrl}`)
  console.log('')
  console.log('STEP 2 — pick the Slack workspace and click Allow.')
  console.log('STEP 3 — come back here. The script is polling Composio.')
  console.log('============================================================')
  console.log('')

  // Step 3: wait for ACTIVE.
  try {
    console.log('Polling for ACTIVE status (timeout: 5 min)...')
    const account = await c.connectedAccounts.waitForConnection(connectionId, 5 * 60 * 1000)
    const id = (account as { id?: string }).id
    const status = (account as { status?: string }).status
    console.log('')
    console.log('SUCCESS!')
    console.log(`  Connected Account ID: ${id}`)
    console.log(`  Status: ${status}`)
    console.log('')
    console.log('Paste this into .env.local (replacing the old value):')
    console.log('')
    console.log(`   COMPOSIO_SLACK_CONNECTION_ID=${id}`)
    console.log('')
    console.log('Then re-run: npx tsx scripts/test-slack.ts')
    console.log('')
  } catch (err) {
    console.error('Polling failed:', err instanceof Error ? err.message : err)
    console.error('')
    console.error('Connection request id (you can check status manually in the dashboard):')
    console.error(`  ${connectionId}`)
    process.exit(4)
  }
}

main().catch(err => {
  console.error('\nUnhandled:')
  console.error(err instanceof Error ? err.stack : err)
  process.exit(99)
})

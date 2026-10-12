// Backfill real Gmail drafts for existing open reply items.
//
// Context: the extractor's prompt v4 was dropping `draft_confidence` on
// most reply items (the example output didn't model the field, so Opus
// mirrored the example). The LLM wrote lovely reply bodies and persisted
// them to `items.proposed_action.body`, but `shouldAutoDraft` kept
// returning false, so `createGmailDraft` was never called — the user's
// Gmail Drafts folder stayed empty.
//
// Prompt v5 fixes new runs. This script fixes the backlog: for every
// open reply item that already has a body but no gmail_draft_id, pull
// the Gmail thread, build the References chain, create a real Gmail
// draft, and persist the draft_id back to proposed_action.
//
// Run:
//   npx tsx scripts/backfill-gmail-drafts.ts            # dry run
//   npx tsx scripts/backfill-gmail-drafts.ts --write    # actually create drafts

import { supabase } from '../lib/supabase'
import { createGmailDraft } from '../lib/gmail/drafts'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../lib/connections'
import { nangoProxy } from '../lib/nango'

const WRITE = process.argv.includes('--write')
const USER_ID = process.env.APP_USER_ID
if (!USER_ID) throw new Error('Set APP_USER_ID in env')

interface GmailHeader { name: string; value: string }
interface GmailMessage {
  id: string
  threadId: string
  payload?: { headers?: GmailHeader[] }
}
interface GmailThreadDetail { id: string; messages?: GmailMessage[] }

function headerValue(msg: GmailMessage | undefined, name: string): string | null {
  const h = msg?.payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  )
  return h?.value ?? null
}

async function main() {
  console.log(WRITE ? 'MODE: WRITE (will create real Gmail drafts)' : 'MODE: DRY RUN')

  // 1. Pull open reply items with a body but no gmail_draft_id
  const { data: items, error } = await supabase
    .from('items')
    .select('id, title, source_ref, proposed_action, gmail_draft_id')
    .eq('user_id', USER_ID)
    .eq('status', 'open')
    .eq('tag', 'reply')
    .eq('source', 'gmail')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const candidates = (items ?? []).filter((it) => {
    const pa = it.proposed_action as { body?: string; gmail_draft_id?: string } | null
    const draftId = pa?.gmail_draft_id ?? it.gmail_draft_id
    return pa?.body && !draftId
  })

  console.log(`found ${candidates.length} open reply items missing a gmail draft`)

  // 2. Need Gmail connection for thread fetches
  const conn = await getActiveConnection('gmail', USER_ID)
  if (!conn?.nango_connection_id) throw new Error('Gmail not connected for this user')
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
  const connectionId = conn.nango_connection_id

  // 3. Fetch user profile to get fromEmail
  const profile = await nangoProxy<{ emailAddress: string }>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: '/gmail/v1/users/me/profile',
  })
  const fromEmail = profile.emailAddress
  console.log(`gmail fromEmail: ${fromEmail}`)

  let created = 0
  let skipped = 0
  let failed = 0

  for (const item of candidates) {
    const sr = (item.source_ref ?? {}) as { gmail_thread_id?: string; gmail_message_id?: string }
    const pa = item.proposed_action as {
      body?: string
      subject?: string
      to?: string[]
      cc?: string[]
      references?: string[]
      in_reply_to_message_id?: string
    }
    const threadId = sr.gmail_thread_id
    if (!threadId || !pa.body || !pa.subject || !pa.to?.length) {
      console.log(`  SKIP ${item.id.slice(0, 8)} — missing thread/body/subject/to`)
      skipped++
      continue
    }

    // Fetch full thread to pull the latest Message-ID + References
    let thread: GmailThreadDetail
    try {
      thread = await nangoProxy<GmailThreadDetail>({
        providerConfigKey,
        connectionId,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  FAIL ${item.id.slice(0, 8)} — fetch thread: ${msg.slice(0, 100)}`)
      failed++
      continue
    }

    const messages = thread.messages ?? []
    const latest = messages[messages.length - 1]
    const latestMessageId =
      headerValue(latest, 'Message-ID') ?? pa.in_reply_to_message_id ?? latest?.id ?? ''
    const refsHeader = headerValue(latest, 'References') ?? ''
    const references = refsHeader
      .split(/\s+/)
      .map((r) => r.replace(/[<>]/g, '').trim())
      .filter(Boolean)
    const cleanLatest = latestMessageId.replace(/[<>]/g, '')
    if (cleanLatest && !references.includes(cleanLatest)) references.push(cleanLatest)

    console.log(
      `  ${item.id.slice(0, 8)} thread=${threadId.slice(0, 12)} ` +
        `inReplyTo=${cleanLatest.slice(0, 24)} refs=${references.length}`
    )
    console.log(`    title: ${item.title.slice(0, 60)}`)

    if (!WRITE) {
      skipped++
      continue
    }

    try {
      const { draftId } = await createGmailDraft({
        fromEmail,
        threadId,
        inReplyTo: cleanLatest,
        references,
        to: pa.to,
        cc: pa.cc ?? [],
        subject: pa.subject,
        body: pa.body,
      })
      await supabase
        .from('items')
        .update({ proposed_action: { ...pa, gmail_draft_id: draftId, references } })
        .eq('id', item.id)
        .eq('user_id', USER_ID)
      console.log(`    ✓ created draft ${draftId}`)
      created++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`    ✗ createGmailDraft failed: ${msg.slice(0, 120)}`)
      failed++
    }
  }

  console.log(
    `\ndone. candidates=${candidates.length} created=${created} skipped=${skipped} failed=${failed}`
  )
  if (!WRITE) console.log('(dry run — re-run with --write to actually create drafts)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

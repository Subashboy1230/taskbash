// Voice analyzer -- reads the user's recent SENT emails via Gmail and asks
// Claude to write a markdown profile of how the user communicates: tone,
// formatting habits, common openings/closings, working preferences.
//
// The resulting profile is stored on users.communication_style and used as
// the system prompt anywhere the agent drafts on the user's behalf
// (lib/draft/reply.ts today; brief generation later).
//
// Run with:
//   cd ~/Desktop/cos-app-v1 && npm run analyze:voice
//
// One-shot for now. Long-term this becomes a nightly workflow.

import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(process.cwd(), '.env.local') })

const MAX_SENT_THREADS = 50
const MAX_CHARS_PER_MESSAGE = 2000

async function main() {
  const required = ['NANGO_SECRET_KEY', 'APP_USER_ID', 'ANTHROPIC_API_KEY']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('Missing env vars in .env.local:', missing.join(', '))
    process.exit(1)
  }

  const { anthropic, MODELS } = await import('../lib/anthropic')
  const { nangoProxy } = await import('../lib/nango')
  const { getActiveConnection, NANGO_PROVIDER_KEY } = await import('../lib/connections')
  const { supabase } = await import('../lib/supabase')

  const conn = await getActiveConnection('gmail')
  if (!conn || !conn.nango_connection_id) {
    console.error('Gmail not connected. Visit /connections to set it up.')
    process.exit(1)
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
  const connectionId = conn.nango_connection_id

  console.log(`Reading last ${MAX_SENT_THREADS} sent emails...`)

  const list = await nangoProxy<{
    messages?: Array<{ id: string; threadId: string }>
  }>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: '/gmail/v1/users/me/messages',
    params: { q: 'in:sent newer_than:90d', maxResults: MAX_SENT_THREADS },
  })

  const refs = list.messages ?? []
  if (refs.length === 0) {
    console.error('No sent messages found in the last 90 days.')
    process.exit(1)
  }

  const corpus: string[] = []
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    try {
      const msg = await nangoProxy<{
        snippet?: string
        payload?: {
          headers?: Array<{ name: string; value: string }>
          parts?: Array<{
            mimeType?: string
            body?: { data?: string }
          }>
          body?: { data?: string }
          mimeType?: string
        }
      }>({
        providerConfigKey,
        connectionId,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/messages/${ref.id}`,
        params: { format: 'full' },
      })
      const subject = headerValue(msg.payload?.headers, 'Subject') || '(no subject)'
      const to = headerValue(msg.payload?.headers, 'To') || ''
      const body = extractPlainText(msg.payload).slice(0, MAX_CHARS_PER_MESSAGE)
      if (!body) continue
      corpus.push(
        `--- Sent email ${i + 1} ---\nTo: ${to}\nSubject: ${subject}\n${body}`
      )
      process.stdout.write(`  ${i + 1}/${refs.length}\r`)
    } catch (err) {
      console.error(`\n  failed to fetch ${ref.id}:`, err)
    }
  }
  console.log(`\nCorpus: ${corpus.length} messages.`)

  if (corpus.length < 5) {
    console.error('Too few sent messages to build a reliable voice profile.')
    process.exit(1)
  }

  console.log('Asking Claude to write the voice profile...')
  const system = `You analyze a user's sent emails and produce a concise
profile of how they write. The profile will be used as a system prompt for
an AI drafting replies on the user's behalf.

Write the profile in markdown. Sections:
- ## Communication Style -- tone, register, common openings/closings, length
- ## Formatting Habits -- paragraphing, bullet usage, how they structure replies
- ## Working Preferences -- patterns in how they push for action, follow up, delegate

Be specific. Quote real opening/closing phrases. Note recurring phrases.
Length: ~250-400 words. Plain markdown only, no code fences.`

  const response = await anthropic.messages.create({
    model: MODELS.synthesis,
    max_tokens: 1500,
    system,
    messages: [
      {
        role: 'user',
        content: `Here are the user's recent sent emails. Produce the voice profile.\n\n${corpus.join('\n\n')}`,
      },
    ],
  })

  const profile = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  console.log('\n--- Voice profile ---')
  console.log(profile)
  console.log('---------------------\n')

  console.log('Writing to users.communication_style...')
  const { error } = await supabase
    .from('users')
    .update({ communication_style: profile })
    .eq('id', process.env.APP_USER_ID!)
  if (error) {
    console.error('Failed to save:', error.message)
    process.exit(1)
  }
  console.log('Voice saved. Future drafts will use this profile.')
}

function headerValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  if (!headers) return null
  const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

function extractPlainText(part: GmailPart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }
  if (part.parts && part.parts.length > 0) {
    const plain = part.parts.find(p => p.mimeType === 'text/plain' && p.body?.data)
    if (plain?.body?.data) return decodeBase64Url(plain.body.data)
    return part.parts.map(extractPlainText).filter(Boolean).join('\n')
  }
  if (part.body?.data) {
    const raw = decodeBase64Url(part.body.data)
    return part.mimeType === 'text/html' ? stripHtml(raw) : raw
  }
  return ''
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf-8')
  } catch {
    return ''
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

main().catch(err => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)
  const e = err as {
    response?: { status?: number; data?: unknown }
    config?: { url?: string; baseURL?: string; params?: unknown }
  }
  console.error('--- error detail ---')
  console.error('status:    ', e?.response?.status ?? '(none)')
  console.error('url:       ', (e?.config?.baseURL ?? '') + (e?.config?.url ?? ''))
  console.error('params:    ', JSON.stringify(e?.config?.params ?? null))
  console.error('body:      ', JSON.stringify(e?.response?.data ?? null, null, 2))
  process.exit(1)
})

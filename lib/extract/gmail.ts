// Gmail extractor — via Nango proxy.
//
// Unlike Granola (direct API), Gmail goes through Nango. Google OAuth with
// refresh tokens is exactly the kind of thing Nango is built for, so we let
// it own the token and just proxy REST calls to the Gmail API.
//
// One-time setup (done by the user in the Nango dashboard):
//   1. Create a "Google Mail" integration in Nango → note its provider config key
//   2. Run the Nango Connect flow for your Google account → note the connection ID
//   3. Put both in .env.local:
//        NANGO_GMAIL_PROVIDER_KEY=google-mail
//        APP_NANGO_GMAIL_CONNECTION_ID=<connection id>
//
// Flow:
//   1. List inbox threads from the last N days (Gmail search query)
//   2. For each thread: fetch the full thread, assemble a plain-text transcript
//   3. Send to Claude → extract action items the user owns
//   4. Return normalized ExtractedItem[]

import { anthropic, MODELS } from '../anthropic'
import { nangoProxy } from '../nango'
import type { ExtractedItem } from '../types'
import { WORK_ONLY_RULE } from './filters'
import { extractJsonObject } from './parse'

const GMAIL_API = '/gmail/v1/users/me'

// How many inbox threads to scan per run. Capped to keep cron cost and
// latency bounded — one Claude call per thread. Bump once we trust it.
const MAX_THREADS = 30
// Within a thread, only the most recent messages carry the live asks.
const MAX_MESSAGES_PER_THREAD = 6
const MAX_CHARS_PER_MESSAGE = 1500

// ─── Gmail API types (only the fields we use) ────────────────────────

interface GmailThreadListItem {
  id: string
  snippet?: string
}

interface GmailThreadListResponse {
  threads?: GmailThreadListItem[]
  nextPageToken?: string
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  payload?: GmailPart & { headers?: GmailHeader[] }
}

interface GmailThreadDetail {
  id: string
  messages?: GmailMessage[]
}

// ─── Public entry point ──────────────────────────────────────────────

interface ExtractActionItemsArgs {
  userEmail: string
  days: number
}

export async function extractGmailActionItems(
  args: ExtractActionItemsArgs
): Promise<ExtractedItem[]> {
  const providerConfigKey = process.env.NANGO_GMAIL_PROVIDER_KEY
  const connectionId = process.env.APP_NANGO_GMAIL_CONNECTION_ID
  if (!providerConfigKey || !connectionId) {
    throw new Error(
      'Gmail not configured — set NANGO_GMAIL_PROVIDER_KEY and APP_NANGO_GMAIL_CONNECTION_ID in .env.local'
    )
  }

  // ─── Step 1: list recent inbox threads ─────────────────────────────
  // The query is the easy tuning knob. Dropping promotions/social skips the
  // obvious noise; the WORK_ONLY filter + anti-hallucination guard catch the
  // rest. Tighten to `is:unread` or a specific label if it's still too broad.
  const query = `in:inbox newer_than:${args.days}d -category:promotions -category:social`

  const list = await nangoProxy<GmailThreadListResponse>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: `${GMAIL_API}/threads`,
    params: { q: query, maxResults: MAX_THREADS },
  })

  const threadRefs = list.threads ?? []

  // ─── Step 2: per-thread fetch + Claude extraction ──────────────────
  const items: ExtractedItem[] = []
  for (const ref of threadRefs) {
    const thread = await fetchThread(providerConfigKey, connectionId, ref.id)
    if (!thread) continue

    const threadItems = await extractItemsFromThread(thread, args.userEmail)
    items.push(...threadItems)
  }

  return items
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function fetchThread(
  providerConfigKey: string,
  connectionId: string,
  threadId: string
): Promise<GmailThreadDetail | null> {
  try {
    return await nangoProxy<GmailThreadDetail>({
      providerConfigKey,
      connectionId,
      method: 'GET',
      endpoint: `${GMAIL_API}/threads/${threadId}`,
      params: { format: 'full' },
    })
  } catch (err) {
    console.error(`[gmail] failed to fetch thread ${threadId}:`, err)
    return null
  }
}

async function extractItemsFromThread(
  thread: GmailThreadDetail,
  userEmail: string
): Promise<ExtractedItem[]> {
  const messages = thread.messages ?? []
  if (messages.length === 0) return []

  // Keep the most recent messages — that's where the live asks are.
  const recent = messages.slice(-MAX_MESSAGES_PER_THREAD)
  const subject = headerValue(messages[0], 'Subject') || '(no subject)'

  const transcript = recent
    .map((m, i) => {
      const from = headerValue(m, 'From') || 'unknown sender'
      const date = headerValue(m, 'Date') || ''
      const body = extractPlainText(m.payload).slice(0, MAX_CHARS_PER_MESSAGE)
      return `--- Message ${i + 1} ---\nFrom: ${from}\nDate: ${date}\n${body || m.snippet || ''}`
    })
    .join('\n\n')

  const latestFrom = headerValue(recent[recent.length - 1], 'From') || 'unknown'

  const prompt = buildExtractionPrompt({ subject, userEmail, latestFrom, transcript })

  const response = await anthropic.messages.create({
    model: MODELS.classifier,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  return parseExtractionResponse(text, thread, subject)
}

// Walk the MIME tree and pull the best plain-text representation available.
function extractPlainText(part: GmailPart | undefined): string {
  if (!part) return ''

  // Direct text/plain body.
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data)
  }

  // Multipart container — prefer a text/plain child, else recurse into all.
  if (part.parts && part.parts.length > 0) {
    const plain = part.parts.find(p => p.mimeType === 'text/plain' && p.body?.data)
    if (plain?.body?.data) return decodeBase64Url(plain.body.data)
    return part.parts.map(extractPlainText).filter(Boolean).join('\n')
  }

  // Last resort: a body with data (often text/html) — strip tags.
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function headerValue(message: GmailMessage | undefined, name: string): string | null {
  if (!message?.payload?.headers) return null
  const h = message.payload.headers.find(
    h => h.name.toLowerCase() === name.toLowerCase()
  )
  return h?.value ?? null
}

// ─── Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract action items owned by a specific user from their email threads.

Your output is STRICT JSON. No prose, no markdown fences, no explanation.

Schema:
{
  "items": [
    {
      "title": "string — the action item, in imperative form ('Reply to X about Y', 'Send the Z report')",
      "tag": "action" | "reply" | "commit" | "fyi",
      "due_at": "ISO 8601 date or datetime, or null",
      "urgent": true | false,
      "sub_items": [ { "title": "string" }, ... ]
    }
  ]
}

${WORK_ONLY_RULE}

Rules:
- The user is identified by their email address, given in the user message. Only extract items THEY own — a reply they owe, a task someone asked them to do, something they committed to.
- Skip items owned by other people in the thread.
- If the most recent message in the thread is FROM the user, they have likely already responded — only extract a task if they explicitly promised a further action in that message.
- Skip newsletters, automated notifications, receipts, calendar invites, and marketing — these have no action item the user owns. Return an empty list for them.
- Skip vague items with no concrete action.
- ONLY extract tasks explicitly supported by the email text. Do not infer or invent tasks. An empty list is a correct, expected answer for a thread with nothing actionable.
- If no qualifying items, return { "items": [] }.

Deadlines (due_at):
- Set due_at when the email states or clearly implies one ("by EOD", "before Friday", "need this today", "by the 20th").
- Resolve relative dates against the date of the message that contains the ask — message dates are shown in the thread.
- Use ISO 8601. Date-only is fine; include a time only if one is stated.
- If no deadline is stated or implied, set due_at to null. Never guess.

Urgency (urgent):
- Set urgent: true only on real time pressure — explicit "urgent"/"ASAP", a same-day or next-day deadline, or a sender clearly blocked and waiting.
- Otherwise urgent: false.

How to choose the tag:
- "reply" — a message the user owes back to someone (the most common case for email)
- "action" — a concrete task to do beyond just replying (draft a doc, make a decision, send a file)
- "commit" — an explicit promise the user made in the thread ("I'll get you the numbers Monday")
- "fyi" — purely informational, no action required

Default to "reply" when the user simply owes a response; use "action" when there is concrete work beyond replying.

Examples:

Example 1 — message dated 2026-05-12:
Thread subject: "Q2 bookkeeping questions"
From pilot@pilot.com: "Hi Subash — we have 4 open questions on the Q2 books. Can you get us answers by Friday so we can close the month?"
Output:
{ "items": [ { "title": "Answer Pilot's 4 Q2 bookkeeping questions", "tag": "reply", "due_at": "2026-05-16", "urgent": false, "sub_items": [] } ] }

Example 2 — a newsletter:
Thread subject: "This week in AI"
From newsletter@somelist.com: "The 10 biggest AI stories this week..."
Output:
{ "items": [] }
(A newsletter — nothing the user owns.)

Example 3 — message dated 2026-05-13, user is subash@sigiq.ai:
Thread subject: "Re: Contract review"
From subash@sigiq.ai (most recent message): "Thanks — I'll send the redlined contract back to you by tomorrow."
Output:
{ "items": [ { "title": "Send the redlined contract back", "tag": "commit", "due_at": "2026-05-14", "urgent": true, "sub_items": [] } ] }
(The latest message is from the user, but they explicitly committed to a next action with a next-day deadline.)`

interface PromptArgs {
  subject: string
  userEmail: string
  latestFrom: string
  transcript: string
}

function buildExtractionPrompt(a: PromptArgs): string {
  return `Email thread: ${a.subject}
User to scope to: ${a.userEmail}
Most recent message is from: ${a.latestFrom}

Thread (oldest to newest of the messages shown):
${a.transcript}

Return JSON with action items owned by ${a.userEmail}. Resolve any relative deadlines against the date of the message containing the ask.`
}

// ─── Parsing ─────────────────────────────────────────────────────────

type ParsedItem = {
  title: string
  tag?: 'action' | 'reply' | 'commit' | 'fyi'
  due_at?: string | null
  urgent?: boolean
  sub_items?: Array<{ title: string }>
}

function parseExtractionResponse(
  text: string,
  thread: GmailThreadDetail,
  subject: string
): ExtractedItem[] {
  let parsed: { items?: ParsedItem[] }
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    console.error('[gmail] failed to parse Claude response:', text.slice(0, 200))
    return []
  }

  const latestMessageId =
    thread.messages?.[thread.messages.length - 1]?.id ?? undefined
  const out: ExtractedItem[] = []

  for (const raw of parsed.items ?? []) {
    if (!raw.title) continue
    const tag = (raw.tag as 'action' | 'reply' | 'commit' | 'fyi') || 'reply'
    const source_ref = {
      gmail_thread_id: thread.id,
      gmail_message_id: latestMessageId,
    }
    out.push({
      source: 'gmail',
      source_ref,
      parent_context: subject,
      title: raw.title,
      task_type: 'review',
      tag,
      due_at: normalizeDueAt(raw.due_at),
      urgent: raw.urgent === true,
      sub_items: (raw.sub_items ?? []).map(s => ({
        source: 'gmail' as const,
        source_ref,
        parent_context: raw.title,
        title: s.title,
        task_type: 'review' as const,
        tag,
      })),
    })
  }
  return out
}

// Validate the model's due_at string. Returns an ISO string, or null if the
// model returned nothing usable — never let a bad date through to the DB.
function normalizeDueAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

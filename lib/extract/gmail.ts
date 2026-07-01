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
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../connections'
import { draftReply } from '../draft/reply'
import { tracedMessage } from '../llm-trace'
import type { ExtractedItem, DraftConfidence } from '../types'
import { WORK_ONLY_RULE } from './filters'
import { extractJsonObject } from './parse'
import { decodeEntities } from '../html'
import { supabase } from '../supabase'
import { judgeExtractedItems, isJudgeEnabled, type OpenItemHint } from './judge'

// Bump when you change SYSTEM_PROMPT or buildExtractionPrompt — used by
// the observability page to bucket slop-rate per prompt revision.
const PROMPT_VERSION = 3

const GMAIL_API = '/gmail/v1/users/me'

// How many inbox threads to scan per run. Capped to keep cron cost and
// latency bounded — one Claude call per thread. Bump once we trust it.
const MAX_THREADS = 30
// Within a thread, only the most recent messages carry the live asks.
const MAX_MESSAGES_PER_THREAD = 6
const MAX_CHARS_PER_MESSAGE = 1500

// ─── Gmail API types (only the fields we use) ────────────────────────

interface GmailHistoryResponse {
  history?: Array<{
    id: string
    messages?: Array<{ id: string; threadId: string }>
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>
  }>
  historyId?: string
  nextPageToken?: string
}

interface GmailProfileResponse {
  historyId?: string
  emailAddress?: string
}

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
  userId?: string
  days: number
  /**
   * Currently-open items across all sources (id, title, parent_context).
   * Passed through to the judge for dedup. Optional — when omitted, the
   * judge sees an empty open-set (safe: it won't emit false merges).
   */
  openItemsHint?: OpenItemHint[]
}

export async function extractGmailActionItems(
  args: ExtractActionItemsArgs
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('gmail', args.userId)
  if (!conn || !conn.nango_connection_id) {
    throw new Error(
      'Gmail not connected — visit /connections to set it up.'
    )
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
  const connectionId = conn.nango_connection_id

  // Load user auto-draft settings once for the whole run (if userId available)
  let autoDraftEnabled = true
  let autoDraftBorderline = false
  if (args.userId) {
    const { data: userRow } = await supabase
      .from('users')
      .select('auto_draft_enabled, auto_draft_borderline')
      .eq('id', args.userId)
      .maybeSingle()
    autoDraftEnabled = userRow?.auto_draft_enabled ?? true
    autoDraftBorderline = userRow?.auto_draft_borderline ?? false
  }

  // ─── Step 1: list recent inbox threads ─────────────────────────────
  const query = `in:inbox newer_than:${args.days}d -category:promotions -category:social -category:forums -category:updates`

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

    const threadItems = await extractItemsFromThread(
      thread,
      args.userEmail,
      args.userId ? { userId: args.userId, autoDraftEnabled, autoDraftBorderline } : undefined,
      args.openItemsHint ?? []
    )
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

interface DraftOptions {
  userId: string
  autoDraftEnabled: boolean
  autoDraftBorderline: boolean
}

async function extractItemsFromThread(
  thread: GmailThreadDetail,
  userEmail: string,
  draftOpts?: DraftOptions,
  openItemsHint: OpenItemHint[] = []
): Promise<ExtractedItem[]> {
  const messages = thread.messages ?? []
  if (messages.length === 0) return []

  // Keep the most recent messages — that's where the live asks are.
  const recent = messages.slice(-MAX_MESSAGES_PER_THREAD)
  const subject = headerValue(messages[0], 'Subject') || '(no subject)'
  const latestMessage = recent[recent.length - 1]
  const latestBody = extractPlainText(latestMessage?.payload)

  const transcript = recent
    .map((m, i) => {
      const from = headerValue(m, 'From') || 'unknown sender'
      const date = headerValue(m, 'Date') || ''
      const body = extractPlainText(m.payload).slice(0, MAX_CHARS_PER_MESSAGE)
      return `--- Message ${i + 1} ---\nFrom: ${from}\nDate: ${date}\n${body || decodeEntities(m.snippet ?? '') || ''}`
    })
    .join('\n\n')

  const latestFrom = headerValue(latestMessage, 'From') || 'unknown'

  const prompt = buildExtractionPrompt({ subject, userEmail, latestFrom, transcript })

  // Structured input — persisted to llm_calls.input_content so the
  // eval runner can replay this case through whatever prompt template
  // is in the codebase later (lib/eval/replay.ts → replayGmailExtraction).
  const inputContent: GmailExtractInput = {
    subject,
    userEmail,
    latestFrom,
    transcript,
  }

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'extract.gmail',
      prompt_version: PROMPT_VERSION,
      user_id: process.env.APP_USER_ID ?? null,
      source_ref: { gmail_thread_id: thread.id },
      input_content: inputContent,
    },
    {
      model: MODELS.classifier,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  let items = parseExtractionResponse(text, thread, subject)
  // Tag every produced item with the call that made it — the digest
  // insert path uses this to populate llm_calls.produced_item_ids so
  // slop_rate per prompt-version actually shows non-zero.
  for (const it of items) it._llm_call_id = response._llmCallId

  // ─── Judge pass ──────────────────────────────────────────────────
  // Second-pass adversarial reviewer (Sonnet). Decides keep / drop /
  // merge-into-existing / demote-to-subtask for each candidate, and
  // corrects tag / urgent / draft_confidence when the extractor got
  // them wrong. Feature-flagged via TASKBASH_JUDGE_ENABLED.
  if (isJudgeEnabled() && items.length > 0) {
    const judged = await judgeExtractedItems({
      source: 'gmail',
      batchLabel: subject,
      sourceText: transcript,
      candidates: items,
      openItems: openItemsHint,
      userId: draftOpts?.userId ?? process.env.APP_USER_ID ?? null,
      parentRunId: response._llmCallId,
      sourceRef: { gmail_thread_id: thread.id },
    })
    // Only keep what the judge accepted. Merged/demoted candidates are
    // handled by the judge itself (merge → skipped, demote → sub_items
    // attached to the parent candidate).
    items = judged.keep
  }

  // Attach Context Trail source_excerpt to every item from this thread.
  // The latest message is the most likely thing the user wants to see when
  // auditing why the agent flagged the task.
  const sourceExcerpt = buildSourceExcerpt({
    subject,
    from: latestFrom,
    body: latestBody,
  })

  // For "reply" tagged items, pre-draft the reply so the user can approve.
  // Draft only the first reply item per thread to keep cost bounded.
  const latestFromEmail = parseEmailAddress(latestFrom)
  const latestMessageId = headerValue(latestMessage, 'Message-ID') ?? latestMessage?.id ?? ''
  const referencesHeader = headerValue(latestMessage, 'References') ?? ''
  const references = referencesHeader
    .split(/\s+/)
    .map(r => r.replace(/[<>]/g, '').trim())
    .filter(Boolean)
  if (latestMessageId && !references.includes(latestMessageId.replace(/[<>]/g, ''))) {
    references.push(latestMessageId.replace(/[<>]/g, ''))
  }

  let draftedOnce = false
  for (const item of items) {
    item.source_excerpt = sourceExcerpt
    if (item.tag === 'reply' && !draftedOnce && latestFromEmail) {
      try {
        const drafted = await draftReply({
          threadText: transcript,
          subject,
          to: latestFromEmail,
          threadId: thread.id,
          messageId: latestMessage?.id,
        })
        item.proposed_action = drafted
        draftedOnce = true

        // Materialize as a real Gmail draft when conditions are met
        if (draftOpts && shouldAutoDraft(item.draft_confidence, draftOpts)) {
          try {
            const { createGmailDraft, deleteGmailDraft } = await import('../gmail/drafts')
            const blocklisted = await isInBlocklist(draftOpts.userId, latestFromEmail)
            if (!blocklisted && drafted.body) {
              const { draftId } = await createGmailDraft({
                fromEmail: userEmail,
                threadId: thread.id,
                inReplyTo: latestMessageId.replace(/[<>]/g, ''),
                references,
                to: [latestFromEmail],
                cc: drafted.cc ?? [],
                subject,
                body: drafted.body,
              })
              // Store draft_id in proposed_action so send/dismiss paths can use it
              item.proposed_action = { ...drafted, gmail_draft_id: draftId, references }
            }
          } catch (err) {
            // Gmail draft creation failure is non-fatal — the item still gets
            // a DB-only draft and the "Draft ready" pill.
            console.error(`[gmail] createGmailDraft failed for thread ${thread.id}:`, err)
          }
        }
      } catch (err) {
        console.error(`[gmail] draftReply failed for thread ${thread.id}:`, err)
      }
    }
  }

  return items
}

function shouldAutoDraft(
  confidence: DraftConfidence | null | undefined,
  opts: DraftOptions
): boolean {
  if (!opts.autoDraftEnabled) return false
  if (confidence === 'high') return true
  if (confidence === 'medium' && opts.autoDraftBorderline) return true
  return false
}

async function isInBlocklist(userId: string, email: string): Promise<boolean> {
  const domain = email.split('@')[1] ?? ''
  const { data } = await supabase
    .from('gmail_draft_blocklist')
    .select('id')
    .eq('user_id', userId)
    .or(`pattern.eq.${email},pattern.eq.*@${domain},pattern.eq.${domain}`)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * Pull just the email out of a "Name <email@x.com>" header value. Falls
 * back to the trimmed input when there's no angle-bracketed address.
 */
function parseEmailAddress(header: string): string | null {
  const match = header.match(/<([^>]+)>/)
  if (match) return match[1].trim()
  if (header.includes('@')) return header.trim()
  return null
}

/**
 * Compact form of the most-recent message for the Context Trail tab.
 * Keeps subject + sender + truncated body so the user can audit quickly
 * without leaving the app.
 */
function buildSourceExcerpt(args: {
  subject: string
  from: string
  body: string
}): string {
  const truncated = args.body.slice(0, 2000)
  const ellipsis = args.body.length > 2000 ? '\n…' : ''
  return `Subject: ${args.subject}\nFrom: ${args.from}\n\n${truncated}${ellipsis}`
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
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
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
      "title": "string. Imperative form, max 8 words, MUST include the specific topic. Example: 'Reply on EverTutor pilot next steps' NOT 'Reply to email' or 'Reply to Megan'. See TITLE FORMAT below for the canonical structure.",
      "subtitle": "string. 1-2 sentences, max 30 words. Explain who triggered this, what they are asking, and what context the user needs to act. Reference specific names, topics, dollar amounts. No em-dashes.",
      "entities": [
        { "kind": "person" | "project" | "thread", "label": "Display Name", "ref": "optional email or id" }
      ],
      "tag": "action" | "reply" | "commit" | "fyi",
      "due_at": "ISO 8601 date or datetime, or null",
      "urgent": true | false,
      "draft_confidence": "high" | "medium" | "low" | "skip",
      "sub_items": [ { "title": "string" }, ... ]
    }
  ]
}

${WORK_ONLY_RULE}

Rules:
- The user is identified by their email address, given in the user message. Only extract items THEY own: a reply they owe, a task someone asked them to do, something they committed to.
- Skip items owned by other people in the thread.
- If the most recent message in the thread is FROM the user, they have likely already responded. Only extract a task if they explicitly promised a further action in that message.
- Skip newsletters, automated notifications, receipts, calendar invites, and marketing. These have no action item the user owns. Return an empty list for them.
- Skip vague items with no concrete action.
- ONLY extract tasks explicitly supported by the email text. Do not infer or invent tasks. An empty list is a correct, expected answer for a thread with nothing actionable.
- If no qualifying items, return { "items": [] }.

ONE ITEM PER COMMITMENT (dedup rule — read carefully):
- A thread can span many messages. If the SAME underlying commitment appears across multiple messages ("confirm the meeting", then someone re-asks in a follow-up), emit it ONCE, not once per message.
- Do not emit a "confirm time" AND a separate "confirm availability" item for the same meeting. Pick one canonical action.
- Do not emit a "reply on X" AND a separate "follow up on X" for the same open question. Pick the sharper of the two.
- When in doubt, fewer items is better. The digest already merges what it can; extras just clutter.

TITLE FORMAT (canonical structure — makes dedup work across runs):
- Use "<verb> <object> <person or entity>" or "<verb> <object>". Example: "Confirm meeting with Eric Lavin", "Send NDA to Karim", "Review Dalmonta Givens application".
- Do NOT include specific times, dates, or numbers unless the deadline itself is the meaningful part of the task. "Confirm meeting with Eric Lavin" is preferred over "Confirm 12:00 PM ET meeting with Eric Lavin". The due_at field carries the time; the title does not need to.
- Do NOT include phone numbers, IDs, or URLs in the title.
- Use the person or company's canonical name. Prefer "Eric Lavin" over "Eric" and over "Mr. Lavin".
- Prefer "meeting" over "meeting time", "call time", "scheduled call" — they all mean the same thing to dedup.

Deadlines (due_at):
- Set due_at when the email states or clearly implies one ("by EOD", "before Friday", "need this today", "by the 20th").
- Resolve relative dates against the date of the message that contains the ask. Message dates are shown in the thread.
- Use ISO 8601. Date-only is fine; include a time only if one is stated.
- If no deadline is stated or implied, set due_at to null. Never guess.

Urgency (urgent):
- Set urgent: true only on real time pressure: explicit "urgent"/"ASAP", a same-day or next-day deadline, or a sender clearly blocked and waiting.
- Otherwise urgent: false.

How to choose the tag:
- "reply": a message the user owes back to someone (the most common case for email)
- "action": a concrete task to do beyond just replying (draft a doc, make a decision, send a file)
- "commit": an explicit promise the user made in the thread ("I'll get you the numbers Monday")
- "fyi": purely informational, no action required

Default to "reply" when the user simply owes a response; use "action" when there is concrete work beyond replying.

draft_confidence (for tag="reply" items only, set null for other tags):
- "high": genuine one-to-one human exchange, real person waiting on a reply. Examples: investor follow-up, customer question, colleague request, meeting request from a known contact.
- "medium": likely real but borderline. Examples: cold outreach from a recruiter, first message from an unknown vendor, intro email where intent is unclear.
- "low": probably automated or very low priority. The user likely does not need to reply promptly.
- "skip": clearly automated despite slipping through category filters. Examples: SaaS onboarding emails, "your account is ready", receipts that ask a fake question.
For non-reply tags (action, commit, fyi), set draft_confidence to null.

STYLE RULE (absolute): NEVER use em-dashes (—) anywhere in the output. Use a
regular hyphen with spaces ( - ), a colon, a comma, a period, or rewrite the
sentence. The title field and every other string must be em-dash free.

Examples:

Example 1. Message dated 2026-05-12:
Thread subject: "Q2 bookkeeping questions"
From pilot@pilot.com: "Hi Subash, we have 4 open questions on the Q2 books. Can you get us answers by Friday so we can close the month?"
Output:
{ "items": [ { "title": "Answer Pilot's 4 Q2 bookkeeping questions", "tag": "reply", "due_at": "2026-05-16", "urgent": false, "sub_items": [] } ] }

Example 2. A newsletter:
Thread subject: "This week in AI"
From newsletter@somelist.com: "The 10 biggest AI stories this week..."
Output:
{ "items": [] }
(A newsletter. Nothing the user owns.)

Example 3. Message dated 2026-05-13, user is subash@sigiq.ai:
Thread subject: "Re: Contract review"
From subash@sigiq.ai (most recent message): "Thanks, I'll send the redlined contract back to you by tomorrow."
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
  subtitle?: string
  entities?: Array<{ kind: string; label: string; ref?: string }>
  tag?: 'action' | 'reply' | 'commit' | 'fyi'
  due_at?: string | null
  urgent?: boolean
  draft_confidence?: DraftConfidence | null
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
    const validConfidence = ['high', 'medium', 'low', 'skip']
    const draftConfidence = (validConfidence.includes(raw.draft_confidence ?? '') ? raw.draft_confidence : null) as DraftConfidence | null

    out.push({
      source: 'gmail',
      source_ref,
      parent_context: subject,
      title: raw.title,
      subtitle: raw.subtitle ? decodeEntities(raw.subtitle) : null,
      entities: raw.entities ?? [],
      task_type: 'review',
      tag,
      due_at: normalizeDueAt(raw.due_at),
      urgent: raw.urgent === true,
      draft_confidence: draftConfidence,
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

// ─── Sent-folder commitment extraction ──────────────────────────────

const COMMITMENT_SYSTEM_PROMPT = `You extract commitments the user made in their own sent emails.

Your output is STRICT JSON. No prose, no markdown fences, no explanation.

Schema:
{
  "items": [
    {
      "title": "string. Imperative form, max 8 words. The commitment the user made. Example: 'Send the redlined contract back', 'Loop in Sarah on the deal'. NOT 'Follow up on email'.",
      "subtitle": "string. 1-2 sentences. What the user promised, to whom, and by when if stated.",
      "tag": "commit",
      "due_at": "ISO 8601 date or null",
      "urgent": true | false,
      "sub_items": []
    }
  ]
}

Rules:
- Only extract EXPLICIT promises the user made: "I'll send X", "I'll loop in Y", "I'll get back to you on Z by Friday".
- Do not extract vague intentions or pleasantries ("I'll think about it", "sounds good").
- If the sent message has no explicit commitment, return { "items": [] }.
- tag is always "commit" for sent-folder items.
- NEVER use em-dashes (—). Use hyphens, colons, or rewrite.`

export async function extractGmailSentCommitments(
  args: ExtractActionItemsArgs
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('gmail', args.userId)
  if (!conn || !conn.nango_connection_id) return []
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
  const connectionId = conn.nango_connection_id

  const query = `in:sent newer_than:${args.days}d`
  const list = await nangoProxy<GmailThreadListResponse>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: `${GMAIL_API}/threads`,
    params: { q: query, maxResults: 20 },
  })

  const items: ExtractedItem[] = []
  for (const ref of list.threads ?? []) {
    const thread = await fetchThread(providerConfigKey, connectionId, ref.id)
    if (!thread) continue
    const threadItems = await extractCommitmentsFromThread(thread, args.userEmail)
    items.push(...threadItems)
  }
  return items
}

async function extractCommitmentsFromThread(
  thread: GmailThreadDetail,
  userEmail: string
): Promise<ExtractedItem[]> {
  const messages = thread.messages ?? []
  if (messages.length === 0) return []

  // Only process threads where the LATEST message is from the user (they sent it)
  const latestMessage = messages[messages.length - 1]
  const latestFrom = headerValue(latestMessage, 'From') || ''
  if (!latestFrom.toLowerCase().includes(userEmail.toLowerCase())) return []

  const subject = headerValue(messages[0], 'Subject') || '(no subject)'
  const recent = messages.slice(-MAX_MESSAGES_PER_THREAD)
  const transcript = recent
    .map((m, i) => {
      const from = headerValue(m, 'From') || 'unknown'
      const date = headerValue(m, 'Date') || ''
      const body = extractPlainText(m.payload).slice(0, MAX_CHARS_PER_MESSAGE)
      return `--- Message ${i + 1} ---\nFrom: ${from}\nDate: ${date}\n${body || decodeEntities(m.snippet ?? '') || ''}`
    })
    .join('\n\n')

  const prompt = `Email thread: ${subject}
User email: ${userEmail}
Thread (oldest to newest):
${transcript}

Extract any explicit commitments the user made in their most recent sent message. Return JSON.`

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'extract.gmail.sent',
      prompt_version: 1,
      user_id: process.env.APP_USER_ID ?? null,
      source_ref: { gmail_thread_id: thread.id },
      input_content: { subject, userEmail, transcript },
    },
    {
      model: MODELS.classifier,
      max_tokens: 512,
      system: COMMITMENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  let parsed: { items?: ParsedItem[] }
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    return []
  }

  const latestMessageId = latestMessage?.id
  return (parsed.items ?? [])
    .filter(raw => raw.title)
    .map(raw => ({
      source: 'gmail' as const,
      source_ref: {
        gmail_thread_id: thread.id,
        gmail_message_id: latestMessageId,
        sent_by_user: true,
      },
      parent_context: subject,
      title: raw.title,
      subtitle: raw.subtitle ? decodeEntities(raw.subtitle) : null,
      task_type: 'review' as const,
      tag: 'commit' as const,
      due_at: normalizeDueAt(raw.due_at),
      urgent: raw.urgent === true,
      sub_items: [],
      _llm_call_id: response._llmCallId,
    }))
}

// ─── Eval replay ────────────────────────────────────────────────────
// The structured input that produced an extract.gmail call. Persisted
// to llm_calls.input_content + eval_cases.input_content so the eval
// runner can rebuild the request with the CURRENT prompt template
// (rather than re-sending the saved request_payload, which has the
// OLD prompt baked in).

export interface GmailExtractInput {
  subject: string
  userEmail: string
  latestFrom: string
  transcript: string
}

/**
 * Re-extract from a stored GmailExtractInput using the CURRENT prompt
 * template (SYSTEM_PROMPT + buildExtractionPrompt). Used by the eval
 * runner to test new prompts against gold cases. Returns the raw
 * response text — the runner compares it against expected_output.
 */
export async function replayGmailExtraction(
  input: unknown,
  client: import('@anthropic-ai/sdk').default
): Promise<{ responseText: string; model: string }> {
  const i = input as GmailExtractInput
  if (!i || typeof i !== 'object' || typeof i.transcript !== 'string') {
    throw new Error('replayGmailExtraction: invalid input_content shape')
  }
  const prompt = buildExtractionPrompt({
    subject: i.subject ?? '',
    userEmail: i.userEmail ?? '',
    latestFrom: i.latestFrom ?? 'unknown',
    transcript: i.transcript,
  })
  const response = await client.messages.create({
    model: MODELS.classifier,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
  const responseText = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return { responseText, model: response.model }
}

/**
 * Fetch Gmail's current historyId (the cursor for incremental sync).
 * Called on first poll to seed gmail_sync_state.
 */
export async function getGmailHistoryId(
  providerConfigKey: string,
  connectionId: string
): Promise<string | null> {
  try {
    const profile = await nangoProxy<GmailProfileResponse>({
      providerConfigKey,
      connectionId,
      method: 'GET',
      endpoint: `${GMAIL_API}/profile`,
    })
    return profile.historyId ?? null
  } catch {
    return null
  }
}

/**
 * Incremental Gmail extraction: only fetch threads that have new messages
 * since `sinceHistoryId`. Returns extracted items + the new historyId cursor.
 * Falls back to returning empty + new cursor if historyId is null or history is unavailable.
 */
export async function extractGmailActionItemsIncremental(args: {
  userEmail: string
  sinceHistoryId: string | null
}): Promise<{ items: ExtractedItem[]; newHistoryId: string | null }> {
  const conn = await getActiveConnection('gmail')
  if (!conn || !conn.nango_connection_id) {
    return { items: [], newHistoryId: null }
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
  const connectionId = conn.nango_connection_id

  // Get current historyId first (we'll return this as the new cursor)
  const profile = await nangoProxy<GmailProfileResponse>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: `${GMAIL_API}/profile`,
  }).catch(() => null)
  const newHistoryId = profile?.historyId ?? null

  if (!args.sinceHistoryId) {
    // No cursor yet - seed historyId and return empty (next poll will be incremental)
    return { items: [], newHistoryId }
  }

  try {
    const history = await nangoProxy<GmailHistoryResponse>({
      providerConfigKey,
      connectionId,
      method: 'GET',
      endpoint: `${GMAIL_API}/history`,
      params: {
        startHistoryId: args.sinceHistoryId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
        maxResults: '50',
      },
    })

    if (!history.history || history.history.length === 0) {
      return { items: [], newHistoryId }
    }

    // Collect unique thread IDs from new messages
    const seenThreadIds = new Set<string>()
    for (const entry of history.history) {
      for (const added of entry.messagesAdded ?? []) {
        seenThreadIds.add(added.message.threadId)
      }
      for (const msg of entry.messages ?? []) {
        seenThreadIds.add(msg.threadId)
      }
    }

    if (seenThreadIds.size === 0) {
      return { items: [], newHistoryId }
    }

    // Extract from only the changed threads (capped at 10 to bound cost)
    const threadIds = Array.from(seenThreadIds).slice(0, 10)
    const items: ExtractedItem[] = []
    for (const threadId of threadIds) {
      const thread = await fetchThread(providerConfigKey, connectionId, threadId)
      if (!thread) continue
      const threadItems = await extractItemsFromThread(thread, args.userEmail)
      items.push(...threadItems)
    }

    return { items, newHistoryId }
  } catch (err) {
    console.error('[gmail] incremental extraction failed:', err)
    return { items: [], newHistoryId }
  }
}

// Granola extractor — direct API path.
//
// Why direct instead of via Nango: Nango's base URL for Granola didn't match
// Granola's actual public API host (resulted in 404s on /meetings). For Week 1
// we bypass Nango for Granola and call the public API directly with a Bearer
// token. Nango stays in the picture for future sources (Gmail/Slack) where
// its OAuth handling is more valuable.
//
// API reference: https://docs.granola.ai
// Base URL:      https://public-api.granola.ai/v1
// Auth:          Bearer <GRANOLA_API_KEY>   (from Granola → Settings → Workspaces → API)
// Requires:      Granola Enterprise plan for API access.
//
// Flow:
//   1. GET /v1/notes?created_after=YYYY-MM-DD → list of note metadata (paginated)
//   2. For each note: GET /v1/notes/{id}?include=transcript → full content
//   3. Send the summary_markdown to Claude → extract action items owned by user
//   4. Return normalized ExtractedItem[]

import { anthropic, MODELS } from '../anthropic'
import { getActiveConnection } from '../connections'
import type { ExtractedItem } from '../types'
import { subDays, formatISO } from 'date-fns'
import { WORK_ONLY_RULE } from './filters'
import { extractJsonObject } from './parse'

const GRANOLA_API_BASE = 'https://public-api.granola.ai/v1'

// ─── Granola API types ───────────────────────────────────────────────

interface GranolaNoteListItem {
  id: string
  object: 'note'
  title: string | null
  owner: { name: string; email: string }
  created_at: string
  updated_at: string
}

interface GranolaListResponse {
  notes: GranolaNoteListItem[]
  hasMore: boolean
  cursor: string | null
}

export interface GranolaNoteDetail {
  id: string
  title: string | null
  owner: { name: string; email: string }
  created_at: string
  updated_at: string
  calendar_event?: {
    event_title?: string
    scheduled_start_time?: string
    organiser?: string
  }
  attendees: Array<{ name: string; email: string }>
  summary_text?: string
  summary_markdown?: string | null
  transcript?: Array<{ text: string; speaker?: { source: string } }> | null
}

// ─── Public entry point ──────────────────────────────────────────────

interface ExtractActionItemsArgs {
  userEmail: string
  days: number
}

export async function extractGranolaActionItems(
  args: ExtractActionItemsArgs
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('granola')
  if (!conn || !conn.api_key) {
    throw new Error(
      'Granola not connected — visit /connections to set it up.'
    )
  }
  const apiKey = conn.api_key

  const since = formatISO(subDays(new Date(), args.days), { representation: 'date' })

  // ─── Step 1: list notes (paginated) ────────────────────────────────
  const allNoteRefs: GranolaNoteListItem[] = []
  let cursor: string | null = null
  let safetyBreak = 0

  do {
    const url = new URL(`${GRANOLA_API_BASE}/notes`)
    url.searchParams.set('created_after', since)
    url.searchParams.set('page_size', '30')
    if (cursor) url.searchParams.set('cursor', cursor)

    const listRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!listRes.ok) {
      const body = await safeReadText(listRes)
      throw new Error(
        `Granola list-notes failed: ${listRes.status} ${listRes.statusText} — ${body.slice(0, 200)}`
      )
    }

    const data = (await listRes.json()) as GranolaListResponse
    allNoteRefs.push(...(data.notes ?? []))
    cursor = data.hasMore ? data.cursor : null
    safetyBreak += 1
  } while (cursor && safetyBreak < 10) // hard cap at ~300 notes

  // ─── Step 2: per-note fetch + Claude extraction ────────────────────
  const items: ExtractedItem[] = []
  for (const noteRef of allNoteRefs) {
    const note = await fetchNoteDetail(apiKey, noteRef.id)
    if (!note) continue

    const noteItems = await extractItemsFromNote(note, args.userEmail)
    items.push(...noteItems)
  }

  return items
}

// ─── Helpers ─────────────────────────────────────────────────────────

export async function fetchNoteDetail(
  apiKey: string,
  noteId: string
): Promise<GranolaNoteDetail | null> {
  const url = `${GRANOLA_API_BASE}/notes/${noteId}?include=transcript`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    console.error(`[granola] failed to fetch note ${noteId}: ${res.status}`)
    return null
  }
  return (await res.json()) as GranolaNoteDetail
}

async function extractItemsFromNote(
  note: GranolaNoteDetail,
  userEmail: string
): Promise<ExtractedItem[]> {
  const sourceText = note.summary_markdown || note.summary_text || ''
  if (!sourceText.trim()) return []

  const prompt = buildExtractionPrompt({
    meetingTitle: note.title || note.calendar_event?.event_title || 'Untitled meeting',
    meetingDate: note.created_at,
    userEmail,
    sourceText,
    attendeeEmails: note.attendees?.map(a => a.email) ?? [],
  })

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

  return parseExtractionResponse(text, note)
}

const SYSTEM_PROMPT = `You extract action items owned by a specific user from meeting summaries.

Your output is STRICT JSON. No prose, no markdown fences, no explanation.

Schema:
{
  "items": [
    {
      "title": "string — the action item, in imperative form ('Send X', 'Review Y')",
      "tag": "action" | "reply" | "commit" | "fyi",
      "due_at": "ISO 8601 date or datetime, or null",
      "urgent": true | false,
      "sub_items": [ { "title": "string" }, ... ]
    }
  ]
}

${WORK_ONLY_RULE}

Rules:
- Only include items the user themselves owns or committed to. Skip items owned by others unless the user explicitly agreed to take them on.
- Skip vague items like "discuss further" or "follow up" with no concrete action.
- Skip items that are clearly already done in the meeting itself.
- Apply the WORK ONLY scope above — drop personal-life items even if the user owns them.
- ONLY extract tasks that are explicitly supported by the text. Do not infer, assume, or invent tasks that "should" exist. If the summary is terse and has no clear action items, return an empty list — an empty list is a correct, expected answer.
- If no qualifying items, return { "items": [] }.

Deadlines (due_at):
- Set due_at when the text states or clearly implies a deadline ("by Friday", "before the board call", "end of week", "tomorrow", "next Tuesday").
- Resolve relative dates against the meeting date given in the user message. "Friday" means the first Friday on or after the meeting date.
- Use ISO 8601. Date-only is fine (2026-05-16); include a time only if one is stated.
- If no deadline is stated or implied, set due_at to null. Never guess a date.

Urgency (urgent):
- Set urgent: true only on real time pressure — an explicit "urgent"/"ASAP", a same-day or next-day deadline, or someone visibly waiting or blocked on it.
- Otherwise urgent: false.

How to choose the tag:
- "action" — concrete task to DO (research, draft, schedule, decide, build)
- "reply" — message owed back to someone (email, Slack DM, text)
- "commit" — explicit promise made in the meeting itself ("I'll send the deck by Friday")
- "fyi" — purely informational, no action required (rare in meeting commitments)

Default to "commit" only when the item is genuinely a meeting promise. Otherwise prefer "action".

Examples:

Example 1 — meeting date 2026-05-12:
Summary: "Subash agreed to send Matthew the three pain points doc by end of week. Matthew will loop in his Nummo team afterward."
Output:
{ "items": [ { "title": "Send Matthew the three pain points doc", "tag": "commit", "due_at": "2026-05-16", "urgent": false, "sub_items": [] } ] }
(Matthew's task is dropped — not owned by the user. "End of week" resolves to the Friday after the meeting.)

Example 2 — meeting date 2026-05-12:
Summary: "Anna is waiting on Subash's sign-off on the Q3 OKRs before tomorrow's leadership sync. She's pinged twice. Team also chatted about offsite venues."
Output:
{ "items": [ { "title": "Sign off on the Q3 OKRs for Anna", "tag": "action", "due_at": "2026-05-13", "urgent": true, "sub_items": [] } ] }
(The offsite chat is dropped — no concrete action the user owns. urgent: true because of the next-day deadline and Anna actively waiting.)

Example 3 — meeting date 2026-05-12:
Summary: "Quick sync. Mostly status updates, nothing decided. Subash mentioned he should book a dentist appointment soon."
Output:
{ "items": [] }
(Nothing actionable for work. The dentist appointment is personal and dropped under the WORK ONLY scope.)`

interface PromptArgs {
  meetingTitle: string
  meetingDate: string
  userEmail: string
  sourceText: string
  attendeeEmails: string[]
}

function buildExtractionPrompt(a: PromptArgs): string {
  return `Meeting: ${a.meetingTitle}
Meeting date: ${a.meetingDate}  (use this to resolve relative deadlines like "Friday" or "tomorrow")
Attendees: ${a.attendeeEmails.join(', ') || 'unknown'}
User to scope to: ${a.userEmail}

Summary:
${a.sourceText}

Return JSON with action items owned by ${a.userEmail}. Resolve any relative deadlines against the meeting date above.`
}

type ParsedItem = {
  title: string
  tag?: 'action' | 'reply' | 'commit' | 'fyi'
  due_at?: string | null
  urgent?: boolean
  sub_items?: Array<{ title: string }>
}

function parseExtractionResponse(
  text: string,
  note: GranolaNoteDetail
): ExtractedItem[] {
  let parsed: { items?: ParsedItem[] }
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    console.error('[granola] failed to parse Claude response:', text.slice(0, 200))
    return []
  }

  const meetingTitle = note.title || note.calendar_event?.event_title || 'Untitled meeting'
  const out: ExtractedItem[] = []

  for (const raw of parsed.items ?? []) {
    if (!raw.title) continue
    const tag = (raw.tag as 'action' | 'reply' | 'commit' | 'fyi') || 'commit'
    out.push({
      source: 'granola',
      source_ref: {
        granola_meeting_id: note.id,
        granola_meeting_date: note.created_at,
      },
      parent_context: meetingTitle,
      title: raw.title,
      task_type: 'post_call',
      tag,
      due_at: normalizeDueAt(raw.due_at),
      urgent: raw.urgent === true,
      sub_items: (raw.sub_items ?? []).map(s => ({
        source: 'granola' as const,
        source_ref: {
          granola_meeting_id: note.id,
          granola_meeting_date: note.created_at,
        },
        parent_context: raw.title,
        title: s.title,
        task_type: 'post_call' as const,
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

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

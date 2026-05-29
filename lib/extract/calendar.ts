// Google Calendar extractor — surface upcoming meetings as PREP items.
//
// Unlike Gmail / Slack (which extract action items from messages), Calendar
// surfaces upcoming events with an inline prep brief generated from the
// event metadata (title, description, attendees, time).
//
// Scope: next 36 hours from the user's primary calendar. Filters out:
//   - all-day events
//   - declined invitations
//   - solo events (no other attendees — not really a meeting)
//   - cancelled events
//
// One-time setup:
//   1. In Google Cloud Console (same `todoo` project as Gmail), add the
//      scope `https://www.googleapis.com/auth/calendar.readonly` to your
//      OAuth consent screen's Data access list.
//   2. Create a "Google Calendar" integration in Nango with the SAME
//      Client ID/Secret as the Gmail integration; scope: calendar.readonly.
//   3. User connects via /connections.

import { anthropic, MODELS } from '../anthropic'
import { nangoProxy } from '../nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../connections'
import { tracedMessage } from '../llm-trace'
import type { ExtractedItem, TaskBrief } from '../types'
import { extractJsonObject } from './parse'

const CALENDAR_API = '/calendar/v3/calendars/primary/events'
const HOURS_AHEAD = 36
const MAX_EVENTS = 20

// ─── Google Calendar API types (only the fields we use) ──────────────

interface GoogleCalendarAttendee {
  email?: string
  displayName?: string
  responseStatus?: string // 'accepted' | 'declined' | 'tentative' | 'needsAction'
  self?: boolean
  organizer?: boolean
}

interface GoogleCalendarEvent {
  id: string
  summary?: string
  description?: string
  status?: string // 'confirmed' | 'cancelled' | 'tentative'
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: GoogleCalendarAttendee[]
  organizer?: GoogleCalendarAttendee
  hangoutLink?: string
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[]
}

// ─── Public entry point ──────────────────────────────────────────────

interface ExtractArgs {
  userEmail: string
  days?: number // unused for Calendar — we always look HOURS_AHEAD
}

export async function extractCalendarPrepItems(
  args: ExtractArgs
): Promise<ExtractedItem[]> {
  const conn = await getActiveConnection('calendar')
  if (!conn || !conn.nango_connection_id) {
    throw new Error(
      'Calendar not connected — visit /connections to set it up.'
    )
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.calendar!
  const connectionId = conn.nango_connection_id

  const now = new Date()
  const horizon = new Date(now.getTime() + HOURS_AHEAD * 60 * 60 * 1000)

  const response = await nangoProxy<GoogleCalendarEventsResponse>({
    providerConfigKey,
    connectionId,
    method: 'GET',
    endpoint: CALENDAR_API,
    params: {
      timeMin: now.toISOString(),
      timeMax: horizon.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(MAX_EVENTS),
    },
  })

  const events = (response.items ?? []).filter(e =>
    isPrepWorthy(e, args.userEmail)
  )

  const items: ExtractedItem[] = []
  for (const event of events) {
    const { brief, llmCallId } = await generatePrepBrief(event, args.userEmail)
    const startIso = event.start?.dateTime || event.start?.date || ''
    items.push({
      source: 'calendar',
      source_ref: {
        google_calendar_event_id: event.id,
        google_calendar_event_start: startIso,
      },
      parent_context: buildParentContext(event),
      title: `Prep: ${event.summary || 'Untitled meeting'}`,
      task_type: 'context_prep',
      tag: 'fyi',
      urgent: false,
      due_at: startIso || null,
      brief,
      _llm_call_id: llmCallId,
    })
  }

  return items
}

// ─── Filters ─────────────────────────────────────────────────────────

function isPrepWorthy(
  event: GoogleCalendarEvent,
  userEmail: string
): boolean {
  if (event.status === 'cancelled') return false
  // All-day events use `date` (no time component) — skip.
  if (event.start?.date && !event.start?.dateTime) return false
  const lowerUserEmail = userEmail.toLowerCase()
  const self = event.attendees?.find(
    a => a.self || a.email?.toLowerCase() === lowerUserEmail
  )
  if (self?.responseStatus === 'declined') return false
  // No other attendees = focus block / reminder, not a meeting.
  const others = (event.attendees ?? []).filter(
    a => !a.self && a.email?.toLowerCase() !== lowerUserEmail
  )
  if (others.length === 0) return false
  return true
}

function buildParentContext(event: GoogleCalendarEvent): string {
  const start = event.start?.dateTime
  const dateLabel = start
    ? new Date(start).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Upcoming'
  const others = (event.attendees ?? [])
    .filter(a => !a.self)
    .map(a => a.displayName || a.email || 'unknown')
    .slice(0, 3)
  const attendeeLabel = others.length > 0 ? ` with ${others.join(', ')}` : ''
  return `${dateLabel}${attendeeLabel}`
}

// ─── Inline brief generation ─────────────────────────────────────────

async function generatePrepBrief(
  event: GoogleCalendarEvent,
  userEmail: string
): Promise<{ brief: TaskBrief; llmCallId?: string }> {
  const attendeeList = (event.attendees ?? [])
    .map(
      a =>
        `${a.displayName || a.email || 'unknown'}${
          a.organizer ? ' (organizer)' : ''
        }`
    )
    .join(', ')
  const eventText = [
    `Event: ${event.summary || 'Untitled'}`,
    `When: ${event.start?.dateTime || event.start?.date || 'unknown'}`,
    `Attendees: ${attendeeList || 'none listed'}`,
    `Description: ${stripHtml(event.description || '(empty)').slice(0, 1500)}`,
  ].join('\n')

  const inputContent: CalendarBriefInput = { userEmail, eventText }

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'extract.calendar',
      prompt_version: 1,
      user_id: process.env.APP_USER_ID ?? null,
      source_ref: { google_calendar_event_id: event.id },
      input_content: inputContent,
    },
    {
      model: MODELS.classifier,
      max_tokens: 600,
      system: PREP_BRIEF_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User: ${userEmail}\n\n${eventText}\n\nGenerate the prep brief as JSON.`,
        },
      ],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<TaskBrief>
    return {
      brief: {
        why: parsed.why || 'Meeting prep',
        know: Array.isArray(parsed.know) ? parsed.know : [],
        done: parsed.done || '',
        next: parsed.next || '',
      },
      llmCallId: response._llmCallId,
    }
  } catch {
    // Fallback: a minimal brief from raw event data.
    return {
      brief: {
        why: `Meeting with ${attendeeList || 'attendees'}`,
        know: event.description
          ? [stripHtml(event.description).slice(0, 200)]
          : [],
        done: '',
        next: '',
      },
      llmCallId: response._llmCallId,
    }
  }
}

const PREP_BRIEF_PROMPT = `You generate a meeting prep brief in STRICT JSON for an upcoming calendar event.

Output JSON only — no prose, no markdown fences:
{
  "why": "string — one sentence on why this meeting matters / what it's for",
  "know": ["bullet 1", "bullet 2", ...]  — 2 to 4 short bullets the user should know walking in,
  "done": "string — one sentence on what work or decisions have happened so far that are relevant",
  "next": "string — one sentence on what the user should plan to say, propose, or decide"
}

Rules:
- Be specific to THIS meeting based on its title, description, and attendees. Don't write generic prep advice.
- If the description is empty or sparse, keep the brief honest and short ("Description is sparse; appears to be a sync with [attendee].").
- Skip pleasantries. Each field should be a useful, scannable fact — not filler.
- "know" bullets are short, discrete facts — not paragraphs.
- For obvious recurring / standard meetings (weekly 1:1, all-hands), keep it short.`

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Eval replay ────────────────────────────────────────────────────
// Structured input for an extract.calendar call. Persisted to
// llm_calls.input_content so the eval runner can re-generate the brief
// with the current prompt template — see lib/eval/replay.ts.

export interface CalendarBriefInput {
  userEmail: string
  eventText: string
}

/**
 * Re-generate a prep brief from a stored CalendarBriefInput using the
 * CURRENT prompt template (PREP_BRIEF_PROMPT).
 */
export async function replayCalendarBrief(
  input: unknown,
  client: import('@anthropic-ai/sdk').default
): Promise<{ responseText: string; model: string }> {
  const i = input as CalendarBriefInput
  if (!i || typeof i !== 'object' || typeof i.eventText !== 'string') {
    throw new Error('replayCalendarBrief: invalid input_content shape')
  }
  const response = await client.messages.create({
    model: MODELS.classifier,
    max_tokens: 600,
    system: PREP_BRIEF_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User: ${i.userEmail ?? ''}\n\n${i.eventText}\n\nGenerate the prep brief as JSON.`,
      },
    ],
  })
  const responseText = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return { responseText, model: response.model }
}

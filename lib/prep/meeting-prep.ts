// Cross-source meeting prep brief generator.
//
// Given a calendar event ID, fetches context from every connected source
// and generates a rich prep brief via Claude:
//   - Granola: past meeting notes with any of the attendees (last 60 days)
//   - Gmail: recent email threads with any of the attendees (last 30 days)
//   - Linear: open issues relevant to the meeting title / attendees
//   - Calendar: the event itself (title, description, attendees, time)
//
// Returns an enriched TaskBrief with an extra `talking_points` field.

import { anthropic, MODELS } from '../anthropic'
import { tracedMessage } from '../llm-trace'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../connections'
import { nangoProxy } from '../nango'
import { extractJsonObject } from '../extract/parse'
import type { TaskBrief } from '../types'

const GRANOLA_API_BASE = 'https://public-api.granola.ai/v1'
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

export interface EnrichedBrief extends TaskBrief {
  talking_points: string[]
  sources_used: string[]
}

// ─── Main entry point ────────────────────────────────────────────────

export async function generateMeetingPrepBrief(args: {
  eventId: string
  eventTitle: string
  eventStart: string
  eventDescription: string
  attendeeEmails: string[]
  attendeeNames: string[]
  userEmail: string
  userId?: string | null
}): Promise<EnrichedBrief> {
  const { eventId, eventTitle, eventStart, eventDescription, attendeeEmails, attendeeNames, userEmail, userId } = args

  const otherAttendees = attendeeEmails.filter(e => e.toLowerCase() !== userEmail.toLowerCase())
  const sourcesUsed: string[] = ['calendar']

  // ─── Fetch context in parallel ───────────────────────────────────────
  const [granolaContext, gmailContext, linearContext] = await Promise.all([
    fetchGranolaContext(otherAttendees, eventTitle).catch(() => null),
    fetchGmailContext(otherAttendees, userEmail).catch(() => null),
    fetchLinearContext(eventTitle, attendeeNames).catch(() => null),
  ])

  if (granolaContext) sourcesUsed.push('granola')
  if (gmailContext) sourcesUsed.push('gmail')
  if (linearContext) sourcesUsed.push('linear')

  // ─── Build prompt context ────────────────────────────────────────────
  const sections: string[] = []

  sections.push(`## Calendar Event
Title: ${eventTitle}
When: ${eventStart}
Attendees: ${attendeeNames.join(', ') || otherAttendees.join(', ') || 'none listed'}
Description: ${eventDescription.slice(0, 800) || '(no description)'}`)

  if (granolaContext) {
    sections.push(`## Past Meeting Notes (Granola)\n${granolaContext}`)
  }

  if (gmailContext) {
    sections.push(`## Recent Email Threads (Gmail)\n${gmailContext}`)
  }

  if (linearContext) {
    sections.push(`## Open Linear Issues\n${linearContext}`)
  }

  const contextBlock = sections.join('\n\n')

  // ─── Claude call ─────────────────────────────────────────────────────
  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'prep.meeting',
      prompt_version: 1,
      user_id: userId ?? process.env.APP_USER_ID ?? null,
      source_ref: { google_calendar_event_id: eventId },
      input_content: { eventId, eventTitle, attendeeEmails, contextBlock },
    },
    {
      model: MODELS.synthesis,
      max_tokens: 800,
      system: MEETING_PREP_PROMPT,
      messages: [{ role: 'user', content: `User: ${userEmail}\n\n${contextBlock}\n\nGenerate the meeting prep brief as JSON.` }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  try {
    const parsed = JSON.parse(extractJsonObject(text)) as Partial<EnrichedBrief>
    return {
      why: parsed.why || `Meeting with ${attendeeNames[0] || 'attendees'}`,
      know: Array.isArray(parsed.know) ? parsed.know.slice(0, 5) : [],
      done: parsed.done || '',
      next: parsed.next || '',
      talking_points: Array.isArray(parsed.talking_points) ? parsed.talking_points.slice(0, 4) : [],
      sources_used: sourcesUsed,
    }
  } catch {
    return {
      why: `Meeting with ${attendeeNames[0] || 'attendees'}`,
      know: [],
      done: '',
      next: 'Review agenda and notes before the call.',
      talking_points: [],
      sources_used: sourcesUsed,
    }
  }
}

// ─── Granola: past notes with these attendees ────────────────────────

async function fetchGranolaContext(attendeeEmails: string[], eventTitle: string): Promise<string | null> {
  const conn = await getActiveConnection('granola')
  if (!conn?.api_key) return null

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const url = new URL(`${GRANOLA_API_BASE}/notes`)
  url.searchParams.set('created_after', since)
  url.searchParams.set('page_size', '50')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${conn.api_key}` },
  })
  if (!res.ok) return null

  const data = await res.json() as { notes?: Array<{ id: string; title: string | null; attendees?: Array<{ email: string }> }> }
  const notes = data.notes ?? []

  // Filter to notes that share attendees or have a title related to this meeting
  const lowerAttendees = attendeeEmails.map(e => e.toLowerCase())
  const titleWords = eventTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const relevant = notes.filter(n => {
    const nAttendees = (n.attendees ?? []).map(a => a.email.toLowerCase())
    const attendeeMatch = lowerAttendees.some(e => nAttendees.includes(e))
    const titleMatch = titleWords.some(w => (n.title || '').toLowerCase().includes(w))
    return attendeeMatch || titleMatch
  }).slice(0, 4)

  if (relevant.length === 0) return null

  // Fetch summaries for relevant notes
  const summaries: string[] = []
  for (const note of relevant) {
    try {
      const detailRes = await fetch(`${GRANOLA_API_BASE}/notes/${note.id}`, {
        headers: { Authorization: `Bearer ${conn.api_key!}` },
      })
      if (!detailRes.ok) continue
      const detail = await detailRes.json() as { title?: string | null; summary_markdown?: string | null; created_at?: string }
      if (detail.summary_markdown) {
        summaries.push(`### ${detail.title || 'Meeting'} (${detail.created_at?.split('T')[0] || 'recent'})\n${detail.summary_markdown.slice(0, 600)}`)
      }
    } catch {
      // skip
    }
  }

  return summaries.length > 0 ? summaries.join('\n\n') : null
}

// ─── Gmail: recent threads with these attendees ──────────────────────

async function fetchGmailContext(attendeeEmails: string[], userEmail: string): Promise<string | null> {
  const conn = await getActiveConnection('gmail')
  if (!conn?.nango_connection_id) return null
  const providerConfigKey = NANGO_PROVIDER_KEY.gmail
  if (!providerConfigKey) return null

  // Search for threads from/to any of the attendees in the last 30 days
  if (attendeeEmails.length === 0) return null
  const fromQuery = attendeeEmails.slice(0, 3).map(e => `from:${e}`).join(' OR ')
  const query = `(${fromQuery}) newer_than:30d -category:promotions`

  interface ThreadListItem { id: string; snippet?: string }
  interface ThreadListResponse { threads?: ThreadListItem[] }

  const list = await nangoProxy<ThreadListResponse>({
    providerConfigKey,
    connectionId: conn.nango_connection_id,
    method: 'GET',
    endpoint: '/gmail/v1/users/me/threads',
    params: { q: query, maxResults: '5' },
  })

  const refs = list.threads ?? []
  if (refs.length === 0) return null

  const snippets: string[] = []
  for (const ref of refs.slice(0, 4)) {
    try {
      interface ThreadDetail {
        id: string
        messages?: Array<{
          snippet?: string
          payload?: { headers?: Array<{ name: string; value: string }> }
        }>
      }
      const thread = await nangoProxy<ThreadDetail>({
        providerConfigKey,
        connectionId: conn.nango_connection_id,
        method: 'GET',
        endpoint: `/gmail/v1/users/me/threads/${ref.id}`,
        params: { format: 'metadata', metadataHeaders: 'Subject' },
      })
      const msgs = thread.messages ?? []
      const subject = msgs[0]?.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)'
      const snippet = msgs[msgs.length - 1]?.snippet || ''
      snippets.push(`- "${subject}": ${snippet.slice(0, 200)}`)
    } catch {
      // skip
    }
  }

  return snippets.length > 0 ? snippets.join('\n') : null
}

// ─── Linear: open issues relevant to the meeting ────────────────────

async function fetchLinearContext(eventTitle: string, attendeeNames: string[]): Promise<string | null> {
  const conn = await getActiveConnection('linear')
  if (!conn?.api_key) return null

  // Search for assigned open issues — no full-text search in Linear Personal API,
  // so we fetch the user's open assigned issues and filter locally by title overlap.
  const query = `
    query PrepContext {
      viewer {
        assignedIssues(first: 50, orderBy: updatedAt) {
          nodes {
            identifier title state { name type } team { name }
          }
        }
      }
    }
  `.trim()

  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: conn.api_key },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) return null

  const data = await res.json() as {
    data?: { viewer?: { assignedIssues?: { nodes?: Array<{ identifier: string; title: string; state?: { name?: string; type?: string }; team?: { name?: string } }> } } }
  }
  const issues = data.data?.viewer?.assignedIssues?.nodes ?? []

  // Filter to open issues with title words overlapping the event title or attendee names
  const searchTerms = [
    ...eventTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    ...attendeeNames.map(n => n.split(' ')[0].toLowerCase()).filter(n => n.length > 2),
  ]
  const openTypes = new Set(['backlog', 'unstarted', 'started', 'triage'])
  const relevant = issues
    .filter(i => i.state?.type && openTypes.has(i.state.type))
    .filter(i => searchTerms.some(t => i.title.toLowerCase().includes(t)))
    .slice(0, 5)

  if (relevant.length === 0) {
    // Fall back: just show the top 5 open issues for context
    const top5 = issues.filter(i => i.state?.type && openTypes.has(i.state.type)).slice(0, 5)
    if (top5.length === 0) return null
    return top5.map(i => `- ${i.identifier}: ${i.title} [${i.state?.name}]`).join('\n')
  }

  return relevant.map(i => `- ${i.identifier}: ${i.title} [${i.state?.name}]`).join('\n')
}

// ─── Prompt ──────────────────────────────────────────────────────────

const MEETING_PREP_PROMPT = `You generate a rich meeting prep brief from cross-source context.

Output STRICT JSON only. No prose, no markdown fences:
{
  "why": "string. One sentence: what is this meeting really about and why does it matter",
  "know": ["bullet 1", "bullet 2", "bullet 3"],
  "done": "string. What has already happened - prior meetings, emails, decisions, commits",
  "next": "string. What the user should aim to achieve or decide in THIS meeting",
  "talking_points": ["point 1", "point 2", "point 3"]
}

"know" is 3 to 5 short bullets - key facts, open items, relevant context the user needs walking in.
"talking_points" is 2 to 4 specific things the user should raise or be ready to answer.

Rules:
- Draw ONLY from the context provided. Do not invent facts.
- Prioritize recent Granola notes and email threads over older ones.
- If Linear issues are provided, mention any that are directly relevant.
- Be specific and actionable. Skip generic advice like "prepare agenda".
- If context is sparse, be honest: "Limited prior context found."
- Keep each field under 2 sentences. Bullets under 15 words each.

STYLE RULE (absolute): NEVER use em-dashes (—). Use hyphens, colons, or rewrite.`

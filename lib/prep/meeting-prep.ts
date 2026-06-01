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
import { supabase } from '../supabase'
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
  const resolvedUserId = userId ?? process.env.APP_USER_ID ?? null

  // ─── Fetch context in parallel ───────────────────────────────────────
  const [granolaContext, granolaItemsContext, gmailContext, linearContext] = await Promise.all([
    fetchGranolaContext(otherAttendees, eventTitle).catch(() => null),
    resolvedUserId
      ? fetchGranolaItemsContext(otherAttendees, eventTitle, resolvedUserId).catch(() => null)
      : Promise.resolve(null),
    fetchGmailContext(otherAttendees, userEmail).catch(() => null),
    fetchLinearContext(eventTitle, attendeeNames).catch(() => null),
  ])

  if (granolaContext || granolaItemsContext) sourcesUsed.push('granola')
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
    sections.push(`## Past Meeting Notes (Granola — full summaries, newest first)\n${granolaContext}`)
  }

  if (granolaItemsContext) {
    sections.push(`## Open/Completed Action Items From Past Meetings on This Topic\n${granolaItemsContext}`)
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
      max_tokens: 1200,
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
      know: Array.isArray(parsed.know) ? parsed.know.slice(0, 6) : [],
      done: parsed.done || '',
      next: parsed.next || '',
      talking_points: Array.isArray(parsed.talking_points) ? parsed.talking_points.slice(0, 5) : [],
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

interface GranolaListNote {
  id: string
  title: string | null
  created_at?: string
  attendees?: Array<{ email: string }>
}

interface GranolaDetailNote {
  title?: string | null
  created_at?: string
  attendees?: Array<{ name?: string; email: string }>
  summary_markdown?: string | null
  summary_text?: string | null
  transcript?: Array<{ text: string; speaker?: { source: string } }> | null
}

async function fetchGranolaContext(attendeeEmails: string[], eventTitle: string): Promise<string | null> {
  const conn = await getActiveConnection('granola')
  if (!conn?.api_key) return null

  // 120-day window, paginate up to 200 notes to maximise coverage
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  let notes: GranolaListNote[] = []
  for (const pageSize of [100, 100]) {
    const url = new URL(`${GRANOLA_API_BASE}/notes`)
    url.searchParams.set('created_after', since)
    url.searchParams.set('page_size', String(pageSize))
    if (notes.length > 0) url.searchParams.set('offset', String(notes.length))
    try {
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${conn.api_key}` } })
      if (!res.ok) break
      const data = await res.json() as { notes?: GranolaListNote[] }
      const page = data.notes ?? []
      notes.push(...page)
      if (page.length < pageSize) break
    } catch { break }
  }

  if (notes.length === 0) return null

  // Score each note for relevance:
  //   3 = attendee email exact match + title word match
  //   2 = attendee email exact match
  //   1 = title word match OR same email domain as an attendee
  const lowerAttendees = attendeeEmails.map(e => e.toLowerCase())
  const attendeeDomains = lowerAttendees.map(e => e.split('@')[1]).filter(Boolean)
  const titleWords = eventTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  const scored = notes
    .map(n => {
      const nEmails = (n.attendees ?? []).map(a => a.email.toLowerCase())
      const nTitle = (n.title || '').toLowerCase()
      const exactAttendee = lowerAttendees.some(e => nEmails.includes(e))
      const domainAttendee = !exactAttendee && attendeeDomains.some(d => nEmails.some(e => e.endsWith(`@${d}`)))
      const titleMatch = titleWords.some(w => nTitle.includes(w))
      const score = exactAttendee && titleMatch ? 3 : exactAttendee ? 2 : (titleMatch || domainAttendee) ? 1 : 0
      return { note: n, score }
    })
    .filter(x => x.score > 0)
    // Sort: score desc, then created_at desc (recency within same tier)
    .sort((a, b) => b.score - a.score || (b.note.created_at ?? '').localeCompare(a.note.created_at ?? ''))
    .slice(0, 6)

  if (scored.length === 0) return null

  // Fetch full detail for each — pull summary + transcript snippet
  const summaries: string[] = []
  await Promise.all(scored.map(async ({ note }) => {
    try {
      const detailRes = await fetch(`${GRANOLA_API_BASE}/notes/${note.id}`, {
        headers: { Authorization: `Bearer ${conn.api_key!}` },
      })
      if (!detailRes.ok) return
      const detail = await detailRes.json() as GranolaDetailNote

      const dateStr = detail.created_at?.split('T')[0] || note.created_at?.split('T')[0] || 'recent'
      const attendeeList = (detail.attendees ?? []).map(a => a.name || a.email).join(', ')
      const header = `### ${detail.title || note.title || 'Meeting'} (${dateStr}${attendeeList ? ` — ${attendeeList}` : ''})`

      // Prefer markdown summary; fall back to plain text; then transcript
      let body = ''
      if (detail.summary_markdown) {
        body = detail.summary_markdown.slice(0, 1500)
      } else if (detail.summary_text) {
        body = detail.summary_text.slice(0, 1500)
      } else if (detail.transcript && detail.transcript.length > 0) {
        body = detail.transcript
          .slice(0, 40)
          .map(t => t.text)
          .join(' ')
          .slice(0, 1000)
        body = `[Transcript excerpt] ${body}`
      }

      if (body) summaries.push(`${header}\n${body}`)
    } catch { /* skip individual fetch failures */ }
  }))

  if (summaries.length === 0) return null

  // Sort final summaries by date desc so Claude sees newest first
  summaries.sort((a, b) => {
    const dateA = a.match(/\((\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
    const dateB = b.match(/\((\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
    return dateB.localeCompare(dateA)
  })

  return summaries.join('\n\n')
}

// ─── Granola: past action items already extracted into items DB ───────

async function fetchGranolaItemsContext(
  attendeeEmails: string[],
  eventTitle: string,
  userId: string
): Promise<string | null> {
  // Find Granola-sourced items where the parent_context (meeting title) overlaps
  // with attendee emails OR the upcoming event title.
  const titleWords = eventTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  const { data: rows } = await supabase
    .from('items')
    .select('title, tag, status, parent_context, completed_at, first_seen_at')
    .eq('user_id', userId)
    .eq('source', 'granola')
    .in('status', ['open', 'in_progress', 'completed'])
    .order('first_seen_at', { ascending: false })
    .limit(200)

  if (!rows || rows.length === 0) return null

  // Score each item: does the parent_context match this meeting?
  const relevant = rows.filter(row => {
    const ctx = (row.parent_context || '').toLowerCase()
    return titleWords.some(w => ctx.includes(w))
  })

  if (relevant.length === 0) return null

  const lines: string[] = []
  const open = relevant.filter(r => r.status === 'open' || r.status === 'in_progress')
  const done = relevant.filter(r => r.status === 'completed').slice(0, 5)

  if (open.length > 0) {
    lines.push('**Open action items from past meetings on this topic:**')
    for (const r of open.slice(0, 8)) {
      lines.push(`- [${r.tag ?? 'action'}] ${r.title} (from: ${r.parent_context})`)
    }
  }
  if (done.length > 0) {
    lines.push('**Recently completed items from past meetings on this topic:**')
    for (const r of done) {
      lines.push(`- ${r.title} (completed ${r.completed_at?.split('T')[0] ?? 'recently'})`)
    }
  }

  return lines.join('\n')
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
  "know": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"],
  "done": "string. What has already been decided, completed, or discussed in past meetings with these people",
  "next": "string. What the user should aim to achieve or decide in THIS meeting",
  "talking_points": ["point 1", "point 2", "point 3", "point 4"]
}

"know" is 3 to 5 short bullets. Mine the Granola meeting notes deeply:
- Include specific decisions made, commitments given, and open threads from past meetings
- Include any open action items from past meetings that are still unresolved
- Include names, numbers, dates, project names from the notes - be specific
- Surface relationship context: tone, outstanding asks, any tension or momentum

"done" should reference specific past meetings by name/date when available.
"talking_points" is 3 to 4 specific things to raise, referencing open items or unresolved threads from past context.

Rules:
- Draw ONLY from the context provided. Do not invent facts.
- Granola past meeting notes are your richest source - extract intricate detail from them.
- If open action items from past meetings are provided, surface any that are unresolved.
- Prioritize recent context over older context within each source.
- If Linear issues are provided, surface any directly relevant to this meeting's topic.
- Be specific: names, numbers, project names. Never generic.
- If context is sparse, be honest: "Limited prior context found."
- Bullets under 20 words each.

STYLE RULE (absolute): NEVER use em-dashes (—). Use hyphens, colons, or rewrite.`

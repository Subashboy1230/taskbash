// Granola extractor.
//
// Flow:
//   1. Fetch recent meetings (last N days) via Nango proxy to Granola API.
//   2. For each meeting with a summary, send the summary to Claude with a
//      tightly-scoped prompt: "extract action items owned by Subash."
//   3. Return normalized ExtractedItem[].
//
// IMPORTANT — Granola API access:
// As of writing, Nango's support for Granola may be limited. Two paths:
//   a) Nango proxy to https://api.granola.so (this file).
//   b) Fallback: call Granola's MCP server from Node using @modelcontextprotocol/sdk.
//      See README → "Granola API alternatives" for that path.

import { nangoProxy } from '../nango'
import { anthropic, MODELS } from '../anthropic'
import type { ExtractedItem } from '../types'
import { subDays, formatISO } from 'date-fns'

interface GranolaMeeting {
  id: string
  title: string
  start_time: string
  attendees?: Array<{ email?: string; name?: string }>
  summary?: string          // markdown
  notes?: string            // markdown
}

interface ExtractActionItemsArgs {
  nangoConnectionId: string
  userEmail: string         // to scope "what did I commit to"
  days: number
}

/**
 * Top-level entry: returns action items owned by the user from the last N days
 * of Granola meetings.
 */
export async function extractGranolaActionItems(
  args: ExtractActionItemsArgs
): Promise<ExtractedItem[]> {
  const since = formatISO(subDays(new Date(), args.days), { representation: 'date' })

  // ─── Step 1: fetch meetings ────────────────────────────────────────────
  // NOTE: actual Granola endpoint shape TBD. Adjust `endpoint` + `params`
  // based on Granola's API docs. Common shape: GET /meetings?since=...
  const meetings = await nangoProxy<{ meetings: GranolaMeeting[] }>({
    providerConfigKey: process.env.NANGO_GRANOLA_PROVIDER_KEY || 'granola',
    connectionId: args.nangoConnectionId,
    method: 'GET',
    endpoint: '/meetings',
    params: { since, limit: 50 },
  })

  // ─── Step 2: for each meeting, extract action items via Claude ────────
  const items: ExtractedItem[] = []
  for (const meeting of meetings.meetings ?? []) {
    if (!meeting.summary && !meeting.notes) continue

    const meetingItems = await extractItemsFromMeeting(meeting, args.userEmail)
    items.push(...meetingItems)
  }

  return items
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function extractItemsFromMeeting(
  meeting: GranolaMeeting,
  userEmail: string
): Promise<ExtractedItem[]> {
  const sourceText = [meeting.summary, meeting.notes].filter(Boolean).join('\n\n')
  if (!sourceText.trim()) return []

  const prompt = buildExtractionPrompt({
    meetingTitle: meeting.title,
    meetingDate: meeting.start_time,
    userEmail,
    sourceText,
  })

  const response = await anthropic.messages.create({
    model: MODELS.classifier,           // Haiku is fine for this extraction
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  return parseExtractionResponse(text, meeting)
}

const SYSTEM_PROMPT = `You extract action items owned by a specific user from meeting summaries.

Your output is STRICT JSON. No prose, no markdown fences, no explanation.

Schema:
{
  "items": [
    {
      "title": "string — the action item, in imperative form ('Send X', 'Review Y')",
      "sub_items": [ { "title": "string" }, ... ]   // optional, only if real sub-tasks exist
    }
  ]
}

Rules:
- Only include items the user themselves owns or committed to. Skip items owned by others unless the user explicitly agreed to take them on.
- Skip vague items like "discuss further" or "follow up" with no concrete action.
- Skip items that are clearly already done in the meeting itself.
- If no qualifying items, return { "items": [] }.
`

interface PromptArgs {
  meetingTitle: string
  meetingDate: string
  userEmail: string
  sourceText: string
}

function buildExtractionPrompt(a: PromptArgs): string {
  return `Meeting: ${a.meetingTitle}
Date: ${a.meetingDate}
User to scope to: ${a.userEmail}

Summary:
${a.sourceText}

Return JSON with action items owned by ${a.userEmail}.`
}

function parseExtractionResponse(
  text: string,
  meeting: GranolaMeeting
): ExtractedItem[] {
  let parsed: { items?: Array<{ title: string; sub_items?: Array<{ title: string }> }> }
  try {
    // Strip markdown fences if Claude added them despite instructions
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[granola] failed to parse Claude response:', text)
    return []
  }

  const out: ExtractedItem[] = []
  for (const raw of parsed.items ?? []) {
    if (!raw.title) continue
    out.push({
      source: 'granola',
      source_ref: {
        granola_meeting_id: meeting.id,
        granola_meeting_date: meeting.start_time,
      },
      parent_context: meeting.title,
      title: raw.title,
      task_type: 'post_call',
      tag: 'commit',
      sub_items: (raw.sub_items ?? []).map(s => ({
        source: 'granola' as const,
        source_ref: {
          granola_meeting_id: meeting.id,
          granola_meeting_date: meeting.start_time,
        },
        parent_context: raw.title,
        title: s.title,
        task_type: 'post_call' as const,
        tag: 'commit' as const,
      })),
    })
  }
  return out
}

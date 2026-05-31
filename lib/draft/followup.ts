// Follow-up drafting from meeting commitments.
//
// Granola produces lots of "Subash to send X" / "Subash to follow up with Y"
// items. When the recipient can be inferred from the meeting attendees, we
// pre-draft the follow-up message so the user can hit Send instead of
// composing from scratch.
//
// Strategy: hand Claude the action item + meeting context + attendee list,
// ask it to either (a) draft a follow-up email to a specific attendee or
// (b) say "no draft — this is internal / no recipient." Bias toward (b)
// when in doubt; a stale wrong draft is worse than no draft.

import { anthropic, MODELS } from '../anthropic'
import { supabase } from '../supabase'
import { tracedMessage } from '../llm-trace'
import type { ProposedAction } from '../types'
import { extractJsonObject } from '../extract/parse'

const USER_ID = process.env.APP_USER_ID!

const DEFAULT_VOICE = `You write direct, concise emails. Open with "Hi <First>,"
and close with "Best regards,". Keep paragraphs short and action-oriented.`

interface DraftArgs {
  /** The action item text — e.g. "Send Matthew the 3 pain points doc". */
  actionTitle: string
  /** Meeting title + date for context. */
  meetingTitle: string
  meetingDate?: string
  /** The agent's source-text excerpt from the meeting (summary or note). */
  meetingContext: string
  /** Attendees from the meeting — recipient candidates. */
  attendees: Array<{ name: string; email: string }>
  /** User's own email so we don't draft a reply to themselves. */
  userEmail: string
}

/**
 * Returns a ProposedAction (gmail_compose) when the agent can confidently
 * pick a recipient + draft a follow-up; returns null when the item is
 * internal or the recipient is ambiguous.
 */
export async function draftFollowup(args: DraftArgs): Promise<ProposedAction | null> {
  // Strip the user from the attendee candidates — we never draft a message
  // from Subash to Subash.
  const candidates = args.attendees.filter(
    a => a.email.toLowerCase() !== args.userEmail.toLowerCase()
  )
  if (candidates.length === 0) return null // No external attendees, internal task

  const voice = await loadVoice()

  const system = `You decide whether a meeting commitment warrants a pre-drafted
follow-up email, and if so, draft it in the user's voice.

You will be given:
- An action item the user owns from a meeting they were in
- The meeting title + date
- The relevant excerpt from the meeting note
- The list of attendees other than the user (recipient candidates)
- The user's communication style profile

Decide ONE of two outcomes:

OUTCOME A. Draft a follow-up. Pick this when:
- The action item is clearly about delivering something to / replying to /
  coordinating with a SPECIFIC named attendee.
- You can confidently pick which attendee is the recipient.
- The draft has substance to write. Even a 2-sentence acknowledgment
  counts ("sending the doc now / will follow up tomorrow").

OUTCOME B. No draft. Pick this when:
- The task is internal-only (talk to the CEO who isn't in the attendee list,
  research something, build something, decide internally).
- The recipient is ambiguous or it's a many-to-many follow-up.
- The action is "schedule a meeting". That's a calendar action, not an email.
- The action has no concrete content to write yet (the user needs to do work first).

Bias toward B when in doubt. A stale or wrong draft is worse than no draft.

Voice:
${voice}

Output STRICT JSON:
{ "outcome": "A" | "B",
  "recipient_email": "string or null",   // only when A
  "recipient_name":  "string or null",   // only when A
  "subject":         "string or null",   // only when A
  "body":            "string or null"    // only when A: match the user's voice
}

When A, body should be the actual email (greeting + 1 to 4 short paragraphs +
sign-off), no markdown, no signature beyond the sign-off.

STYLE RULE (absolute): NEVER use em-dashes (—) anywhere in the output. Use a
regular hyphen with spaces ( - ), a comma, a period, or rewrite the sentence.`

  const attendeesList = candidates
    .map(a => `${a.name || 'unknown'} <${a.email}>`)
    .join('\n')

  const userMsg = `Action item: ${args.actionTitle}
Meeting: ${args.meetingTitle}${args.meetingDate ? ` (${args.meetingDate.slice(0, 10)})` : ''}

Attendees (other than user):
${attendeesList}

Meeting note excerpt:
${args.meetingContext.slice(0, 2500)}

Decide and output JSON.`

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'draft.followup',
      prompt_version: 1,
      user_id: process.env.APP_USER_ID ?? null,
    },
    {
      model: MODELS.classifier,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }
  )

  const text = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  let parsed: {
    outcome?: 'A' | 'B'
    recipient_email?: string | null
    subject?: string | null
    body?: string | null
  }
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    return null
  }

  if (parsed.outcome !== 'A') return null
  if (!parsed.recipient_email || !parsed.subject || !parsed.body) return null

  return {
    kind: 'gmail_compose',
    to: [parsed.recipient_email],
    subject: parsed.subject,
    body: parsed.body,
  }
}

async function loadVoice(): Promise<string> {
  const { data } = await supabase
    .from('users')
    .select('communication_style')
    .eq('id', USER_ID)
    .maybeSingle()
  return (data?.communication_style as string | null) || DEFAULT_VOICE
}

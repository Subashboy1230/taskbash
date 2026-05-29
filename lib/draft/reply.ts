// Reply drafting — given an email thread the user owes a reply to, produce
// a draft that sounds like the user. Pulls the user's communication-style
// profile (Soul) from the users table; falls back to a sensible default
// when Soul hasn't been generated yet.
//
// The drafted text is what shows up in the approval queue's detail panel.
// The user can edit, copy, or hit Send.

import { anthropic, MODELS } from '../anthropic'
import { supabase } from '../supabase'
import { tracedMessage } from '../llm-trace'
import type { ProposedAction } from '../types'

const USER_ID = process.env.APP_USER_ID!

const DEFAULT_SOUL = `You write in a direct, concise, professional style.
Emails are usually short and action-oriented, with a clear ask or next step.
Open with "Hi [Name]," and close with "Best regards,". Keep paragraphs short.`

interface DraftArgs {
  /** Raw text of the email thread (latest message + relevant history). */
  threadText: string
  /** Subject of the latest message in the thread. */
  subject: string
  /** Email of the person to reply to. */
  to: string
  /** Optional thread/message IDs to thread the reply back into Gmail. */
  threadId?: string
  messageId?: string
  /** User's name — used to sign the draft. */
  userName?: string
}

/**
 * Draft a reply to the given thread. Returns a ProposedAction ready to
 * persist on the item row.
 */
export async function draftReply(args: DraftArgs): Promise<ProposedAction> {
  const soul = await loadSoul()

  const system = `You draft email replies on behalf of a user.
You will be given the user's communication style profile and the email
thread that needs a reply. Produce ONE reply body — no subject line, no
salutation header (just "Hi <name>,"), no signature except a sign-off line.

Communication style:
${soul}

Rules:
- Sound like the user. Match their tone, brevity, formatting habits.
- Address the latest message's points specifically. Don't restate what
  the sender wrote.
- If the sender asked questions, answer them. If the sender's email is
  ambiguous, draft a reply that clarifies what you'd need to respond fully.
- Don't invent facts you don't have. If the user's response depends on
  information you don't have, write a reply that acknowledges + commits to
  follow up.
- Keep it short. Default to 2–4 sentences unless the thread warrants more.
- End with a sign-off appropriate to the user's style (default: "Best,").
- Output PLAIN TEXT only. No markdown, no quoted-block, no signature beyond
  the sign-off.`

  const userMsg = `Subject: ${args.subject}

Reply to: ${args.to}

Latest thread:
${args.threadText.slice(0, 4000)}

Draft the reply.`

  const response = await tracedMessage(
    anthropic,
    {
      prompt_id: 'draft.reply',
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

  const body = response.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  const subjectWithRe = args.subject.toLowerCase().startsWith('re:')
    ? args.subject
    : `Re: ${args.subject}`

  return {
    kind: 'gmail_compose',
    to: [args.to],
    subject: subjectWithRe,
    body,
    in_reply_to_message_id: args.messageId,
    thread_id: args.threadId,
  }
}

/**
 * Load the user's communication style profile from the DB. Falls back
 * to the default when it's not yet been generated.
 */
async function loadSoul(): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('communication_style')
    .eq('id', USER_ID)
    .maybeSingle()
  if (error) return DEFAULT_SOUL
  return (data?.communication_style as string | null) || DEFAULT_SOUL
}

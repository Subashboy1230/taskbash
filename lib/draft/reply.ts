// Reply drafting — given an email thread the user owes a reply to, produce
// a draft that sounds like the user. Pulls the user's communication-style
// profile (Voice) from the users table; falls back to a sensible default
// when Voice hasn't been generated yet.
//
// The drafted text is what shows up in the approval queue's detail panel.
// The user can edit, copy, or hit Send.

import { anthropic, MODELS } from '../anthropic'
import { supabase } from '../supabase'
import { tracedMessage } from '../llm-trace'
import type { ProposedAction } from '../types'

// USER_ID resolved at call time via loadVoice(userId) — no module-level hardcode

const DEFAULT_VOICE = `You write in a direct, concise, professional style.
Emails are usually short and action-oriented, with a clear ask or next step.
Open with "Hi [Name]," and close with "Best regards,". Keep paragraphs short.`

interface DraftArgs {
  threadText: string
  subject: string
  to: string
  threadId?: string
  messageId?: string
  userName?: string
  userId?: string
  userRole?: 'to' | 'cc_only'
}

/**
 * Draft a reply to the given thread. Returns a ProposedAction ready to
 * persist on the item row.
 */
export async function draftReply(args: DraftArgs): Promise<ProposedAction> {
  const voice = await loadVoice(args.userId)

  const ccOnlyContext = args.userRole === 'cc_only'
    ? `\nIMPORTANT: The user was CC'd on this thread, not the primary recipient. They are an adjacent manager or observer who wants to weigh in. Draft the reply from THEIR perspective as a manager/colleague chiming in - not as if they were the direct report or main party in the conversation. The tone should be that of a senior stakeholder offering guidance or acknowledgment, not the person being managed or instructed.`
    : ''

  const system = `You draft email replies on behalf of a user.
You will be given the user's communication style profile and the email
thread that needs a reply. Produce ONE reply body. No subject line, no
salutation header (just "Hi <name>,"), no signature except a sign-off line.

Voice:
${voice}${ccOnlyContext}

Rules:
- Sound like the user. Match their tone, brevity, formatting habits.
- Address the latest message's points specifically. Don't restate what
  the sender wrote.
- If the sender asked questions, answer them. If the sender's email is
  ambiguous, draft a reply that clarifies what you'd need to respond fully.
- Don't invent facts you don't have. If the user's response depends on
  information you don't have, write a reply that acknowledges + commits to
  follow up.
- Keep it short. Default to 2 to 4 sentences unless the thread warrants more.
- End with a sign-off appropriate to the user's style (default: "Best,").
- Output PLAIN TEXT only. No markdown, no quoted-block, no signature beyond
  the sign-off.
- NEVER use em-dashes (—) in any output. Use a regular hyphen with spaces
  ( - ), a comma, a period, or rewrite the sentence. This rule is absolute.`

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
      user_id: args.userId ?? null,
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
async function loadVoice(userId?: string): Promise<string> {
  const uid = userId ?? process.env.APP_USER_ID
  if (!uid) return DEFAULT_VOICE
  const { data, error } = await supabase
    .from('users')
    .select('communication_style')
    .eq('id', uid)
    .maybeSingle()
  if (error) return DEFAULT_VOICE
  return (data?.communication_style as string | null) || DEFAULT_VOICE
}

// Gmail send via API — used by the Approve & Send flow on /today.
// Wraps users.messages.send through the Nango proxy.
//
// To use this, the connected Nango Gmail integration must include the
// `https://www.googleapis.com/auth/gmail.send` scope (in addition to the
// readonly scope used for extraction). If the scope is missing, the API
// call returns 403 and the caller falls back to opening Gmail compose.

import { nangoProxy } from '../nango'
import { getActiveConnection } from '../connections'
import type { ProposedAction } from '../types'

/**
 * Build a base64url-encoded RFC822 message ready for users.messages.send.
 * Sets In-Reply-To + References when this is a reply so the message threads
 * correctly in the recipient's Gmail.
 */
function encodeRfc822(args: {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  inReplyToMessageId?: string
}): string {
  const lines: string[] = []
  lines.push(`To: ${args.to.join(', ')}`)
  if (args.cc && args.cc.length > 0) lines.push(`Cc: ${args.cc.join(', ')}`)
  lines.push(`Subject: ${args.subject}`)
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=UTF-8')
  if (args.inReplyToMessageId) {
    // Both headers needed for proper threading in Gmail and other clients.
    lines.push(`In-Reply-To: ${args.inReplyToMessageId}`)
    lines.push(`References: ${args.inReplyToMessageId}`)
  }
  lines.push('') // blank line separates headers from body
  lines.push(args.body)

  // base64url (RFC 4648 §5): standard base64 with + → -, / → _, no padding.
  const utf8 = Buffer.from(lines.join('\r\n'), 'utf-8')
  return utf8
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; canFallback: boolean }

/**
 * Send the drafted reply via Gmail API. Returns ok=true with the new
 * message id on success. On failure, includes `canFallback: true` if the
 * caller should retry with the Gmail compose URL instead (e.g. missing
 * scope, transient network error).
 */
export async function sendGmailReply(
  action: Extract<ProposedAction, { kind: 'gmail_compose' | 'gmail_send' }>
): Promise<SendResult> {
  const conn = await getActiveConnection('gmail')
  if (!conn?.nango_connection_id) {
    return {
      ok: false,
      error: 'Gmail is not connected.',
      canFallback: false,
    }
  }

  const raw = encodeRfc822({
    to: action.to,
    cc: action.cc,
    subject: action.subject,
    body: action.body,
    inReplyToMessageId: action.in_reply_to_message_id,
  })

  try {
    const res = await nangoProxy<{ id?: string; threadId?: string }>({
      providerConfigKey: 'google-mail',
      connectionId: conn.nango_connection_id,
      method: 'POST',
      endpoint: '/gmail/v1/users/me/messages/send',
      data: {
        raw,
        ...(action.thread_id ? { threadId: action.thread_id } : {}),
      },
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res?.id) {
      return {
        ok: false,
        error: 'Gmail send returned no message id.',
        canFallback: true,
      }
    }
    return { ok: true, messageId: res.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 403 / insufficient scope → user needs to reconnect Gmail with the
    // send scope. Fall back to compose URL so the action isn't blocked.
    const isScope =
      /insufficient.*scope|insufficientPermissions|403|forbidden/i.test(msg)
    return {
      ok: false,
      error: msg,
      canFallback: true || isScope, // always allow fallback so the user is never stuck
    }
  }
}

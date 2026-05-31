// Gmail Drafts API integration.
// Wraps drafts.create / drafts.update / drafts.delete / drafts.send
// through the Nango proxy so we never touch raw OAuth tokens.
//
// Scope required: https://www.googleapis.com/auth/gmail.modify
// (superset of gmail.send — verify in the Nango dashboard)

import { nangoProxy } from '../nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '../connections'

// ─── MIME builder ─────────────────────────────────────────────────────

interface BuildMimeOpts {
  from: string
  to: string[]
  cc: string[]
  subject: string
  inReplyTo: string
  references: string[]
  body: string
}

function buildMime(opts: BuildMimeOpts): string {
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(', ')}`,
    ...(opts.cc.length > 0 ? [`Cc: ${opts.cc.join(', ')}`] : []),
    `Subject: ${opts.subject}`,
    `In-Reply-To: <${opts.inReplyTo}>`,
    `References: ${opts.references.slice(0, 20).map(r => `<${r}>`).join(' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ]
  return lines.join('\r\n')
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ─── Connection helper ─────────────────────────────────────────────────

async function getGmailConnection() {
  const conn = await getActiveConnection('gmail')
  if (!conn?.nango_connection_id) throw new Error('Gmail not connected')
  return { providerConfigKey: NANGO_PROVIDER_KEY.gmail!, connectionId: conn.nango_connection_id }
}

// ─── Public API ────────────────────────────────────────────────────────

export async function createGmailDraft(args: {
  fromEmail: string
  threadId: string
  inReplyTo: string
  references: string[]
  to: string[]
  cc: string[]
  subject: string
  body: string
}): Promise<{ draftId: string }> {
  const conn = await getGmailConnection()

  const mime = buildMime({
    from: args.fromEmail,
    to: args.to,
    cc: args.cc,
    subject: args.subject.startsWith('Re:') ? args.subject : `Re: ${args.subject}`,
    inReplyTo: args.inReplyTo,
    references: args.references,
    body: args.body,
  })
  const raw = base64UrlEncode(mime)

  const response = await nangoProxy<{ id: string; message: { id: string } }>({
    providerConfigKey: conn.providerConfigKey,
    connectionId: conn.connectionId,
    method: 'POST',
    endpoint: '/gmail/v1/users/me/drafts',
    data: { message: { raw, threadId: args.threadId } },
  })

  return { draftId: response.id }
}

export async function updateGmailDraft(args: {
  draftId: string
  fromEmail: string
  threadId: string
  inReplyTo: string
  references: string[]
  to: string[]
  cc: string[]
  subject: string
  body: string
}): Promise<void> {
  const conn = await getGmailConnection()

  const mime = buildMime({
    from: args.fromEmail,
    to: args.to,
    cc: args.cc,
    subject: args.subject.startsWith('Re:') ? args.subject : `Re: ${args.subject}`,
    inReplyTo: args.inReplyTo,
    references: args.references,
    body: args.body,
  })
  const raw = base64UrlEncode(mime)

  await nangoProxy({
    providerConfigKey: conn.providerConfigKey,
    connectionId: conn.connectionId,
    method: 'PUT',
    endpoint: `/gmail/v1/users/me/drafts/${args.draftId}`,
    data: { id: args.draftId, message: { raw, threadId: args.threadId } },
  })
}

export async function deleteGmailDraft(draftId: string): Promise<void> {
  try {
    const conn = await getGmailConnection()
    await nangoProxy({
      providerConfigKey: conn.providerConfigKey,
      connectionId: conn.connectionId,
      method: 'DELETE',
      endpoint: `/gmail/v1/users/me/drafts/${draftId}`,
    })
  } catch (err) {
    // Silently ignore 404 (already deleted/sent) — don't let cleanup block the main action
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes('404')) throw err
  }
}

export async function sendGmailDraft(draftId: string): Promise<{ messageId: string }> {
  const conn = await getGmailConnection()

  const response = await nangoProxy<{ id: string }>({
    providerConfigKey: conn.providerConfigKey,
    connectionId: conn.connectionId,
    method: 'POST',
    endpoint: '/gmail/v1/users/me/drafts/send',
    data: { id: draftId },
  })

  return { messageId: response.id }
}

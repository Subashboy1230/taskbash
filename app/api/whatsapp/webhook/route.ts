// Twilio webhook receiver.
//
// Twilio POSTs to this URL when:
//   - The user replies to a WhatsApp message (inbound message)
//   - A previously-sent message changes status (sent/delivered/read/failed)
//
// Two responsibilities here:
//   1. Status callbacks → update whatsapp_messages_sent.status
//   2. Inbound messages → handle STOP / START / HELP per WhatsApp policy
//
// Twilio signs every request with X-Twilio-Signature. We verify against
// our auth token to confirm the request actually came from Twilio.
//
// This endpoint is public (no Supabase auth) — set in middleware.ts.

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  const sig = req.headers.get('x-twilio-signature')
  const url = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`
    : req.url
  const raw = await req.text()
  const form = Object.fromEntries(new URLSearchParams(raw))

  // 1. Verify Twilio signature
  if (!verifyTwilioSig(sig, url, form)) {
    return new NextResponse('signature_mismatch', { status: 403 })
  }

  // 2. Branch: status callback vs inbound message
  const messageStatus = form['MessageStatus'] as string | undefined
  if (messageStatus) {
    // Status callback (sent/delivered/read/failed)
    const messageSid = form['MessageSid'] as string
    const errorCode = form['ErrorCode'] as string | undefined
    const errorMessage = form['ErrorMessage'] as string | undefined
    await sb
      .from('whatsapp_messages_sent')
      .update({
        status: messageStatus,
        error: errorCode ? `${errorCode}: ${errorMessage ?? ''}`.trim() : null,
      })
      .eq('twilio_message_sid', messageSid)
    return new NextResponse('ok', { status: 200 })
  }

  // 3. Inbound message — figure out who and handle reserved keywords
  const from = (form['From'] as string | undefined) ?? ''   // 'whatsapp:+1...'
  const body = ((form['Body'] as string | undefined) ?? '').trim()
  const e164 = from.replace(/^whatsapp:/, '')

  if (e164) {
    // Lookup user by phone number
    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('whatsapp_e164', e164)
      .maybeSingle()
    const userId = userRow?.id as string | undefined

    if (userId) {
      const upper = body.toUpperCase()
      // WhatsApp policy: STOP must immediately stop outbound messages.
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(upper)) {
        await sb
          .from('users')
          .update({
            whatsapp_morning_digest_enabled: false,
            whatsapp_meeting_reminders_enabled: false,
          })
          .eq('id', userId)
        await sb.from('agent_events').insert({
          user_id: userId,
          kind: 'whatsapp.opted_out',
          payload: { method: 'inbound_keyword', keyword: upper },
        })
        return twimlReply("You're opted out of taskbash WhatsApp messages. Reply START to opt back in.")
      }

      if (['START', 'YES', 'UNSTOP'].includes(upper)) {
        await sb
          .from('users')
          .update({
            whatsapp_morning_digest_enabled: true,
            whatsapp_meeting_reminders_enabled: true,
            whatsapp_consent_at: new Date().toISOString(),
          })
          .eq('id', userId)
        return twimlReply("Welcome back. Morning digest + meeting reminders are on. Reply STOP to opt out.")
      }

      if (upper === 'HELP') {
        return twimlReply(
          "taskbash WhatsApp: morning digest at 9am, meeting reminders 10 min before. " +
          "Reply STOP to opt out, START to opt back in. " +
          "Manage at taskbash.app/settings/whatsapp"
        )
      }
    }
  }

  // 4. Default: log the inbound message and ack (no auto-reply outside the
  //    24-hour service window — Twilio uses TwiML to ack).
  if (e164) {
    await sb.from('agent_events').insert({
      user_id: null,  // unknown user
      kind: 'whatsapp.inbound_unhandled',
      payload: { from: e164, body: body.slice(0, 500) },
    })
  }
  return new NextResponse('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// GET is for ad-hoc health checks
export function GET() {
  return NextResponse.json({ ok: true, endpoint: 'whatsapp-webhook' })
}

// ─── Helpers ──────────────────────────────────────────────────────────

function verifyTwilioSig(sig: string | null, url: string, form: Record<string, string>): boolean {
  if (!sig) return false
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return false
  // Twilio signature spec: HMAC-SHA1(authToken, url + sorted form k+v concat),
  // base64-encoded. https://www.twilio.com/docs/usage/webhooks/webhooks-security
  const keys = Object.keys(form).sort()
  let payload = url
  for (const k of keys) payload += k + form[k]
  const expected = createHmac('sha1', authToken).update(payload).digest('base64')
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

function twimlReply(text: string): NextResponse {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const body = `<Response><Message>${escaped}</Message></Response>`
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

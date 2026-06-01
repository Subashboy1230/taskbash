// WhatsApp via Twilio Content API.
//
// We talk to Twilio, Twilio talks to Meta. Outbound messages must use a
// Meta-approved template (Content SID). Variables are filled at send time.
//
// Required env:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM        e.g. 'whatsapp:+14155551234'
//   TWILIO_TEMPLATE_MORNING_DIGEST_SID   'HX...'  (set after Meta approval)
//   TWILIO_TEMPLATE_MEETING_REMINDER_SID 'HX...'  (set after Meta approval)

import { supabase } from './supabase'

// ─── Twilio types we use ─────────────────────────────────────────────
interface TwilioSendResponse {
  sid: string        // Twilio Message SID, e.g. 'SM...' or 'MM...'
  status: string     // 'queued' | 'sent' | 'delivered' | 'failed' | …
  error_code?: number
  error_message?: string
}

// ─── Public API ──────────────────────────────────────────────────────

export type TemplateName = 'morning_digest' | 'meeting_reminder'

export interface SendTemplateArgs {
  userId: string
  /** E.164 with `+` prefix. e.g. `+14155551234` */
  toE164: string
  template: TemplateName
  /** Variables filled into the template, keyed by Twilio's `{{1}}`, `{{2}}`, etc. */
  variables: Record<string, string>
  /** Idempotency key. Same key twice = single send. e.g. `morning_digest:2026-06-01` */
  dedupKey: string
}

export interface SendTemplateResult {
  ok: boolean
  duplicate?: boolean
  twilioSid?: string
  error?: string
}

/**
 * Send a WhatsApp template via Twilio. Idempotent on (userId, dedupKey).
 *
 * Flow:
 *   1. Check whatsapp_messages_sent for (user, dedup) — return early if seen.
 *   2. Resolve Content SID for the template from env.
 *   3. POST to Twilio Content API.
 *   4. Persist a row whether send succeeded or failed (with status + error).
 *
 * Never throws — returns { ok: false, error } so the caller can decide.
 */
export async function sendTemplate(args: SendTemplateArgs): Promise<SendTemplateResult> {
  const { userId, toE164, template, variables, dedupKey } = args

  // 1. Idempotency check
  const { data: existing } = await supabase
    .from('whatsapp_messages_sent')
    .select('id, twilio_message_sid, status')
    .eq('user_id', userId)
    .eq('dedup_key', dedupKey)
    .maybeSingle()
  if (existing) {
    return { ok: true, duplicate: true, twilioSid: existing.twilio_message_sid ?? undefined }
  }

  // 2. Resolve template SID + Twilio creds
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  const fromAddr   = process.env.TWILIO_WHATSAPP_FROM  // 'whatsapp:+1...'
  const templateSid =
    template === 'morning_digest'
      ? process.env.TWILIO_TEMPLATE_MORNING_DIGEST_SID
      : process.env.TWILIO_TEMPLATE_MEETING_REMINDER_SID
  if (!accountSid || !authToken || !fromAddr || !templateSid) {
    return { ok: false, error: `Twilio env missing (account=${!!accountSid}, token=${!!authToken}, from=${!!fromAddr}, template=${!!templateSid})` }
  }

  const toAddr = `whatsapp:${toE164}`

  // 3. POST to Twilio Messages API
  // Twilio's Content API uses two params: ContentSid + ContentVariables.
  const body = new URLSearchParams()
  body.set('From', fromAddr)
  body.set('To', toAddr)
  body.set('ContentSid', templateSid)
  body.set('ContentVariables', JSON.stringify(variables))
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  if (messagingServiceSid) {
    // Optional — if user uses a Messaging Service, prefer that over From.
    body.delete('From')
    body.set('MessagingServiceSid', messagingServiceSid)
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  let twilioRes: TwilioSendResponse | null = null
  let sendError: string | null = null
  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    )
    const json = (await resp.json()) as TwilioSendResponse & { code?: number; message?: string }
    if (!resp.ok) {
      sendError = json.message ?? json.error_message ?? `Twilio ${resp.status}`
    } else {
      twilioRes = json
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err)
  }

  // 4. Persist (success OR failure) — log everything for audit
  const { error: insertErr } = await supabase
    .from('whatsapp_messages_sent')
    .insert({
      user_id: userId,
      kind: template === 'morning_digest' ? 'morning_digest' : 'meeting_reminder',
      dedup_key: dedupKey,
      template_name: template,
      template_sid: templateSid,
      twilio_message_sid: twilioRes?.sid ?? null,
      variables,
      status: twilioRes ? (twilioRes.status ?? 'sent') : 'failed',
      error: sendError,
    })
  if (insertErr) {
    // The send may have gone through but we couldn't log it. Surface but don't fail.
    console.error('[whatsapp] log insert failed:', insertErr.message)
  }

  if (sendError) return { ok: false, error: sendError }
  return { ok: true, twilioSid: twilioRes?.sid }
}

// ─── Quiet-hours helper ──────────────────────────────────────────────
// "HH:MM" → minutes since midnight
function toMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

export interface QuietHoursCheck {
  timezone: string         // IANA, e.g. 'America/Los_Angeles'
  quietBefore: string      // 'HH:MM'
  quietAfter: string       // 'HH:MM'
  now?: Date               // for testing
}

/** Returns true when the local time at `timezone` is INSIDE the quiet window. */
export function isInsideQuietHours(opts: QuietHoursCheck): boolean {
  const now = opts.now ?? new Date()
  // Get local HH:MM in the user's timezone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: opts.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hh = parts.find(p => p.type === 'hour')?.value ?? '00'
  const mm = parts.find(p => p.type === 'minute')?.value ?? '00'
  const nowMin = parseInt(hh, 10) * 60 + parseInt(mm, 10)
  const beforeMin = toMin(opts.quietBefore)
  const afterMin = toMin(opts.quietAfter)
  // Quiet hours wrap around midnight, e.g. 22:00 to 06:30.
  return nowMin < beforeMin || nowMin >= afterMin
}

// ─── User helper ─────────────────────────────────────────────────────
// Returns null when the user hasn't configured WhatsApp.

export interface WhatsAppSettings {
  userId: string
  e164: string
  timezone: string
  quietBefore: string
  quietAfter: string
  digestTimeLocal: string
  morningDigestEnabled: boolean
  meetingRemindersEnabled: boolean
  consentAt: string | null
}

export async function getWhatsAppSettings(userId: string): Promise<WhatsAppSettings | null> {
  const { data } = await supabase
    .from('users')
    .select(`
      id,
      whatsapp_e164,
      whatsapp_consent_at,
      whatsapp_morning_digest_enabled,
      whatsapp_meeting_reminders_enabled,
      whatsapp_digest_time_local,
      whatsapp_quiet_before,
      whatsapp_quiet_after,
      timezone
    `)
    .eq('id', userId)
    .maybeSingle()
  if (!data || !data.whatsapp_e164 || !data.whatsapp_consent_at) return null
  return {
    userId: data.id as string,
    e164: data.whatsapp_e164 as string,
    timezone: (data.timezone as string) || 'America/Los_Angeles',
    quietBefore: (data.whatsapp_quiet_before as string) || '06:30',
    quietAfter: (data.whatsapp_quiet_after as string) || '22:00',
    digestTimeLocal: (data.whatsapp_digest_time_local as string) || '09:00',
    morningDigestEnabled: !!data.whatsapp_morning_digest_enabled,
    meetingRemindersEnabled: !!data.whatsapp_meeting_reminders_enabled,
    consentAt: (data.whatsapp_consent_at as string) ?? null,
  }
}

// Server actions for /settings/whatsapp.

'use server'

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { resolveUserId } from '@/lib/supabase-server'

const E164_RE = /^\+[1-9]\d{6,14}$/

export interface SaveWhatsAppArgs {
  e164: string
  morningDigestEnabled: boolean
  meetingRemindersEnabled: boolean
  digestTimeLocal: string   // 'HH:MM'
  quietBefore: string       // 'HH:MM'
  quietAfter: string        // 'HH:MM'
  timezone: string          // IANA
}

export async function saveWhatsAppSettings(
  args: SaveWhatsAppArgs
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()

    if (!E164_RE.test(args.e164)) {
      return { ok: false, error: 'Phone must be E.164 format with + (e.g. +14155551234).' }
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.digestTimeLocal)) {
      return { ok: false, error: 'Digest time must be HH:MM.' }
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.quietBefore) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.quietAfter)) {
      return { ok: false, error: 'Quiet hours must be HH:MM.' }
    }
    // Verify timezone is a valid IANA zone
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: args.timezone }).format(new Date())
    } catch {
      return { ok: false, error: `Unknown timezone: ${args.timezone}` }
    }

    const consentAt = (args.morningDigestEnabled || args.meetingRemindersEnabled)
      ? new Date().toISOString()
      : null

    const { error } = await supabase
      .from('users')
      .update({
        whatsapp_e164: args.e164,
        whatsapp_consent_at: consentAt,
        whatsapp_morning_digest_enabled: args.morningDigestEnabled,
        whatsapp_meeting_reminders_enabled: args.meetingRemindersEnabled,
        whatsapp_digest_time_local: args.digestTimeLocal,
        whatsapp_quiet_before: args.quietBefore,
        whatsapp_quiet_after: args.quietAfter,
        timezone: args.timezone,
      })
      .eq('id', userId)
    if (error) return { ok: false, error: error.message }

    revalidatePath('/settings/whatsapp')
    return { ok: true }
  } catch (err) {
    console.error('[saveWhatsAppSettings]', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function disconnectWhatsApp(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()
    const { error } = await supabase
      .from('users')
      .update({
        whatsapp_e164: null,
        whatsapp_consent_at: null,
        whatsapp_morning_digest_enabled: false,
        whatsapp_meeting_reminders_enabled: false,
      })
      .eq('id', userId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/settings/whatsapp')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Send a test morning digest to the user right now (queues an Inngest event). */
export async function sendTestDigest(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()
    const { inngest } = await import('@/inngest/client')
    // Fire-and-forget the test directly to the morning-digest function. The
    // function will idempotency-check whatsapp_messages_sent with the day's
    // dedup, so the test still counts as that day's digest.
    await inngest.send({
      name: 'whatsapp/morning-digest.requested',
      data: { userId, manual: true },
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

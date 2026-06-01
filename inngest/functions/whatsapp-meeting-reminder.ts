// WhatsApp 10-minute pre-meeting reminder.
//
// Event-triggered (not cron). Receives { userId, itemId }, loads the meeting,
// looks up the prep brief from items.brief (existing meeting-prep feature),
// formats the template variables, sends via Twilio.
//
// Template variables (must match Meta-approved 'meeting_reminder' template):
//   {{1}} = meeting_title       e.g. "Sigiq.ai x NationGraph"
//   {{2}} = time_range          e.g. "9:00 - 9:30 AM PT"
//   {{3}} = attendees           e.g. "luke@nationgraph.com, josh@nationgraph.com"
//   {{4}} = prep_summary        first ~200 chars of items.brief, or "" if absent

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import { sendTemplate, getWhatsAppSettings } from '@/lib/whatsapp'

export const whatsappMeetingReminder = inngest.createFunction(
  { id: 'whatsapp-meeting-reminder', name: 'WhatsApp meeting reminder · event-triggered' },
  [{ event: EVENTS.whatsappMeetingReminderRequested }],
  async ({ event, step, logger }) => {
    const { userId, itemId } = event.data as { userId: string; itemId: string }

    // Load meeting + WhatsApp settings in parallel
    const [meeting, settings] = await Promise.all([
      step.run('load-meeting', async () => {
        const { data, error } = await supabase
          .from('items')
          .select('id, title, due_at, source_ref, brief, parent_context')
          .eq('id', itemId)
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw new Error(`load meeting: ${error.message}`)
        return data
      }),
      step.run('load-settings', () => getWhatsAppSettings(userId)),
    ])

    if (!meeting || !meeting.due_at) {
      logger.warn(`Meeting ${itemId} not found or missing due_at`)
      return { sent: false, reason: 'meeting_missing' }
    }
    if (!settings) {
      logger.warn(`User ${userId} has no WhatsApp settings`)
      return { sent: false, reason: 'no_settings' }
    }

    // Format times
    const start = new Date(meeting.due_at as string)
    const sourceRef = (meeting.source_ref ?? {}) as Record<string, unknown>
    const endIso = (sourceRef.end_time as string | undefined)
      ?? new Date(start.getTime() + 30 * 60 * 1000).toISOString()
    const end = new Date(endIso)

    const timeFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    const tzAbbrev = abbreviateTz(settings.timezone)
    const timeRange = `${timeFmt.format(start)} - ${timeFmt.format(end)} ${tzAbbrev}`

    // Attendees from calendar source_ref.attendees if present
    const attendeeList = (sourceRef.attendees as Array<{ email?: string; name?: string }> | undefined) ?? []
    const attendees = attendeeList
      .slice(0, 5)
      .map(a => a.name ?? a.email ?? '')
      .filter(Boolean)
      .join(', ')
      || 'no attendees listed'

    // Prep summary: first ~200 chars of brief, or empty.
    const prepFull = (meeting.brief as string | null) ?? ''
    const prepSummary = prepFull.length > 0
      ? truncate(stripMarkdown(prepFull), 220)
      : 'No prep brief generated.'

    const variables: Record<string, string> = {
      '1': truncate(meeting.title as string, 60),
      '2': timeRange,
      '3': truncate(attendees, 100),
      '4': prepSummary,
    }

    const result = await step.run('send', async () => {
      return sendTemplate({
        userId,
        toE164: settings.e164,
        template: 'meeting_reminder',
        variables,
        dedupKey: `meeting_reminder:${itemId}`,
      })
    })

    if (!result.ok) {
      logger.error(`[whatsapp/meeting] send failed: ${result.error}`)
      await supabase.from('agent_events').insert({
        user_id: userId,
        kind: 'whatsapp.send_failed',
        payload: {
          template: 'meeting_reminder',
          error: result.error,
          itemId,
        },
      })
    }

    return { sent: result.ok, duplicate: !!result.duplicate, twilioSid: result.twilioSid }
  }
)

// ─── Helpers ──────────────────────────────────────────────────────────

function abbreviateTz(tz: string): string {
  // Map a few common IANA zones to compact labels. Falls back to GMT offset.
  if (tz.startsWith('America/Los_Angeles')) return 'PT'
  if (tz.startsWith('America/Denver')) return 'MT'
  if (tz.startsWith('America/Chicago')) return 'CT'
  if (tz.startsWith('America/New_York')) return 'ET'
  if (tz === 'UTC') return 'UTC'
  // Last resort: short timezone name as Intl would format it.
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    return tz
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'
}

function stripMarkdown(s: string): string {
  // Crude single-pass markdown → plain text. Drops headers, bold, links.
  return s
    .replace(/^#+\s*/gm, '')                  // headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // bold
    .replace(/\*([^*]+)\*/g, '$1')            // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links → just the text
    .replace(/`([^`]+)`/g, '$1')              // inline code
    .replace(/^\s*[-*+]\s+/gm, '')            // bullet markers
    .replace(/\n{2,}/g, '\n')                 // collapse blank lines
    .trim()
}

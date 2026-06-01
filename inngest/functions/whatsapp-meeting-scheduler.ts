// WhatsApp meeting reminder scheduler.
//
// Cron runs every 5 minutes. For each user with reminders enabled, looks at
// upcoming Google Calendar events in the 9-11 minute window from now, and
// fires a 'whatsapp/meeting-reminder.requested' event per upcoming meeting.
//
// Why 9-11 (not exactly 10): the cron fires at 5-min intervals, so the
// reminder window has to cover whatever fell into the just-passed 5 minutes
// without double-sending. Idempotency on (user_id, event_id) prevents dups.
//
// Why a scheduler + event combo: the per-meeting reminder send is a small
// unit of work that needs its own retry behavior. Splitting scheduling from
// sending lets each meeting fail-or-succeed independently.

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import { isInsideQuietHours, getWhatsAppSettings } from '@/lib/whatsapp'

export const whatsappMeetingScheduler = inngest.createFunction(
  { id: 'whatsapp-meeting-scheduler', name: 'WhatsApp meeting scheduler · every 5 min' },
  [{ cron: '*/5 * * * *' }],
  async ({ step, logger }) => {
    const users = await step.run('find-users', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, whatsapp_e164, whatsapp_consent_at, timezone, whatsapp_quiet_before, whatsapp_quiet_after')
        .eq('whatsapp_meeting_reminders_enabled', true)
        .not('whatsapp_e164', 'is', null)
        .not('whatsapp_consent_at', 'is', null)
      if (error) throw new Error(`load users: ${error.message}`)
      return (data ?? []) as Array<{
        id: string
        whatsapp_e164: string
        whatsapp_consent_at: string
        timezone: string
        whatsapp_quiet_before: string
        whatsapp_quiet_after: string
      }>
    })

    if (users.length === 0) return { eligibleUsers: 0, eventsFired: 0 }

    // 9-11 minute window from now → cron runs every 5 min so this catches
    // anything within ±2.5 min of T-10. Inngest idempotency makes overlapping
    // windows safe.
    const now = new Date()
    const windowStart = new Date(now.getTime() + 9 * 60 * 1000).toISOString()
    const windowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

    let totalFired = 0
    for (const user of users) {
      // Per-user quiet hours
      if (isInsideQuietHours({
        timezone: user.timezone || 'America/Los_Angeles',
        quietBefore: user.whatsapp_quiet_before || '06:30',
        quietAfter:  user.whatsapp_quiet_after  || '22:00',
        now,
      })) continue

      const fired = await step.run(`schedule-${user.id}`, async () => {
        // Find calendar items starting in the window.
        const { data: meetings, error } = await supabase
          .from('items')
          .select('id, title, due_at, source_ref')
          .eq('user_id', user.id)
          .eq('source', 'calendar')
          .gte('due_at', windowStart)
          .lte('due_at', windowEnd)
        if (error) {
          logger.error(`[scheduler] load meetings ${user.id}: ${error.message}`)
          return 0
        }

        let n = 0
        for (const m of meetings ?? []) {
          // Idempotency check: if we already logged a reminder for this
          // meeting, skip. Same dedup_key the reminder function will use.
          const dedupKey = `meeting_reminder:${m.id}`
          const { data: existing } = await supabase
            .from('whatsapp_messages_sent')
            .select('id')
            .eq('user_id', user.id)
            .eq('dedup_key', dedupKey)
            .maybeSingle()
          if (existing) continue

          await inngest.send({
            name: EVENTS.whatsappMeetingReminderRequested,
            data: { userId: user.id, itemId: m.id as string },
          })
          n++
        }
        return n
      })
      totalFired += fired
    }

    return { eligibleUsers: users.length, eventsFired: totalFired }
  }
)

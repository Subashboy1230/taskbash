// WhatsApp morning digest.
//
// Runs every hour on the hour. For each user whose `whatsapp_digest_time_local`
// matches the current local-time hour AND who has opted in, builds the digest
// payload and ships it as a Meta-approved template via Twilio.
//
// Why hourly: users can set digest_time anywhere from '06:00' to '11:00' and
// across timezones. An hourly cron + per-user TZ resolution is the cleanest
// way to support any digest_time without per-user cron registration.
//
// Template variables (must match Meta-approved 'morning_digest' template):
//   {{1}} = first_name
//   {{2}} = date_long       — "Mon Jun 1"
//   {{3}} = p0_count
//   {{4}} = p1_count
//   {{5}} = unread_count
//   {{6}} = next_meeting    — "9:00 AM Sigiq.ai x NationGraph" or "no meetings today"
//   {{7}} = top_tasks       — "1) X. 2) Y. 3) Z."
//
// To trigger manually:
//   inngest.send({ name: 'whatsapp/morning-digest.requested' })

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import {
  sendTemplate,
  isInsideQuietHours,
  getWhatsAppSettings,
} from '@/lib/whatsapp'

const TOP_TASKS_MAX = 3

export const whatsappMorningDigest = inngest.createFunction(
  { id: 'whatsapp-morning-digest', name: 'WhatsApp morning digest · hourly' },
  [
    // Every hour at :00. Per-user TZ + digest_time match handled below.
    { cron: '0 * * * *' },
    { event: EVENTS.whatsappMorningDigestRequested },
  ],
  async ({ step, logger }) => {
    // ─── 1. Find users who want a digest right now ────────────────────
    const eligibleUsers = await step.run('find-eligible-users', async () => {
      const { data: rows, error } = await supabase
        .from('users')
        .select('id, whatsapp_digest_time_local, timezone, whatsapp_quiet_before, whatsapp_quiet_after')
        .eq('whatsapp_morning_digest_enabled', true)
        .not('whatsapp_e164', 'is', null)
        .not('whatsapp_consent_at', 'is', null)
      if (error) throw new Error(`load users: ${error.message}`)

      const now = new Date()
      const matches: string[] = []
      for (const r of rows ?? []) {
        const tz = (r.timezone as string) || 'America/Los_Angeles'
        const digestTime = (r.whatsapp_digest_time_local as string) || '09:00'
        // Compare HH only — minute always 0 because cron fires on the hour.
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hour: '2-digit', hour12: false,
        })
        const localHourStr = fmt.formatToParts(now).find(p => p.type === 'hour')?.value ?? ''
        const targetHourStr = digestTime.split(':')[0]
        if (parseInt(localHourStr, 10) !== parseInt(targetHourStr, 10)) continue

        if (isInsideQuietHours({
          timezone: tz,
          quietBefore: (r.whatsapp_quiet_before as string) || '06:30',
          quietAfter:  (r.whatsapp_quiet_after as string)  || '22:00',
          now,
        })) continue

        matches.push(r.id as string)
      }
      return matches
    })

    if (eligibleUsers.length === 0) {
      logger.info('No users eligible for digest this hour.')
      return { eligible: 0, sent: 0 }
    }

    logger.info(`Sending morning digest to ${eligibleUsers.length} user(s)`)

    // ─── 2. Per-user digest send ──────────────────────────────────────
    let sentCount = 0
    for (const userId of eligibleUsers) {
      await step.run(`send-${userId}`, async () => {
        const settings = await getWhatsAppSettings(userId)
        if (!settings) return

        // Build digest payload
        const today = ymdInTz(new Date(), settings.timezone)
        const variables = await buildDigestVariables(userId, settings.timezone)
        const dedupKey = `morning_digest:${today}`

        const result = await sendTemplate({
          userId,
          toE164: settings.e164,
          template: 'morning_digest',
          variables,
          dedupKey,
        })
        if (result.ok && !result.duplicate) sentCount++
        if (!result.ok) {
          logger.error(`[whatsapp/digest] send failed for ${userId}: ${result.error}`)
          // Write an agent_event so it shows up in /activity
          await supabase.from('agent_events').insert({
            user_id: userId,
            kind: 'whatsapp.send_failed',
            payload: { template: 'morning_digest', error: result.error, dedup: dedupKey },
          })
        }
      })
    }

    return { eligible: eligibleUsers.length, sent: sentCount }
  }
)

// ─── Helpers ──────────────────────────────────────────────────────────

function ymdInTz(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  // en-CA gives YYYY-MM-DD
  return fmt.format(d)
}

function dateLongInTz(d: Date, tz: string): string {
  // "Mon Jun 1"
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
  })
  return fmt.format(d).replace(',', '')
}

function timeShortInTz(d: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return fmt.format(d)
}

async function buildDigestVariables(userId: string, tz: string): Promise<Record<string, string>> {
  // First name from auth user (best effort)
  const { data: authUser } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  const firstName = (authUser?.email as string | undefined)?.split('@')[0]?.split(/[._-]/)[0]
    ?.replace(/^./, c => c.toUpperCase()) ?? 'there'

  const now = new Date()
  const dateLong = dateLongInTz(now, tz)

  // Counts + top tasks from items
  const { data: openItems } = await supabase
    .from('items')
    .select('id, title, priority, tag')
    .eq('user_id', userId)
    .eq('status', 'open')
    .is('parent_id', null)
  const openRows = (openItems ?? []) as Array<{ id: string; title: string; priority: string | null; tag: string | null }>

  const p0 = openRows.filter(r => r.priority === 'P0').length
  const p1 = openRows.filter(r => r.priority === 'P1').length

  // Top 3 tasks: P0 first, then P1, then untagged P-
  const topRows = openRows
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, TOP_TASKS_MAX)
  const topTasks = topRows.length === 0
    ? 'No open tasks.'
    : topRows.map((r, i) => `${i + 1}) ${truncate(r.title, 60)}`).join('. ') + '.'

  // Unread count: Gmail threads unread today. Fall back to 0 if no source.
  // Items where source='gmail' and not yet acted on. Conservative — uses
  // gmail_sync_state if available, otherwise just a 0.
  const { data: unreadRows } = await supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'open')
    .eq('source', 'gmail')
    .eq('tag', 'fyi')
  const unread = unreadRows ? 0 : 0  // placeholder; gmail_sync_state read can be added later

  // Next meeting today (calendar source, due_at = today)
  const todayStart = startOfDayInTz(now, tz).toISOString()
  const todayEnd   = endOfDayInTz(now, tz).toISOString()
  const { data: meetings } = await supabase
    .from('items')
    .select('id, title, due_at')
    .eq('user_id', userId)
    .eq('source', 'calendar')
    .gte('due_at', todayStart)
    .lte('due_at', todayEnd)
    .order('due_at', { ascending: true })
    .limit(1)
  let nextMeeting = 'no meetings today'
  const firstMeeting = meetings?.[0]
  if (firstMeeting?.due_at) {
    const when = timeShortInTz(new Date(firstMeeting.due_at as string), tz)
    nextMeeting = `${when} ${truncate(firstMeeting.title as string, 40)}`
  }

  return {
    '1': firstName,
    '2': dateLong,
    '3': String(p0),
    '4': String(p1),
    '5': String(unread),
    '6': nextMeeting,
    '7': topTasks,
  }
}

function priorityRank(p: string | null): number {
  switch (p) {
    case 'P0': return 0
    case 'P1': return 1
    case 'P2': return 2
    case 'P3': return 3
    default:   return 4
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'
}

function startOfDayInTz(d: Date, tz: string): Date {
  const ymd = ymdInTz(d, tz)
  // Naive: midnight in tz. Build via formatted parts.
  return new Date(`${ymd}T00:00:00`)
}

function endOfDayInTz(d: Date, tz: string): Date {
  const ymd = ymdInTz(d, tz)
  return new Date(`${ymd}T23:59:59`)
}

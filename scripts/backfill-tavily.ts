// scripts/backfill-tavily.ts
//
// Backfill source_ref.attendee_context on existing calendar prep items
// that were extracted before the Tavily integration shipped.
//
// Usage:
//   npx tsx scripts/backfill-tavily.ts
//
// Strategy:
//   1. Find open calendar prep items in the next 48 hours with no
//      attendee_context.
//   2. For each, re-fetch the underlying Google Calendar event via Nango
//      to get the attendee email list (we don't store emails on items).
//   3. Run enrichAttendees against Tavily.
//   4. Patch source_ref.attendee_context in place.
//
// Safe to re-run: only updates rows where attendee_context is null.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local')
  const txt = readFileSync(p, 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (!process.env[k]) process.env[k] = v.trim()
  }
}

interface CalendarAttendee {
  email?: string
  displayName?: string
  self?: boolean
  responseStatus?: string
}

interface CalendarEvent {
  attendees?: CalendarAttendee[]
}

async function main() {
  loadEnv()

  const { supabase } = await import('@/lib/supabase')
  const { nangoProxy } = await import('@/lib/nango')
  const { getActiveConnection, NANGO_PROVIDER_KEY } = await import('@/lib/connections')
  const { enrichAttendees } = await import('@/lib/enrich/tavily')

  console.log('--- Tavily backfill for existing calendar prep items ---')

  const userEmail = process.env.APP_USER_EMAIL || 'subash@sigiq.ai'
  const userId = process.env.APP_USER_ID
  if (!userId) {
    console.error('APP_USER_ID missing in env.')
    process.exit(1)
  }

  // Step 1: find candidates.
  const { data: items, error } = await supabase
    .from('items')
    .select('id, title, source_ref')
    .eq('user_id', userId)
    .eq('source', 'calendar')
    .eq('task_type', 'context_prep')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Supabase fetch failed:', error.message)
    process.exit(2)
  }
  if (!items || items.length === 0) {
    console.log('No open calendar prep items found.')
    return
  }

  // Filter to future, no-Tavily-yet candidates client-side.
  const now = Date.now()
  const candidates = items.filter(it => {
    const ref = it.source_ref as Record<string, unknown> | null
    if (!ref) return false
    const startIso = ref['google_calendar_event_start'] as string | undefined
    if (!startIso) return false
    if (Date.parse(startIso) < now) return false
    if (ref['attendee_context']) return false
    return true
  })

  console.log(`Found ${candidates.length} candidates (open, future, no Tavily yet).`)
  console.log('')

  // Step 2: get the Calendar connection.
  const conn = await getActiveConnection('calendar', userId)
  if (!conn?.nango_connection_id) {
    console.error('No active Calendar connection.')
    process.exit(3)
  }
  const providerConfigKey = NANGO_PROVIDER_KEY.calendar!
  const connectionId = conn.nango_connection_id

  let success = 0
  let failed = 0
  let skipped = 0

  for (const item of candidates) {
    const ref = item.source_ref as Record<string, unknown>
    const eventId = ref['google_calendar_event_id'] as string
    if (!eventId) {
      skipped++
      continue
    }

    process.stdout.write(`[${item.id.slice(0, 8)}] ${(item.title as string).slice(0, 60)}... `)

    try {
      // Fetch the event
      const event = await nangoProxy<CalendarEvent>({
        providerConfigKey,
        connectionId,
        method: 'GET',
        endpoint: `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      })
      const lowerSelf = userEmail.toLowerCase()
      const externalAttendees = (event.attendees ?? [])
        .filter(a => !a.self && a.email && a.email.toLowerCase() !== lowerSelf)

      if (externalAttendees.length === 0) {
        process.stdout.write('no external attendees, skipping\n')
        skipped++
        continue
      }

      const pairs = externalAttendees.map(a => ({
        email: a.email!,
        name: a.displayName ?? null,
      }))
      const attendee_context = await enrichAttendees(pairs)

      if (attendee_context.length === 0) {
        process.stdout.write('Tavily returned nothing\n')
        skipped++
        continue
      }

      // Patch source_ref
      const newRef = { ...ref, attendee_context }
      const { error: updErr } = await supabase
        .from('items')
        .update({ source_ref: newRef })
        .eq('id', item.id)
      if (updErr) {
        process.stdout.write(`UPDATE failed: ${updErr.message}\n`)
        failed++
        continue
      }
      process.stdout.write(`OK (${attendee_context.length} attendee blurbs)\n`)
      success++
    } catch (err) {
      process.stdout.write(`THREW: ${err instanceof Error ? err.message : err}\n`)
      failed++
    }
  }

  console.log('')
  console.log(`Done. success=${success} failed=${failed} skipped=${skipped}`)
}

main().catch(err => {
  console.error('main() threw:', err instanceof Error ? err.stack : err)
  process.exit(99)
})

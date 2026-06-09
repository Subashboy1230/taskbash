// Lightweight server loader for today's Google Calendar events.
// Used by the /today right-column calendar widget — NO LLM, no extraction.
// Just the raw event list with summary + start/end times.
//
// Best-effort: returns [] if Calendar isn't connected so the UI stays
// usable even before the user wires up Google Calendar.

import { nangoProxy } from './nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from './connections'

export interface DayEvent {
  id: string
  summary: string
  startIso: string
  endIso: string
  // 'HH:MM' formatted in user's local TZ (server-rendered uses UTC; we
  // could pass through the raw ISO and format client-side instead).
  startTime: string
  endTime: string
  // Whole-day events have no specific time.
  isAllDay: boolean
  // True for events you marked yourself as the organizer or only attendee.
  isSolo: boolean
  hangoutLink?: string | null
}

const CALENDAR_API = '/calendar/v3/calendars/primary/events'

/**
 * Result of a today-events load that DISTINGUISHES a real fetch failure
 * from a genuinely-empty calendar. `failed: true` means the fetch threw
 * (Nango/Calendar/Supabase error); `failed: false` with an empty list
 * means "no events" or "Calendar not connected" (the latter is surfaced
 * separately via the `calendarConnected` flag in the UI).
 */
export interface TodayEventsResult {
  events: DayEvent[]
  failed: boolean
}

/**
 * Fetch today's events (00:00 -> 23:59 in the server's TZ), reporting
 * whether the fetch failed so the right-column widget can show a real
 * error + Retry instead of a misleading "No events scheduled today".
 * Returns failed: false with an empty list when Calendar isn't connected.
 */
export async function loadTodayEventsResult(): Promise<TodayEventsResult> {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  try {
    return { events: await fetchEventsForDate(iso), failed: false }
  } catch (err) {
    console.error('[loadTodayEventsResult] failed:', err)
    return { events: [], failed: true }
  }
}

/**
 * Fetch today's events. Backward-compatible thin wrapper that drops the
 * failure flag and returns just the list ([] on any error). Prefer
 * loadTodayEventsResult when the caller can surface a load failure.
 */
export async function loadTodayEvents(): Promise<DayEvent[]> {
  return (await loadTodayEventsResult()).events
}

/**
 * Fetch events for any YYYY-MM-DD day in the user's primary Google Calendar.
 * Used by the right-column widget when the user clicks a non-today date.
 * Best-effort: swallows errors to [] (the on-demand panel has its own
 * loading/error UI). Prefer fetchEventsForDate when you need the throw.
 */
export async function loadEventsForDate(yyyymmdd: string): Promise<DayEvent[]> {
  try {
    return await fetchEventsForDate(yyyymmdd)
  } catch (err) {
    console.error('[loadEventsForDate] failed:', err)
    return []
  }
}

/**
 * Core fetch. Returns [] when Calendar isn't connected (NOT a failure),
 * but THROWS on a real error so callers can distinguish the two. The
 * public wrappers above decide whether to swallow or surface the throw.
 */
async function fetchEventsForDate(yyyymmdd: string): Promise<DayEvent[]> {
    const conn = await getActiveConnection('calendar')
    if (!conn?.nango_connection_id) return []
    const providerConfigKey = NANGO_PROVIDER_KEY.calendar
    if (!providerConfigKey) return []

    // Parse the day in the local server TZ. We DON'T want UTC midnight
    // because Calendar treats date boundaries in the user's TZ.
    const [y, m, d] = yyyymmdd.split('-').map(Number)
    if (!y || !m || !d) return []
    const start = new Date(y, m - 1, d, 0, 0, 0, 0)
    const end = new Date(y, m - 1, d, 23, 59, 59, 999)

    interface RawEvent {
      id: string
      summary?: string
      status?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      attendees?: Array<{ self?: boolean; email?: string }>
      hangoutLink?: string
    }
    interface Response {
      items?: RawEvent[]
    }

    const response = await nangoProxy<Response>({
      providerConfigKey,
      connectionId: conn.nango_connection_id,
      method: 'GET',
      endpoint: CALENDAR_API,
      params: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '40',
      },
    })

    const events = response.items ?? []
    return events
      .filter(e => e.status !== 'cancelled')
      .map((e): DayEvent => {
        const startIso = e.start?.dateTime || e.start?.date || ''
        const endIso = e.end?.dateTime || e.end?.date || startIso
        const isAllDay = !!e.start?.date && !e.start?.dateTime
        const attendees = e.attendees ?? []
        const isSolo = attendees.length <= 1
        const formatTime = (iso: string) => {
          if (!iso || isAllDay) return ''
          const d = new Date(iso)
          if (isNaN(d.getTime())) return ''
          return d.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles',
          })
        }
        return {
          id: e.id,
          summary: e.summary || '(no title)',
          startIso,
          endIso,
          startTime: formatTime(startIso),
          endTime: formatTime(endIso),
          isAllDay,
          isSolo,
          hangoutLink: e.hangoutLink ?? null,
        }
      })
}

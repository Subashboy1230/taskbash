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
 * Fetch today's events (00:00 → 23:59 in the server's TZ). Returns []
 * if Calendar isn't connected. Failures are swallowed — never let
 * the right-column widget block the main /today view.
 */
export async function loadTodayEvents(): Promise<DayEvent[]> {
  try {
    const conn = await getActiveConnection('calendar')
    if (!conn?.nango_connection_id) return []
    const providerConfigKey = NANGO_PROVIDER_KEY.calendar
    if (!providerConfigKey) return []

    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)

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
  } catch (err) {
    console.error('[loadTodayEvents] failed:', err)
    return []
  }
}

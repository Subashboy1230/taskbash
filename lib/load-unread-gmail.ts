// Lightweight server loader for unread Gmail inbox threads.
// No LLM — just metadata (subject, sender, snippet, date) via Nango.
// Used by the /today "Unread" tab. Best-effort: returns [] if Gmail
// isn't connected or any call fails.

import { nangoProxy } from './nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from './connections'

export interface UnreadThread {
  id: string
  subject: string
  from: string
  fromName: string
  fromEmail: string
  snippet: string
  date: string
  dateIso: string
  latestMessageId: string
}

const GMAIL_API = '/gmail/v1/users/me'

export async function loadUnreadGmail(): Promise<UnreadThread[]> {
  try {
    const conn = await getActiveConnection('gmail')
    if (!conn?.nango_connection_id) return []
    const providerConfigKey = NANGO_PROVIDER_KEY.gmail
    if (!providerConfigKey) return []
    const connectionId = conn.nango_connection_id

    interface ThreadListItem { id: string; snippet?: string }
    interface ThreadListResponse { threads?: ThreadListItem[] }

    const list = await nangoProxy<ThreadListResponse>({
      providerConfigKey,
      connectionId,
      method: 'GET',
      endpoint: `${GMAIL_API}/threads`,
      params: {
        q: 'in:inbox is:unread -category:promotions -category:social',
        maxResults: '30',
      },
    })

    const threadRefs = list.threads ?? []
    if (threadRefs.length === 0) return []

    interface GmailHeader { name: string; value: string }
    interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
    interface ThreadDetail {
      id: string
      messages?: Array<{
        id: string
        internalDate?: string
        snippet?: string
        payload?: GmailPart & { headers?: GmailHeader[] }
      }>
    }

    const results = await Promise.all(
      threadRefs.map(async (ref): Promise<UnreadThread | null> => {
        try {
          const thread = await nangoProxy<ThreadDetail>({
            providerConfigKey,
            connectionId,
            method: 'GET',
            endpoint: `${GMAIL_API}/threads/${ref.id}`,
            params: { format: 'full' },
          })

          const messages = thread.messages ?? []
          const first = messages[0]
          const latest = messages[messages.length - 1]
          if (!latest) return null

          const hdr = (msg: typeof latest, name: string) =>
            (msg?.payload?.headers ?? []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

          // Subject comes from first message; From/Date from the latest
          const subject = hdr(first, 'Subject') || hdr(latest, 'Subject') || '(no subject)'

          const from = hdr(latest, 'From')
          const fromNameMatch = from.match(/^([^<]+)/)
          const fromName = fromNameMatch
            ? fromNameMatch[1].trim().replace(/^"|"$/g, '')
            : from.replace(/<[^>]+>/, '').trim()
          const fromEmailMatch = from.match(/<([^>]+)>/)
          const fromEmail = fromEmailMatch
            ? fromEmailMatch[1].trim()
            : from.includes('@') ? from.trim() : ''

          const internalMs = latest.internalDate ? parseInt(latest.internalDate) : 0
          const dateIso = internalMs ? new Date(internalMs).toISOString() : new Date().toISOString()

          return {
            id: thread.id,
            subject,
            from,
            fromName,
            fromEmail,
            snippet: latest.snippet ?? '',
            date: formatRelativeDate(new Date(internalMs)),
            dateIso,
            latestMessageId: latest.id,
          }
        } catch {
          return null
        }
      })
    )

    return results
      .filter((r): r is UnreadThread => r !== null)
      .sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime())
  } catch (err) {
    console.error('[loadUnreadGmail] failed:', err)
    return []
  }
}

function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)
    return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' })
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
}

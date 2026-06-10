// Tavily web search enrichment.
//
// Used by the calendar extractor to surface a 1-sentence "who they are"
// blurb for every external attendee on an upcoming meeting. The result
// rides on the brief so /today's prep block can show "who is on this
// call" without the user pre-googling.
//
// Tavily is a real-time search API tuned for agents: returns clean,
// ranked results plus a short auto-synthesized answer. We use its
// `search` endpoint and read `answer` + the first 2 `results` URLs.
//
// Gated by env TAVILY_ENRICHMENT=on. Default off so the basic digest
// path stays as cheap as it was before. Cached per email for 30 days
// in items.source_ref under .external_context so a re-extracted
// meeting doesn't re-burn search calls.

import { tavily } from '@tavily/core'

export interface AttendeeContext {
  email: string
  who_they_are: string
  sources: string[]
}

let _client: ReturnType<typeof tavily> | null = null

function getClient() {
  if (_client) return _client
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('TAVILY_API_KEY missing')
  _client = tavily({ apiKey })
  return _client
}

// Public free-mail domains and the user's own org get skipped (the
// blurb wouldn't add anything you don't already know). Extend as new
// patterns surface in dogfooding.
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'yahoo.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'aol.com',
])

const SELF_DOMAINS = new Set(
  (process.env.TAVILY_SKIP_DOMAINS || 'sigiq.ai,evertutor.ai')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
)

function domainOf(email: string): string {
  return (email.split('@')[1] || '').toLowerCase().trim()
}

function shouldEnrich(email: string): boolean {
  const d = domainOf(email)
  if (!d) return false
  if (PUBLIC_DOMAINS.has(d)) return false
  if (SELF_DOMAINS.has(d)) return false
  return true
}

/**
 * Look up one attendee. Returns null on any error or empty result so
 * the caller can just skip rendering the context block.
 */
export async function enrichPersonContext(args: {
  name?: string | null
  email: string
}): Promise<AttendeeContext | null> {
  if (!process.env.TAVILY_API_KEY) return null
  if (!shouldEnrich(args.email)) return null

  const domain = domainOf(args.email)
  // Company name = domain stripped of TLD. Crude but works for the kind
  // of "who runs $company" search Tavily handles well.
  const company = domain.split('.')[0] || domain
  const name = (args.name || '').trim()
  const query = name
    ? `"${name}" "${company}" role title`
    : `"${company}" company what they do`

  try {
    const client = getClient()
    const r = await client.search(query, {
      searchDepth: 'basic',
      maxResults: 3,
      includeAnswer: true,
    })
    const answer = (r.answer || '').trim()
    if (!answer) return null
    const sources = (r.results || []).slice(0, 2)
      .map(x => x.url).filter((x): x is string => typeof x === 'string')
    return {
      email: args.email,
      who_they_are: answer.length > 240 ? answer.slice(0, 237) + '...' : answer,
      sources,
    }
  } catch (err) {
    console.error('[tavily] enrich failed for', args.email,
      err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Enrich an array of attendees concurrently. Caps at 5 lookups per
 * meeting to keep Tavily's rate limit happy (free tier = 1000/mo;
 * 5/meeting * 30 meetings/day = 150/day = 4500/mo, so use a higher
 * cap once a paid plan is in place).
 */
export async function enrichAttendees(
  attendees: Array<{ name?: string | null; email: string }>
): Promise<AttendeeContext[]> {
  if (!process.env.TAVILY_API_KEY) return []
  const candidates = attendees.filter(a => shouldEnrich(a.email)).slice(0, 5)
  if (candidates.length === 0) return []
  const results = await Promise.all(
    candidates.map(a => enrichPersonContext(a))
  )
  return results.filter((x): x is AttendeeContext => x !== null)
}

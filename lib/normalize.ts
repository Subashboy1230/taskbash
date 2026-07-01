import { createHash } from 'node:crypto'
import type { Source } from './types'

/**
 * Normalize human-edited text so dedupe survives small surface changes.
 *
 *   "Re: Re: Bookkeeping questions"  → "bookkeeping questions"
 *   "FWD: COFFEE WITH SARAH"         → "coffee with sarah"
 *   "  trailing  whitespace  "       → "trailing whitespace"
 *
 * This is from Subash's existing daily-digest workflow — necessary because
 * email subjects get edited and dedupe by exact-string match thrashes.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    // strip repeated Re:/Fwd:/Fw: prefixes
    .replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/i, '')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    // drop punctuation that humans add inconsistently
    .replace(/[–—‐-―]/g, '-')
    .trim()
}

/**
 * Verb canonicalization for dedupe ONLY. Collapses common verb substitutions
 * the extractor makes run-to-run ("Send X" vs "Draft X", "Connect with Y" vs
 * "Call Y") so near-duplicate tasks hash to the same key. Applied only inside
 * computeSemanticHash — NOT in the general normalizeText — to keep the blast
 * radius on the dedupe key, where the diff engine's source_ref fallback still
 * protects existing rows whose stored hash predates this map.
 *
 * Groups (canonical stem in parens):
 *   send    : write, draft, deliver, share, provide, forward, dispatch
 *   meet    : schedule, reschedule, coordinate, set up, book, arrange
 *   confirm : verify, validate, check, double-check, ensure, ack
 *   reply   : respond, answer, get back, follow up (to a message)
 *   review  : evaluate, look at, look over, read, assess, audit, examine
 *   decide  : approve, sign off, choose, finalize
 *   followup: chase, ping, nudge, circle back, touch base
 *   discuss : talk about, chat with, sync with, cover, walk through
 *   connect : reach out, ping (as first-touch), reconnect, get in touch
 *   update  : refresh, edit, revise, adjust, change (a doc/record)
 *   add     : append, include, insert (to a doc/list)
 *   build   : create, make, put together, spin up, stand up
 */
const VERB_STEMS: Record<string, string> = {
  // send group
  send: 'send', sent: 'send', sending: 'send',
  draft: 'send', drafted: 'send', drafting: 'send',
  write: 'send', writing: 'send', wrote: 'send',
  deliver: 'send', delivering: 'send',
  share: 'send', sharing: 'send', shared: 'send',
  provide: 'send', providing: 'send', provided: 'send',
  forward: 'send', forwarding: 'send',
  dispatch: 'send', dispatching: 'send',

  // meet / schedule group
  connect: 'meet',
  call: 'meet', calling: 'meet',
  meeting: 'meet', meet: 'meet',
  schedule: 'meet', scheduling: 'meet', scheduled: 'meet',
  reschedule: 'meet', rescheduling: 'meet',
  coordinate: 'meet', coordinating: 'meet',
  book: 'meet', booking: 'meet',
  arrange: 'meet', arranging: 'meet',
  setup: 'meet',

  // confirm group
  confirm: 'confirm', confirming: 'confirm', confirmed: 'confirm',
  verify: 'confirm', verifying: 'confirm',
  validate: 'confirm', validating: 'confirm',
  check: 'confirm', checking: 'confirm',
  ensure: 'confirm', ensuring: 'confirm',
  ack: 'confirm', acknowledge: 'confirm',

  // reply group
  reply: 'reply', replying: 'reply', replied: 'reply',
  respond: 'reply', responding: 'reply', responded: 'reply',
  answer: 'reply', answering: 'reply', answered: 'reply',

  // review group
  review: 'review', reviewing: 'review', reviewed: 'review',
  evaluate: 'review', evaluating: 'review',
  look: 'review', looking: 'review',
  read: 'review', reading: 'review',
  assess: 'review', assessing: 'review',
  audit: 'review', auditing: 'review',
  examine: 'review', examining: 'review',

  // decide group
  decide: 'decide', deciding: 'decide',
  approve: 'decide', approving: 'decide',
  finalize: 'decide', finalizing: 'decide',
  choose: 'decide', choosing: 'decide',

  // followup group. "Follow" alone is the head of "follow up", so it
  // stems to followup too — otherwise "Follow up with X" doesn't get a
  // verb match and the anchor logic wrongly treats "Follow" as a proper
  // noun.
  follow: 'followup', following: 'followup', followed: 'followup',
  followup: 'followup', 'follow-up': 'followup',
  chase: 'followup', chasing: 'followup',
  ping: 'followup', pinging: 'followup',
  nudge: 'followup', nudging: 'followup',

  // discuss group
  discuss: 'discuss', discussing: 'discuss', discussed: 'discuss',
  chat: 'discuss', chatting: 'discuss',
  sync: 'discuss', syncing: 'discuss',
  cover: 'discuss', covering: 'discuss',

  // connect / reach group
  reach: 'connect', reaching: 'connect',
  reconnect: 'connect', reconnecting: 'connect',
  contact: 'connect', contacting: 'connect',

  // update group
  update: 'update', updating: 'update', updated: 'update',
  edit: 'update', editing: 'update',
  revise: 'update', revising: 'update',
  adjust: 'update', adjusting: 'update',
  change: 'update', changing: 'update',
  refresh: 'update', refreshing: 'update',

  // add group
  add: 'add', adding: 'add', added: 'add',
  append: 'add', appending: 'add',
  include: 'add', including: 'add',
  insert: 'add', inserting: 'add',

  // build group
  build: 'build', building: 'build', built: 'build',
  create: 'build', creating: 'build',
  make: 'build', making: 'build',

  // design group (kept from original)
  design: 'design', redesign: 'design', designing: 'design',
}

// Stopwords stripped from the dedupe key. Kept minimal so the meaningful
// object of the task (person names, projects, deliverables) survives.
const STOPWORDS = new Set([
  'the', 'a', 'an',
  'to', 'for', 'with', 'on', 'in', 'from', 'via', 'by', 'at', 'of', 'about',
  'and', 'or',
  'our', 'your', 'my', 'their', 'his', 'her',
  'this', 'that', 'these', 'those',
  'is', 'are', 'be',
  'new', 'next',
  // Verb-particle tokens. "Follow up on X" and "Follow up with Y" both
  // start with "Follow" which we stem to "followup"; the trailing "up"
  // is noise for dedup once the verb has been canonicalized.
  'up', 'out', 'back', 'over',
])

// Noise tokens that add color but not identity. "Confirm meeting time with X"
// and "Confirm meeting with X" describe the same commitment.
const NOISE_TAIL = new Set([
  'time', 'times', 'day', 'date',
  'now', 'today', 'tomorrow', 'week', 'weekly', 'monthly',
  'details', 'info', 'information', 'stuff',
  'thread', 'email', 'message',
  'follow-up', 'followup',
])

// Time-of-day tokens and periods. "Confirm 12:00 PM ET meeting" collapses to
// "confirm meeting" once these are dropped.
const TIME_MARKERS = /\b(\d{1,2}(:\d{2})?\s?(am|pm)|est|edt|pst|pdt|cet|utc|gmt|et|pt|ct|mt)\b/gi
const NUMBER_TOKEN = /\b\d+(st|nd|rd|th)?\b/g

/**
 * Aggressive normalization used ONLY inside the dedupe hash. Strips stopwords,
 * noise tails, time markers, and standalone numbers so titles that describe
 * the same commitment with different color hash to the same key.
 */
function hashNormalize(text: string): string {
  let s = normalizeText(text)
  s = s.replace(TIME_MARKERS, ' ')
  s = s.replace(NUMBER_TOKEN, ' ')
  const tokens = s
    .split(/\s+/)
    .map(w => VERB_STEMS[w] ?? w)
    .filter(w => w && !STOPWORDS.has(w) && !NOISE_TAIL.has(w))
  return tokens.join(' ').trim()
}

function stemVerbs(text: string): string {
  return text
    .split(' ')
    .map(w => VERB_STEMS[w] ?? w)
    .join(' ')
}

/**
 * Stable dedupe key. Same (source + normalized parent + normalized title) for
 * the same user maps to the same hash, so re-extracting the same item never
 * creates a duplicate row. Titles are aggressively normalized (verbs stemmed,
 * stopwords + noise tails + time markers dropped) so near-duplicate phrasings
 * collapse. 16-char prefix is plenty at ~100k items.
 */
export function computeSemanticHash(
  source: Source,
  parentContext: string,
  title: string
): string {
  const normalized = `${source}::${stemVerbs(normalizeText(parentContext))}::${hashNormalize(title)}`
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

/**
 * Anchor key — a secondary dedupe signal that catches cross-source or cross-
 * thread duplicates the semantic hash misses. Pulls capitalized proper nouns
 * (people, companies, projects) from the title, sorts them, joins. Two titles
 * that share the same anchor + same stemmed verb are almost always the same
 * commitment even when the wording drifts wildly.
 *
 *   "Confirm meeting with Eric Lavin"          → "confirm|Eric Lavin"
 *   "Confirm 12pm meeting time with Eric Lavin" → "confirm|Eric Lavin"
 *   "Update Andy Bermeo's EverTutor credentials"          → "update|Andy Bermeo EverTutor"
 *   "Update Andy Bermeo's EverTutor account credentials"  → "update|Andy Bermeo EverTutor"
 *
 * Returns null when no proper noun anchor exists (task is too generic to
 * safely dedupe on a verb alone).
 */
export function computeAnchorKey(
  source: Source,
  title: string
): string | null {
  if (!title) return null
  // Grab EVERY capitalized run of 1-N words. We use the raw list to detect
  // proper-noun quality, not just the sentence-initial title case.
  const rawAnchors = title.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? []
  // Strip sentence-initial verbs ("Send X to Y" → drop "Send", keep "Y").
  const anchors = rawAnchors.filter((a, i) => {
    if (i === 0 && VERB_STEMS[a.toLowerCase()]) return false
    return a.length > 2
  })
  if (anchors.length === 0) return null

  // NOTE: we used to require a multi-word proper noun here ("Eric Lavin",
  // not just "Eric") but that dropped dedup for common patterns like
  // "Reconnect with Andy on ASCA 2026" where every anchor is single-word.
  // The content-word disambiguator below is a strong enough safety net
  // against genuine-non-dupe collisions like
  // "Send offer to Aarav" vs "Send demo to Aarav" (offer vs demo differ,
  // so their anchor keys differ despite same person).

  // First stemmed verb we can find in the title (usually word 0)
  const firstWord = title.split(/\s+/)[0]?.toLowerCase() ?? ''
  const verb = VERB_STEMS[firstWord] ?? firstWord
  if (!verb) return null

  // Include the LONGEST anchor (usually the person's full name) as the object.
  // Adding a length-normalized object token guards against "same verb + same
  // person" collapsing genuinely different tasks — "Send offer to Aarav Kalra"
  // vs "Send demo to Aarav Kalra" still share the anchor, so we also drop in
  // the FIRST content noun (first lowercase word after the verb) to keep them
  // apart.
  const words = title.split(/\s+/).map(w => w.toLowerCase())
  const contentWord = words
    .slice(1)
    .find(w => w && !STOPWORDS.has(w) && !NOISE_TAIL.has(w) && !/^\d/.test(w))
    ?? ''
  const anchorList = Array.from(new Set(anchors)).sort().join(' ').toLowerCase()
  return `${source}::${verb}::${anchorList}::${contentWord}`
}

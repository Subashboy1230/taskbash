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
 */
const VERB_STEMS: Record<string, string> = {
  send: 'send', sent: 'send', sending: 'send', draft: 'send', drafted: 'send', drafting: 'send',
  connect: 'meet', call: 'meet', meeting: 'meet', meet: 'meet', schedule: 'meet', scheduling: 'meet',
  design: 'design', redesign: 'design', designing: 'design',
  reply: 'reply', respond: 'reply', responding: 'reply', answer: 'reply', answering: 'reply',
  review: 'review', evaluate: 'review', evaluating: 'review', look: 'review',
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
 * creates a duplicate row. Verbs are canonicalized (see VERB_STEMS) so verb-
 * substituted near-dupes ("Send proposal" / "Draft proposal") collapse.
 *
 * 16-char prefix is plenty for collision avoidance at this scale (~100k items).
 */
export function computeSemanticHash(
  source: Source,
  parentContext: string,
  title: string
): string {
  const normalized = `${source}::${stemVerbs(normalizeText(parentContext))}::${stemVerbs(normalizeText(title))}`
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

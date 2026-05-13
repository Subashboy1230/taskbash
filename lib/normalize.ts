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
 * Stable dedupe key. Same (source + normalized parent + normalized title) for
 * the same user maps to the same hash, so re-extracting the same item never
 * creates a duplicate row.
 *
 * 16-char prefix is plenty for collision avoidance at this scale (~100k items).
 */
export function computeSemanticHash(
  source: Source,
  parentContext: string,
  title: string
): string {
  const normalized = `${source}::${normalizeText(parentContext)}::${normalizeText(title)}`
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

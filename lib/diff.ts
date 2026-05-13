// The diff engine. Pure function. Easy to test.
//
// Input:
//   - Items currently open in DB (yesterday's snapshot + still-open carryovers)
//   - Items freshly extracted from sources today
//
// Output: three buckets — what's new, what's carrying over, what's gone.

import type { ExtractedItem, Item } from './types'
import { computeSemanticHash } from './normalize'

export interface DiffResult {
  newItems: ExtractedItem[]      // present today, not yesterday → INSERT
  carryover: Array<{             // present in both → UPDATE last_seen_at
    existing: Item
    fresh: ExtractedItem
  }>
  completed: Item[]               // present yesterday, gone today → mark completed
}

/**
 * Compute the diff between current open items and freshly extracted items.
 *
 * Critical rule (from Subash's workflow): a sub-task is "completed" only when
 * it disappears from its SOURCE, not when the UI checkbox is ticked. So the
 * diff operates on what extractors returned, not on UI state.
 */
export function diff(currentItems: Item[], freshItems: ExtractedItem[]): DiffResult {
  // Build lookup map from current items, keyed by semantic_hash
  const currentByHash = new Map<string, Item>()
  for (const item of currentItems) {
    currentByHash.set(item.semantic_hash, item)
  }

  // Compute hash for each fresh item and build that map too
  const freshByHash = new Map<string, ExtractedItem>()
  for (const fresh of freshItems) {
    const hash = computeSemanticHash(fresh.source, fresh.parent_context, fresh.title)
    freshByHash.set(hash, fresh)
  }

  const newItems: ExtractedItem[] = []
  const carryover: DiffResult['carryover'] = []
  const completed: Item[] = []

  // Walk fresh → classify as new or carryover
  for (const [hash, fresh] of freshByHash) {
    const existing = currentByHash.get(hash)
    if (existing) {
      carryover.push({ existing, fresh })
    } else {
      newItems.push(fresh)
    }
  }

  // Walk current open items not present in fresh → completed
  // (Only check items from sources we re-extracted — filtered by caller.)
  for (const [hash, existing] of currentByHash) {
    if (!freshByHash.has(hash)) {
      completed.push(existing)
    }
  }

  return { newItems, carryover, completed }
}

/**
 * Same diff, but limited to a single source. Used when one extractor ran
 * and we only want to auto-complete items from that source.
 */
export function diffSingleSource(
  currentItems: Item[],
  freshItems: ExtractedItem[],
  source: Item['source']
): DiffResult {
  const currentFromSource = currentItems.filter(i => i.source === source)
  return diff(currentFromSource, freshItems)
}

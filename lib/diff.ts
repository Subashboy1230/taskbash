// The diff engine. Pure function. Easy to test.
//
// Inputs:
//   currentItems  — items the user has touched recently (any status). We
//                   need OPEN ones to compute carryover and COMPLETED /
//                   DISMISSED / SNOOZED ones to suppress resurfacing of
//                   tasks the user already dealt with.
//   freshItems    — items the extractor just returned from a source.
//
// Outputs four buckets:
//   newItems       present in fresh, not seen before          → INSERT
//   carryover      present in fresh, matches an OPEN row      → UPDATE last_seen_at
//   completed      not in fresh, was OPEN                     → auto-complete
//   suppressed     in fresh, matches a CLEARED row            → DO NOTHING
//
// Matching strategy (in order of preference):
//   1. source_ref stable id (gmail_thread_id, granola_meeting_id, etc.)
//      Survives LLM title variation across extraction runs.
//   2. semantic_hash (source + parent_context + title fallback).
//
// Critical rule (from Subash's workflow): a sub-task is "completed" only
// when it disappears from its SOURCE, not when the UI checkbox is ticked.

import type { ExtractedItem, Item, Source, SourceRef } from './types'
import { computeSemanticHash } from './normalize'

export interface DiffResult {
  newItems: ExtractedItem[]
  carryover: Array<{ existing: Item; fresh: ExtractedItem }>
  completed: Item[]
  suppressed: Array<{ existing: Item; fresh: ExtractedItem }>
}

const OPEN_STATUSES = new Set(['open', 'in_progress'])
const CLEARED_STATUSES = new Set(['completed', 'dismissed', 'snoozed'])

/**
 * Build a stable per-source key from source_ref. Returns null when the
 * extractor didn't populate the expected stable id (defensive — older
 * rows may exist that predate the stable-id contract).
 */
function sourceRefKey(source: Source, ref: SourceRef | null | undefined): string | null {
  if (!ref) return null
  switch (source) {
    case 'gmail':
      // CRITICAL: thread_id alone collapses every message in a long thread
      // into one dedup bucket. Today's new reply on a thread the user
      // already cleared would get suppressed. Include the latest
      // message_id so each message gets its own slot.
      return ref.gmail_thread_id
        ? `gmail:${ref.gmail_thread_id}:${ref.gmail_message_id ?? ''}`
        : null
    case 'granola':
      return ref.granola_meeting_id ? `granola:${ref.granola_meeting_id}` : null
    case 'calendar':
      return ref.google_calendar_event_id
        ? `calendar:${ref.google_calendar_event_id}`
        : null
    case 'linear':
      return ref.linear_issue_id
        ? `linear:${ref.linear_issue_id}`
        : ref.linear_issue_identifier
        ? `linear:${ref.linear_issue_identifier}`
        : null
    case 'slack':
      return ref.slack_ts ? `slack:${ref.slack_channel_id ?? ''}:${ref.slack_ts}` : null
    case 'manual':
      return null
  }
}

export function diff(currentItems: Item[], freshItems: ExtractedItem[]): DiffResult {
  // Build dual lookup maps from current items, keyed by source_ref AND
  // semantic_hash. source_ref wins when both are present because it's
  // stable across LLM title variation.
  //
  // currentByRef is a MULTI-MAP: many items from the same container
  // (e.g. a Granola meeting with 3 action items) all share one source_ref
  // key. We store the full list and consume entries one-at-a-time so each
  // fresh item claims a distinct existing row rather than all collapsing
  // onto whichever row happened to be last in the build loop.
  const currentByRef = new Map<string, Item[]>()
  const currentByHash = new Map<string, Item>()
  for (const item of currentItems) {
    const refKey = sourceRefKey(item.source, item.source_ref as SourceRef | null)
    if (refKey) {
      const bucket = currentByRef.get(refKey) ?? []
      bucket.push(item)
      currentByRef.set(refKey, bucket)
    }
    currentByHash.set(item.semantic_hash, item)
  }

  // Walk fresh items, classify each by lookup result + existing status.
  const newItems: ExtractedItem[] = []
  const carryover: DiffResult['carryover'] = []
  const suppressed: DiffResult['suppressed'] = []
  // Track which OPEN existing items got matched so we can compute the
  // "auto-complete vanished" set at the end. We only consider OPEN ones
  // since cleared items are already in a terminal state.
  const matchedOpenIds = new Set<string>()
  // Tracks which existing item IDs have already been claimed by a fresh
  // item via the source_ref multi-map. Prevents two fresh items from the
  // same container (e.g., the same meeting) from both matching the same
  // existing row.
  const consumedByRef = new Set<string>()

  for (const fresh of freshItems) {
    const refKey = sourceRefKey(fresh.source, fresh.source_ref as SourceRef | null)
    const freshHash = computeSemanticHash(
      fresh.source,
      fresh.parent_context,
      fresh.title
    )

    // Lookup precedence:
    //   1. semantic_hash — most specific (per-item identity)
    //   2. source_ref   — fallback for LLM title variation across runs.
    //      Uses the first unconsumed candidate in the bucket so each fresh
    //      item from a multi-item container claims a distinct existing row.
    const existingByRef = refKey
      ? (currentByRef.get(refKey) ?? []).find(c => !consumedByRef.has(c.id))
      : undefined
    const existing = currentByHash.get(freshHash) ?? existingByRef
    // Mark the matched row consumed so later fresh items from the same
    // container don't also claim it.
    if (existing && refKey && existingByRef?.id === existing.id) {
      consumedByRef.add(existing.id)
    }

    if (!existing) {
      newItems.push(fresh)
      continue
    }

    if (OPEN_STATUSES.has(existing.status)) {
      carryover.push({ existing, fresh })
      matchedOpenIds.add(existing.id)
    } else if (CLEARED_STATUSES.has(existing.status)) {
      // User already dealt with this. Do not resurface.
      suppressed.push({ existing, fresh })
    } else {
      // Unknown status — be conservative, treat as carryover so we don't
      // double-insert.
      carryover.push({ existing, fresh })
      matchedOpenIds.add(existing.id)
    }
  }

  // Auto-complete: OPEN items the extractor did NOT return this run.
  // Anything cleared stays cleared; anything matched stays carrying over.
  const completed: Item[] = []
  for (const item of currentItems) {
    if (!OPEN_STATUSES.has(item.status)) continue
    if (matchedOpenIds.has(item.id)) continue
    completed.push(item)
  }

  return { newItems, carryover, completed, suppressed }
}

/**
 * Same diff, scoped to a single source. The caller passes currentItems
 * for ANY status from that source; this function filters internally and
 * runs the full four-bucket diff.
 */
export function diffSingleSource(
  currentItems: Item[],
  freshItems: ExtractedItem[],
  source: Item['source']
): DiffResult {
  const currentFromSource = currentItems.filter(i => i.source === source)
  return diff(currentFromSource, freshItems)
}

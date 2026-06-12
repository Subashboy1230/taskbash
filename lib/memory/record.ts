// Record user feedback as durable mem0 memories.
//
// Every slop click, function-tag correction, or dismiss reason is an
// implicit instruction from the user about what they care about. mem0
// auto-distills these signals into facts ("Subash dismisses cold VC
// outreach as slop") that we replay into future LLM prompts.
//
// All entry points are fire-and-forget — they never block the user
// action that produced the signal.

import { getMem0Client, mem0Configured, mem0UserIdFor } from './mem0'

interface FeedbackContext {
  userId: string | null | undefined
  /** What kind of feedback this is. */
  kind: 'slop' | 'wrong_tag' | 'wrong_urgency' | 'good'
  /** The taxonomy reason the user picked (e.g. 'irrelevant', 'old_task'). */
  reason?: string | null
  /** Optional free-text note the user typed. */
  note?: string | null
  /** The item title the feedback was about. */
  itemTitle?: string | null
  /** The source the item came from (gmail, granola, etc). */
  itemSource?: string | null
  /** A short excerpt of the item's parent context, for fact-grounding. */
  itemContext?: string | null
}

/**
 * Push a slop / wrong-tag / wrong-urgency signal to mem0 so the next
 * digest's extractors and classifier have it. Returns a Promise that
 * callers SHOULD NOT await — fire and forget. Logs but does not throw
 * on errors.
 */
export function recordFeedbackMemory(ctx: FeedbackContext): Promise<void> {
  if (!mem0Configured()) return Promise.resolve()
  return (async () => {
    try {
      const client = getMem0Client()
      const userMsg = buildUserMessageFromFeedback(ctx)
      const assistantMsg = `Noted. I'll remember this preference for future task extraction and classification.`
      // mem0 auto-extracts durable facts from the message pair. We pass
      // metadata so a future /profile/memory UI can filter by kind.
      await client.add(
        [
          { role: 'user', content: userMsg },
          { role: 'assistant', content: assistantMsg },
        ],
        {
          user_id: mem0UserIdFor(ctx.userId),
          metadata: {
            source: 'taskbash.feedback',
            kind: ctx.kind,
            reason: ctx.reason ?? null,
            item_source: ctx.itemSource ?? null,
            recorded_at: new Date().toISOString(),
          },
        } as Parameters<typeof client.add>[1]
      )
    } catch (err) {
      console.error('[mem0.record] add failed:', err instanceof Error ? err.message : err)
    }
  })()
}

function buildUserMessageFromFeedback(ctx: FeedbackContext): string {
  const lines: string[] = []
  switch (ctx.kind) {
    case 'slop':
      lines.push(
        `I marked the task "${ctx.itemTitle ?? '(untitled)'}" as slop.`,
        `Reason: ${ctx.reason ?? 'unspecified'}.`,
      )
      break
    case 'wrong_tag':
      lines.push(
        `The task "${ctx.itemTitle ?? '(untitled)'}" was tagged with the wrong function.`,
        `I corrected it. Reason: ${ctx.reason ?? 'unspecified'}.`,
      )
      break
    case 'wrong_urgency':
      lines.push(
        `The task "${ctx.itemTitle ?? '(untitled)'}" had the wrong urgency.`,
        `Reason: ${ctx.reason ?? 'unspecified'}.`,
      )
      break
    case 'good':
      lines.push(
        `The task "${ctx.itemTitle ?? '(untitled)'}" was a useful, actionable item.`,
      )
      break
  }
  if (ctx.itemSource) lines.push(`Source: ${ctx.itemSource}.`)
  if (ctx.itemContext) lines.push(`Context: ${ctx.itemContext.slice(0, 240)}.`)
  if (ctx.note) lines.push(`I added a note: "${ctx.note.slice(0, 240)}".`)
  return lines.join(' ')
}

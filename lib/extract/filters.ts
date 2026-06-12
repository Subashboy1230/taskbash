// Shared extraction filters — applied across every source (Granola, Gmail, Slack)
// so the definition of "what counts as a task" stays consistent everywhere.

// Work-only scope: ToDoo surfaces professional tasks, not personal-life errands.
// Imported into each extractor's system prompt.
export const WORK_ONLY_RULE = `SCOPE — WORK ONLY:
Only include work/professional tasks. Exclude anything from the user's personal life.
- INCLUDE: tasks tied to the user's job, company, team, clients, investors, hiring, fundraising, product, or any professional commitment.
- EXCLUDE: personal errands, family or relationship matters, health/medical appointments, personal finance, leisure travel, hobbies, household or home tasks, gifts, social plans.
- Edge case — keep it if a personal-sounding task is clearly in service of work (e.g. "book flights for the client offsite"). Drop it if it's genuinely personal even though it surfaced in a work conversation (e.g. "pick up dry cleaning").
- When genuinely ambiguous, lean toward EXCLUDING. A missed personal todo is better than a cluttered work list.`

// Mechanical event/logistics "tasks" that are not real action items — they're
// the event itself (a meeting link, a dial-in, "join the Google Meet"). The
// 2026-06-10 slop analysis flagged these as `irrelevant`. Applied across every
// source in the digest pipeline, not in any single extractor's prompt, because
// these titles leak from multiple extractors (gmail/granola), not just calendar.
const MEETING_LINK_RE = /(meet\.google\.com|zoom\.us\/j\/|teams\.microsoft\.com\/l\/meetup-join|whereby\.com|meet\.jit\.si)/i
const PHONE_BRIDGE_RE = /(\+?\d[\d\s().-]{7,}\d)\s*$/
// An imperative about getting INTO a virtual meeting.
const JOIN_IMPERATIVE_RE = /^(join|hop on|dial[ -]?in|dial into|call in to|connect to)\b/i
// A NAMED virtual-meeting platform. Required by the join rule below so real
// commitments without a platform ("Attend the board meeting", "Join the hiring
// committee") are never dropped — only "join the <platform>" logistics are.
const VIRTUAL_PLATFORM_RE = /\b(google meet|google hangout|hangouts?|zoom|ms teams|microsoft teams|teams (?:meeting|call)|webex|whereby|jitsi)\b/i

/**
 * True when a candidate task title is mechanical event detail, not a real
 * action item. Narrow on purpose: matches bare meeting links, phone bridges,
 * and short "join the <named virtual platform>" logistics
 * ("Join the Google Meet at 12:15pm"), while leaving real commitments that
 * merely involve a meeting ("Attend follow-up meeting with Candace", "Watch
 * the demo before the call", "Review the Zoom recording") untouched.
 *
 * Earlier this flagged any title starting join/attend/watch/dial under 8 words,
 * which wrongly dropped real tasks like "Attend follow-up meeting with X".
 */
export function isMechanicalNoise(title: string): boolean {
  const t = (title || '').trim()
  if (!t) return false
  if (MEETING_LINK_RE.test(t)) return true
  if (PHONE_BRIDGE_RE.test(t) && t.split(/\s+/).length <= 6) return true
  // Both a join imperative AND a named virtual platform, and short (a real
  // meeting with a topic is longer or names no virtual platform).
  if (
    JOIN_IMPERATIVE_RE.test(t) &&
    VIRTUAL_PLATFORM_RE.test(t) &&
    t.split(/\s+/).length <= 8
  ) {
    return true
  }
  return false
}

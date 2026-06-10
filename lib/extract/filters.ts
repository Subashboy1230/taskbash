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
// Titles that are just an imperative directed at the event mechanics.
const EVENT_MECHANICS_RE = /^(join|dial|dial in|dial-in|call in|attend|watch|rsvp|add to calendar|accept|decline)\b/i

/**
 * True when a candidate task title is mechanical event detail, not a real
 * action item. Conservative: matches bare meeting links, phone bridges, and
 * one-verb event imperatives ("Join the Google Meet at 12:15pm"), while
 * leaving substantive tasks that merely mention a tool ("Review the Zoom
 * recording and send notes") untouched.
 */
export function isMechanicalNoise(title: string): boolean {
  const t = (title || '').trim()
  if (!t) return false
  if (MEETING_LINK_RE.test(t)) return true
  if (PHONE_BRIDGE_RE.test(t) && t.split(/\s+/).length <= 6) return true
  // "Join/Watch/Attend ..." where the rest is short logistics, not a real task.
  if (EVENT_MECHANICS_RE.test(t) && t.split(/\s+/).length <= 8) return true
  return false
}

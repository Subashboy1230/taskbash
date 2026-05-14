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

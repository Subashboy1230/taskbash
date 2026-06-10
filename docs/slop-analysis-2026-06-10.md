# Slop analysis — 2026-06-10

Read-only analysis of 173 top-level open items currently in production. Sourced
from `items` table via service role, user_id `d470e729-29eb-41bb-8785-9dddedbe8597`.
No API spend, no writes — this is a diagnostic pass.

## Two complementary lenses

This doc combines two analyses:

1. **Backward-looking** (from Cursor, run earlier today): what the 70 historical
   slop signals + 17 function-tag corrections tell us about extractor weak
   points. Section: "Historical slop corpus (70 signals)".

2. **Forward-looking** (from this analysis): what fraction of the 173 currently
   open items would be classified as slop if swept today, broken down by source
   and root cause. Section: "Current open list (173 items)".

The two analyses agree on the same three clusters (Linear noise, Granola
engineering routing, dedup misses on reply-type tasks), giving high confidence
they're real patterns and not artifacts of either approach.

## Headline

**~22% of the user's current open list is slop.** ~39 of 173 items would be
dismissed if classified now. The slop is concentrated in three clean clusters,
two of which are 100% fixable with surgical prompt/filter changes.

This number is real-world product debt, not a synthetic estimate. Every one of
these 39 items is something Subash has to manually triage every day until the
underlying extractor/filter is fixed.

**Critical infrastructure finding** (from Cursor's backward analysis): the
slop→eval loop is currently silently broken. 0 of 1000 items have
`extraction_meta.llm_call_id`, and 0 of 1000 `llm_calls` rows have
`produced_item_ids` populated. Every slop signal collected to date is orphaned
from the prompt that produced it. 0 eval datasets exist. `npm run eval` and
`scripts/replay-slop.ts` both return nothing. The product's "gets smarter from
slop" thesis is not actually running. Fix is upstream in `lib/digest/run.ts` —
see Step 3 in the ship order below.

---

## Historical slop corpus (70 signals, May 30 → Jun 10)

**Source distribution:** Gmail 56% · Granola 34% · Linear 9% · manual 1%.
**Task type:** review 64% · post_call 34%.

**Reason distribution:**

| Reason | % | Note |
|--------|---:|------|
| `duplicate` | 24% | #1 lever — reply/commit tasks re-extracted with varying titles |
| `irrelevant` | 21% | Calendar/logistics noise mostly ("join the Google Meet at...") |
| `not_my_focus` | 19% | Delegation tasks the user can't fix at the agent layer |
| `low_signal` | 10% | Linear ENGG QA noise mostly lands here |
| `other` | 10% | Catch-all — Linear ENGG noise also lands here |
| `old_task` | 9% | Stale dated tasks (Attend meeting May 28th) |
| `spam` | 7% | Pure marketing/automated |

**Four distinct clusters surfaced from historical signals:**

1. **Duplicates of reply/commit tasks** ("Reply to Ethan on…", "Answer questions
   about Empowerly SIP" appearing 3×). Semantic hash doesn't catch reply-type
   tasks whose titles vary run-to-run.

2. **Linear ENGG tickets** (ENGG-2064, ENGG-2058, ENGG-1909…) landing in
   `other` and `low_signal`. Engineering QA tickets pulled regardless of
   assignee.

3. **Calendar/logistics noise** → `irrelevant` ("Join the Google Meet at
   12:15pm", "Watch J-Reach video before call"). Mechanical event details
   extracted as action items.

4. **`not_my_focus` + `old_task`** (28% combined) — delegation tasks ("Coordinate
   onboarding for Ushma", "Create teacher hotline") and stale dated tasks. These
   are structurally unfixable by prompt tuning alone — the agent can't know
   org ownership boundaries or that a date passed without source-side signals.

**Tag corrections (17 total): 65% additions, 35% removals.** Auto-classifier
under-tags more than it over-tags — the user is adding functions it missed.
Direction signal: lower the confidence threshold or widen the candidate-function
list in the function classifier prompt.

---

## Current open list (173 items)

---

## Source breakdown (top-level open items only)

| Source | Items | Slop rate | Pattern |
|--------|------:|----------:|---------|
| Gmail | 87 | ~6% | Reply/draft dedup misses (verb substitution) |
| Granola | 54 | ~26% | Engineering-ownership items routed to CEO |
| Linear | 20 | **100%** | ALL items are eng-team QA tickets, not Subash's |
| Calendar | 8 | 0% | Working as designed (prep briefs) |
| Manual | 4 | 0% | User-created, intentional |

---

## Cluster 1 — Linear: 20/20 should be slopped as `not_my_focus`

**Every Linear item in the open list is an engineering QA ticket.** Examples:

- `ENGG-2095 "Hold to speak" button stuck in listening state` (In QA)
- `PRD-252 After restarting the tutor hangs` (In QA)
- `ENGG-1647 Tutor doesn't speak telegu from canvas` (QA Requested)
- `ENGG-2044 responses api refactor` (QA Requested)
- ...17 more identical-pattern tickets

These are tickets for the engineering team to QA. Subash is the CEO, not
the QA engineer. They surface in his digest because the Linear extractor pulls
QA-state tickets where Subash is @-mentioned in a comment (per the
filter-by-mentions logic from task #120) — but being mentioned doesn't mean
they're his action items, just that someone tagged him for FYI.

**Root cause:** `lib/extract/linear.ts` filters by mentions but doesn't filter
by assignee. The right rule is "assignee == Subash" OR "explicit @-action in
the comment body" (not just any @-mention).

**Fix:** add an assignee check. Only surface Linear tickets where
`issue.assignee.id === userLinearId` OR the most recent comment containing the
@-mention also contains an imperative verb directed at Subash ("can you...",
"please review...", "Subash, can you...").

**Effort:** small, isolated to `lib/extract/linear.ts`.

---

## Cluster 2 — Granola: 14/54 are engineering work routed to CEO

The Granola extractor pulls every action item from meeting notes regardless of
who owns it. Examples that should not be on Subash's plate:

- "Implement Notepad V2 rollout to replace slides with cost optimization"
- "Sync with Oshka on custom pronunciations testing"
- "Plan analytics data transfer capabilities for gradebooks"
- "Plan integration with Canvas and Aries platforms"
- "Make voice speed adjustment feature more discoverable"
- "Improve AI tutor speaking speed and pronunciation clarity"
- "Add co-teacher spaces access requirements to organizational PRD"
- "Install Pendo snippet and evaluate guidance capabilities"
- "Review PR comments from Rick on verification process"
- "Review Edlink documentation on Google OAuth client setup"
- ...and 4 more

These are decisions/work that belong to the engineering team. Some are
worth Subash's awareness (e.g., "make implementation decision on Pendo" is a
CEO call), but most are technical execution items.

**Root cause:** the Granola extraction prompt asks "what action items came out
of this meeting?" without filtering "is the owner Subash?"

**Fix:** add a step to the Granola prompt that, for each candidate action item,
identifies the owner. Skip items whose owner is named as someone else in the
transcript (Rick, Oshka, Mishra, Kartik, engineering team, etc.). Keep items
whose owner is Subash, ambiguous, or no owner stated.

**Effort:** small prompt edit in `lib/extract/granola.ts`. Likely 5-10 lines
of additional system-prompt instruction.

---

## Cluster 3 — Gmail dedup misses: ~5 verb-substitution duplicates

Token-set normalization catches one clean pair but misses verb-substituted
near-dupes:

| Item A | Item B |
|--------|--------|
| Send formal proposal to ANANSI Academy | Draft formal proposal for ANANSI Academy |
| Connect with David and Joy at Changemaker | Get on a 30-minute call with David and Joy |
| Answer questions about Empowerly SIP | Answer questions about Empowerly SIP program |
| Design in-app experience for teachers on Pendo | Design the actual experience for teachers |
| Schedule meeting with Bryan Liu at Alumni Ventures | Schedule meeting with Bryan Liu from Alumni Ventures |

**Root cause:** `lib/normalize.ts`'s `computeSemanticHash` is too strict —
verb substitutions (send/draft, connect/call, design/redesign) hash
differently, so dedup misses them.

**Fix:** stem verbs before hashing. A small verb-stemmer step in
`computeSemanticHash` would collapse most of these. OR: lift to LLM-based dedup
on a small candidate set rather than pure hash matching. The LLM approach is
more robust but adds cost; the verb-stem approach is free and catches ~80% of
the misses.

**Effort:** small edit in `lib/normalize.ts`. Verb-stemming is ~20 lines.

---

## What NOT to do tonight

- **Don't backfill the 70 existing orphaned slop signals.** Once linkage is
  fixed, you'll regenerate that volume in a week of normal usage. The backfill
  would require LLM-replay against guessed source content. Not worth it.
- **Don't bulk-mark the 39 current open items as slop in production**, because
  the linkage fix isn't in yet. If you slop them now, the feedback rows still
  won't link to producing calls, so the signals will be orphaned. Wait until
  linkage is live, then sweep.
- **Don't tune any prompt yet.** Without linkage, you can't measure whether a
  prompt change actually reduces slop. Tuning by vibes leads to regressions.

---

## The required ship order

**1. Fix the build (still red from last session)** — `app/today/today-view.tsx`
   has `'already_cleared'` referenced in 4 places but its `SlopReason` union and
   `ALREADY_CLEARED_CHANNELS` const are missing. Re-add per the previous Cursor
   brief. Until this lands, Vercel can't deploy ANY of the recent work.

**2. Ship the desktop-overlay panel fix** — the mobile `<Sheet>` overlay is
   eating clicks on the desktop detail panel. This blocks all panel-level
   interactions on prod (functions, draft, subtasks). Cursor already wrote the
   fix; it just needs to ship.

**3. Fix the linkage** — stamp `extraction_meta.llm_call_id` on every item row
   inserted by `lib/digest/run.ts`, and/or write `produced_item_ids` back onto
   the `llm_calls` row after items are inserted. Until this is live, no slop
   signal ever links to its producing prompt and no eval data accumulates.

**4. THEN attack the three slop clusters above** — in any order, each one
   improves slop rate measurably and the linkage from step 3 lets you verify
   the improvement via `/observability` slop-rate-per-prompt.

---

## Concrete plan for steps 1–3

Steps 1 and 2 are already specced in the previous Cursor brief — finish those
first.

Step 3 (the linkage fix) is one file, ~10 lines:

In `lib/digest/run.ts`, find the spot where extracted items are inserted into
Supabase. The insert today writes columns like `title`, `source`, `subtitle`,
etc., and probably an `extraction_meta` object. Add `llm_call_id` to that
object:

```ts
extraction_meta: {
  llm_call_id: producingCallId,  // ← the new line
  // ...existing fields stay as-is
}
```

`producingCallId` is the ID of the LLM call that returned this extraction. The
extract functions in `lib/extract/*.ts` already capture it (or can — check
`tagCallWithItems` in `lib/llm-trace.ts` for how it's done elsewhere).

Optionally also (belt-and-suspenders): after items are inserted and you have
their IDs, write the array back onto the call:

```ts
await supabase
  .from('llm_calls')
  .update({ produced_item_ids: insertedItemIds })
  .eq('id', producingCallId)
```

**Acceptance for the linkage fix:**

- Trigger a fresh digest run from the Re-run button
- Open `/observability` → recent calls → click any extraction call → verify the
  produced item shows in detail trail
- OR query `items` table → confirm `extraction_meta.llm_call_id` is now
  populated on new rows (was null on every existing row)
- Mark one of the newly extracted items as slop → check `item_feedback` row →
  `llm_call_id` should be populated (was null on every existing row)
- Within ~5 minutes, an `eval_datasets` row named `slop-<prompt_id>` should
  auto-create with one `eval_cases` row referencing that slop

---

## Plan for steps 4 — slop cluster fixes (do AFTER linkage)

### 4a. Linear assignee filter

File: `lib/extract/linear.ts`

Change the filter from "issues where Subash is @-mentioned in any comment" to
"issues where (a) assignee_id == Subash's Linear user ID OR (b) the most recent
comment with an @-mention is also imperative-toned ('please', 'can you',
'Subash,' etc.)."

Acceptance: trigger a fresh digest, verify no `ENGG-####` or `PRD-####`
tickets appear in /today Open tab unless they are assigned to Subash. Existing
QA-state engineering tickets should disappear.

### 4b. Granola owner-aware extraction

File: `lib/extract/granola.ts` (the prompt block)

Add to the system prompt: "For each candidate action item, identify the
owner from the transcript context. Skip action items whose owner is named as
someone other than Subash (e.g., 'Rick will...', 'Oshka to test...', 'the
engineering team will...'). Keep items where the owner is Subash, ambiguous,
or unstated."

Acceptance: trigger a fresh digest after a meeting with explicit engineering
ownership transitions. Items like "Implement X" / "Plan integration with Y"
where someone else is named as owner should not appear.

### 4c. Verb-stem dedup

File: `lib/normalize.ts` (the `computeSemanticHash` function)

Add a small verb-stemming step before tokenization. Common verb pairs that
should collapse:

```ts
const VERB_STEMS: Record<string, string> = {
  send: 'send', sent: 'send', sending: 'send',
  draft: 'send', drafted: 'send',  // collapse draft → send
  connect: 'meet', call: 'meet', meeting: 'meet', schedule: 'meet',
  design: 'design', redesign: 'design', designing: 'design',
  reply: 'reply', respond: 'reply', answer: 'reply',
  review: 'review', evaluate: 'review', look: 'review',
  // ... extend as needed
}
```

Apply to each word before joining into the hash input.

Acceptance: re-run the dedup on the 5 known near-dupe pairs above; they should
hash to the same value and only the older one should survive (carryover wins).

---

## After 4a-c ship

Watch `/observability` slop-rate-per-prompt for a week. If the per-prompt slop
rate for `extract.granola` drops by >50% and `extract.linear` drops by >80%,
the fixes worked. If it doesn't, the linkage signal will tell you exactly
which prompt is still over-extracting, and you can iterate from there.

That's the actual learning loop. Tonight's work is building the rails for it.

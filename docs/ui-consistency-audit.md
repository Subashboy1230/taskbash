# UI consistency audit — taskbash

Codebase audit + browser verification with zoomed screenshots. The design system in `app/globals.css` is well-defined (canvas / surface / ink / line tokens, tag palette, danger/success). The inconsistencies below are all about *applying* the system, not about the system itself.

Ordered by visibility: bugs that show up next to each other on the same row first, then app-wide naming/empty-state issues.

## Browser-verified findings (DOM measurements + screenshots)

Confirmed in a fresh browser pass at 10:30 PM:

- **I1 confirmed via `getComputedStyle`** — `PRODUCT` chip has `border-radius: 1.67e+07px` (clamps to full pill), while `Overdue 1d` next to it has `border-radius: 5.25px` (rounded-md). Same row, two different shapes. Zoom screenshot shows the pill / rectangle mismatch clearly.
- **I4 confirmed on /activity → Data Sources** — rows literally read "Meeting Notes" and "Calendar" while /today / /connections / /profile use "Granola" and "Google Calendar." Captured as `ss_*` zoom.
- **I6 confirmed on Cleared tab** — 5 "Approved" pills (green) next to 3 "Done" pills (same green). Cleared tab shows them stacked, mixed terminology for the same state.
- **I4 second instance on /profile → Stats chart legend** — legend reads `calendar / gmail / granola / linear / manual` (lowercase). Every other surface in the app uses Title Case.
- **NEW I13 — "1 tasks" pluralization bug** on /profile → Stats. "Top function this week: Ops · 1 tasks (100% of total)." Should be "1 task." JS regex confirms exactly one such literal on the page.
- **NEW I14 — Filter row chips have NO selected-state fill** while detail panel chips DO. Browser DOM check: filter row Product chip has `bg: rgba(0,0,0,0)` (transparent border-only) when selected; detail panel Product chip has `bg: rgb(244,114,182)` (solid pink fill) when selected. Same chip primitive, two different selection styles depending on context.

---

## I1 — Same-row "small label" pills use three different shapes

**Where it shows up**
Every task row on `/today`. Side-by-side on the same line: `P0` priority pill, `OPS` function chip, `Draft ready` status pill. Three pills, three different shapes.

**The code**

| Component | File | Class snippet |
|---|---|---|
| Priority pill (P0/P1/P2/P3) | `app/today/today-view.tsx:1517` | `rounded-md border px-1.5 py-0.5 text-[10px] font-bold` |
| Function chip (OPS/PRODUCT/QA/etc.) | `app/today/today-view.tsx:1389` | `rounded-full px-2 py-0.5 text-[10px] font-medium uppercase` |
| Status pill (Draft ready/Done/Approved) | `app/_components/status-pill.tsx:70` | `rounded-full px-2 py-0.5 text-[11px] font-medium` |
| Tag pill (`TagPill` in row.tsx) | `app/today/today-view.tsx:835` | `rounded-md px-2 py-0.5 text-[11px] font-medium` |

**Visual result:** P0 is a rectangle with rounded corners (chunky, bold), OPS is a full pill (uppercase, medium weight), Draft ready is a full pill (mixed case + icon). Sit next to each other on the same row.

**Recommendation — pick one shape, two variants max**

Introduce a single `<Chip />` primitive with two variants:

```tsx
// app/_components/chip.tsx
type ChipVariant = 'pill' | 'tag'    // pill = rounded-full, tag = rounded-md
type ChipSize = 'sm' | 'md'          // sm = text-[10px], md = text-[12px]

const VARIANT: Record<ChipVariant, string> = {
  pill: 'rounded-full px-2 py-0.5',
  tag:  'rounded-md px-1.5 py-0.5',
}
```

Mapping (suggested):
- Priority (P0/P1/P2/P3) → `variant="tag"` (the chunkier shape reinforces "click me to set")
- Function (PRODUCT/OPS/etc.) → `variant="tag"`
- Status (Draft ready/Done) → `variant="pill"` (read-only, softer)
- Source label (Granola/Gmail) → `variant="pill"`
- Entity (@person, @project) → `variant="pill"` (already pill, just keep)

Net effect: priority + function pills become the same shape (both `tag`) and read as "metadata about this task," while status pills stay round to signal "state." Two shapes instead of three, with a clear rule for which goes where.

---

## I2 — Pill padding has six variants for nine visual types

```
px-1.5 py-0.5   priority pill, count badges
px-2   py-0.5   tag pill, status pill, success pill
px-2.5 py-0.5   "shrink-0 rounded-full" success/danger pills (line 1588–1596)
px-2.5 py-1     function chip on filter bar (line 1365)
px-3   py-1     Save buttons
px-3   py-1.5   filter chip / source dropdown / group selector
```

Six padding pairs for things that all look like "small chip with text." Eye picks this up as misalignment even when it can't articulate why.

**Recommendation — three sizes only**

```tsx
const SIZE: Record<ChipSize, string> = {
  sm:  'px-2 py-0.5 text-[10px]',      // pills on row metadata
  md:  'px-2.5 py-1 text-[12px]',      // chips in filter bar / selectors
  lg:  'px-3 py-1.5 text-[13px]',      // toolbar buttons (Add task, Re-run)
}
```

Drop `px-1.5`, `px-2.5 py-0.5`, and `px-3 py-1` entirely. Everything snaps to the three sizes above.

---

## I3 — Five fixed-pixel font sizes for "small text"

`grep -rn 'text-\[' app/ | wc -l` shows `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[18px]` all used heavily. Each one was probably a tweak to fix a specific composition, but applied across surfaces it reads as noise.

**Recommendation — extend `@theme` with two more size tokens, ban inline `text-[Npx]`**

In `app/globals.css → @theme`:

```css
--text-xs: 11px;     /* tiny labels, count badges */
--text-sm: 12px;     /* row metadata, secondary text */
--text-base: 13px;   /* row body, buttons */
--text-lg: 16px;     /* section headers in panel */
--text-xl: 18px;     /* edit-mode title input */
```

Then `eslint-plugin-tailwindcss` rule (or a codemod) flags every remaining `text-\[\d+px\]`. Land the migration in one PR.

This also kills the `text-[10px]` vs `text-[11px]` split that's visible on tags vs status pills today (they're rendered next to each other and people can see the 1-pixel difference even if they can't name it).

---

## I4 — Source naming differs on every surface

The same five sources get five different display labels across the app.

| Source | code | /today filter | /connections | /activity Data Sources | /profile Stats |
|---|---|---|---|---|---|
| Granola | `'granola'` | "Granola" | "Granola" | **"Meeting Notes"** | "granola" (lowercase) |
| Google Calendar | `'calendar'` | "Google Calendar" | "Google Calendar" | **"Calendar"** | "calendar" (lowercase) |
| Gmail | `'gmail'` | "Gmail" | "Gmail" | "Gmail" | "gmail" (lowercase) |
| Linear | `'linear'` | "Linear" | "Linear" | "Linear" | "linear" (lowercase) |
| Manual | `'manual'` | "Manual" | n/a | n/a | "manual" (lowercase) |

The bolded cells are the active inconsistencies.

**Code evidence:**

- `app/today/today-view.tsx:1574` — `granola: 'Granola'`
- `app/activity/loaders.ts:233` — `granola: 'Meeting Notes'` ← divergent
- `app/profile/tabs/overview-tab.tsx:12` — `{ key: 'calendar', label: 'Google Calendar' }`

**Recommendation — single shared `SOURCE_LABELS` map**

```tsx
// lib/source-labels.ts
import type { Source } from './types'

export const SOURCE_LABELS: Record<Source, string> = {
  granola:  'Granola',
  gmail:    'Gmail',
  calendar: 'Google Calendar',
  linear:   'Linear',
  manual:   'Manual',
  slack:    'Slack',
}

export function sourceLabel(s: Source): string {
  return SOURCE_LABELS[s] ?? s
}
```

Then in `app/profile/tabs/stats-tab.tsx` (the chart legend currently shows lowercase), pass `sourceLabel(seriesKey)` to the legend. Same for `app/activity/loaders.ts` line 233 — remove the inline override.

While at it, drop the lowercase rendering in the stats chart legend; uppercase the first letter via the same `SOURCE_LABELS`.

---

## I5 — `entity-chip.tsx` uses raw Tailwind colors, bypassing the token system

```tsx
// app/_components/entity-chip.tsx:18
const dotColor =
  entity.kind === 'person'  ? 'bg-green-400'
  : entity.kind === 'project' ? 'bg-blue-400'
  : 'bg-orange-400'
```

Every other component in the app uses tokens (`bg-tag-action-fg`, `bg-success-fg`, etc.). The entity chip skipped that and went straight to `bg-green-400` / `bg-blue-400` / `bg-orange-400`. That's 1 of 4 hand-picked colors that won't track with a future theme tweak.

Also: `bg-blue-400` doesn't appear anywhere in `globals.css → @theme`. It's a Tailwind default that nobody else uses, so it'll read as a tiny "different shade of blue" next to the design-system blues.

**Recommendation**

```tsx
const dotColor =
  entity.kind === 'person'  ? 'bg-tag-commit-fg'   // green token
  : entity.kind === 'project' ? 'bg-tag-reply-fg'  // blue token
  : 'bg-tag-action-fg'                              // orange token
```

(Or add explicit `--color-entity-person`, `--color-entity-project`, `--color-entity-thread` to `@theme` if you want the entity chip's color identity to drift independently. Either is fine — just stop hand-picking from the Tailwind default palette.)

---

## I6 — "Approved" vs "Done" for the same end state

From the Cleared tab QA in Round 1: a Gmail reply that's been sent shows the green pill **"Approved"**, while a manual task that's been completed shows **"Done"**. Both use `StatusPill kind='done'` (same green, same icon) under the hood — only the label differs.

**Code:** `status-pill.tsx:13` defines `done: { label: 'Done', … }`, and a separate call site overrides `label="Approved"` for reply items (line 1596 in today-view.tsx).

Users will mentally bucket "Approved" and "Done" as different states. They aren't.

**Recommendation**

Pick one terminology, app-wide. Recommend "Done" because:
- It's already the default in `status-pill.tsx`.
- "Approved" implies a queue or pending-approval workflow that doesn't exist in this app (closest analogue is the "Awaiting approval" pill on Granola commit items).
- "Done" reads naturally for both replies-sent AND manual tasks.

If you want to preserve the source-of-truth signal (did the user approve a drafted reply vs. close a manual task?), use a tooltip on hover ("Approved by you May 31 at 3:09 PM") rather than a different visible label.

---

## I7 — Section-header capitalization and separators vary by surface

| Surface | Header style |
|---|---|
| Detail panel | `FUNCTIONS`, `SUBTASKS`, `DESCRIPTION` (uppercase, no count) |
| /today filter bar | `Group:` (sentence case + colon) |
| Calendar column | `TODAY` (uppercase, no count) |
| Group by Priority | `P0 - CRITICAL 2` (uppercase + hyphen + count) |
| Group by Due | `OVERDUE 3` (uppercase + count, no hyphen) |
| Group by Source | `GMAIL 13` (uppercase + count, no hyphen) |
| Group by Function | `PRODUCT 2`, `UNASSIGNED 28` (uppercase + count) |
| /activity day headers | `TODAY - MAY 31, 2026` (uppercase + hyphen + date) |

Three different separator conventions: bare ("OVERDUE 3"), hyphenated ("P0 - CRITICAL 2"), and colon ("Group:").

**Recommendation — one rule**

```
SECTION TITLE  <count or detail in muted color>
```

So:
- `OVERDUE  3` (count in `text-ink-muted`)
- `P0 — CRITICAL  2` (same — drop the hyphen in favor of either a single em-dash if allowed *or* drop "CRITICAL" entirely since the color already conveys it)
- `TODAY  MAY 31, 2026` (date in `text-ink-muted`)
- `Group:` → keep the colon since it's the only "label this control" instance, but distinguish it visually with `text-ink-muted`

Drop the hyphen separator from "P0 - CRITICAL" — it adds nothing the color doesn't.

---

## I8 — Empty states are inconsistent (mix of friendly / dev-speak / absent)

| Surface | Empty-state copy |
|---|---|
| /today filter with 0 results | (nothing — blank space) |
| Calendar "TASKS DUE" for a quiet day | "No tasks due on this day." ✓ |
| /profile Stats slop chart | (axes + legend render but no message) |
| /network | "Coming next session. We'll scan your Gmail history once, extract distinct senders/recipients…" — dev-speak |
| Slack card on /connections | "DMs and channels. Coming in Week 5 (needs auth feature)." — dev-speak |
| /today Open tab when 0 items | (unverified — never reproduced) |
| /activity Approvals if no replies | (unverified) |

**Recommendation — three empty-state shapes**

1. **Soft "nothing to show right now"** — list-style, e.g. "No tasks due on this day." Use everywhere a list goes empty due to filters or chronology.
2. **Forward-looking "coming soon"** — friendly, no internal jargon. Replace "Coming next session" and "Coming in Week 5" with "Coming soon" + a one-liner about value to the user, not the build plan.
3. **Onboarding nudge for new users** — when the data is genuinely absent (no slop feedback yet, no Linear connected, etc.), point at the action that fills it: "No slop feedback in the last 30 days. Mark items as slop on /today to start training the extractors."

Specific copy fixes:
- /network → "We'll show everyone you've emailed with, grouped by organization. Coming soon."
- Slack → "Slack messages. Coming soon."
- /profile Stats chart → "No slop feedback in the last 30 days. Mark items as slop to start training."
- /today filter with 0 results → "Nothing matches these filters. Reset filters."

---

## I9 — Modal / Sheet / inline-edit triggered by similar-looking buttons

Three create/edit workflows, three different UI patterns:

- **Add task** (toolbar button) → `Sheet` slides from the right (`app/today/add-task-panel.tsx`).
- **Open task detail** (click row) → custom right-column panel (not a Sheet, slides in via `PanelColumn` in `today-shell.tsx`).
- **Edit task title** (pencil in detail panel) → inline form replaces the title in the existing panel.

Each is internally correct, but to the user "right-side panel slides in" is happening three different ways. The Add task Sheet and the detail panel even overlap visually because they share the same screen edge.

**Recommendation — collapse into two**

- Keep **inline edit** for in-place title/description changes. Already works.
- Use the same **right-column panel** for Add task AS the detail panel. New manual task opens an empty detail panel (no item yet, just an empty title field with a focused cursor + Functions chips + Due date). Submit creates the item AND keeps the panel open showing the new task.

Net: one "right column panel" pattern for both creating and editing tasks, instead of two. Reduces motion ambiguity AND lets you delete `app/today/add-task-panel.tsx` once the detail panel handles the empty-item case.

---

## I10 — Filter-chip vs Function-chip selected state is the same shape but different weight

On `/today` the top filter row has chips (All / Product / Ops / QA / Hiring / Go-to-Market) that act as filters. The same chips appear in the detail panel's FUNCTIONS section to assign tags. Visually:

- **Filter row chip (selected):** filled with the function color (e.g. pink for Product, dark backing).
- **Detail panel chip (selected):** same filled backing.
- **Filter row chip (unselected):** outline + colored text.
- **Detail panel chip (unselected):** same outline + colored text.

So far so good — but in my Round 1 testing I noted "no selected state" because the difference is subtle. In Round 3 I retracted that: there IS a difference, but it's a ~20% fill opacity bump.

**Recommendation — visual rules**

Bump the selected-state contrast OR add a checkmark icon:

```tsx
// Selected
'bg-{color}-fg/20 ring-1 ring-{color}-fg text-{color}-fg'
// Unselected (unchanged)
'border border-{color}-fg/40 text-{color}-fg'
```

The added `ring-1` reads as "this one is on" much more clearly than fill alone.

Also: today the filter row chip and the detail panel chip do the same job (sort of), but in opposite directions — filter narrows the *list*, panel toggles *this task's* tag. Worth a tiny copy distinction: filter row chips should hover-tooltip "Filter to Product" while panel chips hover-tooltip "Tag as Product." Same shape, different verb.

---

## I11 — Card border-radius split: `rounded-md` vs `rounded-lg` vs `rounded-2xl`

From the grep:

- `rounded-md` — most pills, popovers, error boxes
- `rounded-lg` — most cards (`<Card>` from shadcn, e.g. /profile Overview tiles)
- `rounded-2xl` — one instance

Cards consistently use `rounded-lg`, pills use `rounded-md` or `rounded-full`. That's actually a decent rule. The one `rounded-2xl` is likely a leftover from an experiment.

**Recommendation** — kill the `rounded-2xl` instance, document the rule:

```
rounded-md   → small chrome (pills not using rounded-full, error boxes)
rounded-lg   → cards, popovers, drawers
rounded-full → status pills, count badges, entity chips
```

Add to `CLAUDE.md` or a `docs/ui-conventions.md`.

---

## I12 — Date / time formatting varies by surface

Spotted in screenshots:

- Task row "Overdue 1d" — relative, lowercase
- Calendar "SAT, MAY 2" — day-abbrev + month-abbrev uppercase
- Activity "TODAY - MAY 31, 2026" — uppercase + full date
- Calendar event "9:00 AM – 9:30 AM" — 12-hour, en-dash separator
- "Blocked 2:30 AM – 10:00 AM" — same
- Approvals row "5:25 PM" — 12-hour with no date qualifier

Six formats. The screenshot caught only a fraction.

**Recommendation — centralize**

`lib/format-datetime.ts`:

```ts
export const fmt = {
  relative: (d: Date) => …,         // "Overdue 1d", "5h ago"
  dayHeader: (d: Date) => …,        // "Sat, May 2" (sentence case)
  dateLong: (d: Date) => …,         // "May 31, 2026"
  timeShort: (d: Date) => …,        // "9:00 AM"
  timeRange: (s: Date, e: Date) => …, // "9:00 AM – 9:30 AM" (en-dash)
}
```

Migrate all call sites. Two wins: consistent format, AND the same `nowFromServer` instance feeds every call — which fixes P0-1 hydration mismatch (relative-time was the most likely culprit).

---

## Suggested ship order

Each is a small focused PR.

1. **I12 (date format)** — biggest payoff per line of code, and it likely fixes the lingering P0-1 hydration error. Do this first.
2. **I4 (source names)** — change `app/activity/loaders.ts:233` from `'Meeting Notes'` → `'Granola'`, lift the SOURCE_LABELS map to `lib/source-labels.ts`, uppercase the stats chart legend. ~30 lines.
3. **I6 (Approved → Done)** — single label change at one call site.
4. **I1 + I2 + I3 (Chip primitive + size tokens)** — bigger refactor but one focused PR. Replace every inline pill class with `<Chip variant="…" size="…" />`.
5. **I5 (entity-chip raw colors)** — three-line fix, do alongside I1.
6. **I8 (empty states)** — copy-only changes, fast.
7. **I7 (section header rule)** — light visual refactor.
8. **I10 (filter vs function chip distinction)** — tooltip + ring addition.
9. **I11 (kill rounded-2xl, document rule)** — last because it's chrome.
10. **I9 (merge Add task into detail panel)** — biggest UX change; do once everything else is stable so it doesn't regress with other in-flight UI work.

---

## I15 — Cleared row click is dead; Unread row click does something side-effecty

**Verified live at 10:48 PM.**

| Tab | Click on a row does what? |
|---|---|
| Open | Opens the detail panel (right-column). ✓ |
| Prep | Opens the detail panel (right-column). ✓ |
| Unread | (a) Calls extractor + draftReply on the thread → (b) creates a new "Reply to X re: Y" item in `items` → (c) decrements Unread count by 1, increments Open count by 1 → (d) opens the detail panel on the *new* reply task. Takes ~3 seconds with no loading state shown. |
| Cleared | Nothing. `hasDetailPanel: false`, no panel opens, no toast, no nav. Dead click target. |

So row-click does **four different things** across four tabs. From a user's point of view, clicking the same-looking row sometimes opens a panel, sometimes silently generates a draft and *then* opens a panel, sometimes does nothing.

**Recommendation**

- **Cleared rows should open the detail panel in a read-only view.** Same panel shell, but actions are disabled or replaced with "Reopen" (un-complete) and "Move to slop" (mark as bad data). Click-to-inspect what was done is the most-requested thing for a Cleared list anywhere — Asana, Linear, GitHub Issues all do this.
- **Unread row click should show a loading state** during the ~3-second draft generation. Currently the row just sits there. Add a row-level spinner + disabled state while the draft is being generated, then transition to opening the panel.
- **The Unread → Open auto-promotion** is actually a powerful feature (click an unread email → instant draft + panel). But it should be communicated. Suggest: row caption changes during loading ("Drafting reply…") and the moved-to-Open row briefly highlights so the user understands what happened.

---

## I16 — Open / Prep / Cleared / Unread use four different card templates

For the same conceptual "task row," each tab renders a different layout:

| Field | Open | Prep | Cleared | Unread |
|---|---|---|---|---|
| Source icon | ✓ | ✓ | ✓ | ✓ |
| Priority pill | ✓ | ✓ | — | — |
| Subtask count pill (`0/10`) | ✓ | — | — | — |
| Function pill (PRODUCT/OPS) | ✓ | — | — | — |
| Status pill (Overdue/Awaiting) | ✓ | ✓ | ✓ ("Approved"/"Done") | ✓ ("Unread") |
| Title (style) | bold | bold | bold + strikethrough | bold |
| Subtitle (description) | ✓ | meeting attendees | body preview | sender · preview |
| Subtask checkbox list | ✓ (visible 2) | — | — | — |
| "+ N more" expansion | ✓ | — | — | — |
| Time / date display | "Overdue 1d" / "Due Thursday" | full event time range | — | "22h ago" / "Thu" / "May 11" |
| Right-side accent | hover actions | "Join" button | — | "Unread" pill |

That's four template variants. Many of the fields could be present-but-hidden-when-empty (e.g. show subtask count whenever subtasks exist, hide otherwise) and the result would be one card that renders ~the same shape per row.

**Recommendation — one card, four states**

```tsx
<TaskCard
  source={item.source}
  priority={item.priority}            // hidden when null
  title={item.title}
  subtitle={item.subtitle}
  functions={item.function_ids}        // hidden when empty
  subtaskSummary={item.subtasks}       // hidden when 0/0
  status={item.status}                 // controls strikethrough + status pill
  rightAccent={…}                      // tab-specific (Unread pill, Join button, hover actions, etc.)
  appearance={tab === 'cleared' ? 'muted' : 'default'}
/>
```

Rules:
- **Strikethrough title** stays Cleared-only. The visual "this is done" cue is the strongest signal.
- **Priority + Subtask + Function pills** appear *whenever those fields have values*. Don't hide them by tab. A cleared task that had P0 + 8 subtasks should still show P0 + 8/8 done (or "8 of 8 done" in muted text).
- **Status pill** is consistent across tabs: Open shows Overdue/Awaiting; Cleared shows Done (resolves I6 along the way); Unread shows "Unread" or arrival time.
- **Hover actions** appear on Open + Cleared rows (Cleared rows offer "Reopen" instead of "Dismiss"); not on Unread (which has its own click semantics).

Net visual: the user sees the same row anatomy on every tab, just with the appropriate fields populated. Today's "completely different card per tab" pattern is the visual equivalent of having four separate apps.

---

## I13 — "1 tasks" pluralization

**Where:** /profile → Stats → "TOP FUNCTION THIS WEEK" card shows "1 tasks (100% of total)" when Ops only has one item assigned. Should be "1 task."

**Fix** — a one-line helper:

```ts
// lib/format.ts
export const plural = (n: number, singular: string, plural?: string) =>
  `${n} ${n === 1 ? singular : (plural ?? singular + 's')}`
```

Then `plural(count, 'task')` everywhere a count + noun gets rendered. Worth a grep for `${...}\s*(tasks|items|emails|calls|errors)` to find similar bugs in the codebase.

---

## I14 — Filter row chip vs detail panel chip use opposite selected-state styles

**Where:** /today filter row at the top has the same five function chips (Product / Ops / QA / Hiring / Go-to-Market) that the detail panel's FUNCTIONS section has. But the selected state is rendered differently:

- **Filter row, selected** = transparent background, colored border-only (DOM check: `bg: rgba(0,0,0,0)`)
- **Detail panel, selected** = solid colored background, white text (DOM check: `bg: rgb(244,114,182)` for Product)

Two surfaces, same component, opposite visual cues for "this is on." If a user toggles Product on the filter row, then later opens a task with Product assigned, the chip looks "off" in one place and "on" in the other, even though both states are "selected."

**Recommendation — pick one selected style, app-wide**

The detail panel style (solid fill + white text) wins on contrast — easier to scan whether a function is assigned. Apply it to filter row too. The filter row's current border-only-with-colored-text state should become the unselected fallback (which is also what it is on the detail panel).

```tsx
// Single source of truth
const FUNCTION_CHIP_STATES = {
  off: 'bg-transparent border-{color}/40 text-{color}-fg',
  on:  'bg-{color}-fg text-canvas border-{color}-fg',
}
```

Net: clicking a function chip anywhere produces the same visual change.

---

## What I couldn't audit from code alone (need browser pass)

- **Color contrast** for `text-ink-muted` (`#a3a3a3`) on `bg-surface` (`#141414`) — should pass WCAG AA but I didn't measure.
- **Animation timing** consistency — multiple slide-in / fade-in durations may exist.
- **Focus-ring visibility** on every interactive element — I sampled three buttons in Round 3, not all 254 focusables.
- **Real responsive breakpoints** beyond the login page (resize_window doesn't actually narrow Chrome).
- **Dark / light mode** — the app is dark-only; if a light mode is on the roadmap, the tokens are already set up for it but no `prefers-color-scheme` tested.

— Claude QA, UI consistency audit

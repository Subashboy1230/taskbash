# Cursor fix instructions — open bugs + UI inconsistencies

One document. Everything still open from QA rounds 1-4 + the UI consistency audit. Bugs already fixed in `dd6595b`, `bebb5b5`, `5408fa7` etc. are NOT in this doc.

**How to use:** ship one block at a time. Each block is independent unless marked `[depends on …]`. After each block, run `tsc --noEmit && npm run build && npm run lint` and verify the acceptance criteria.

**Style rules for every block:** no em-dashes in any UI string or AI prompt. No `text-[Npx]` inline sizes — use the new tokens introduced in Block 1. No raw Tailwind colors (`bg-green-400` etc.) — use design tokens.

---

## Block 1 — Date / time format library (likely fixes P0-1 hydration + I12)

The hydration error #418 on every /today load is almost certainly a relative-time string (`"Overdue 1d"`, `"Due Thursday"`) computed at render time with `new Date()`. Server and client compute different values across the request boundary.

### Files

```
lib/format-datetime.ts   NEW
app/today/today-view.tsx EDIT
app/today/today-calendar-column.tsx EDIT
app/activity/loaders.ts  EDIT
app/today/page.tsx       EDIT  (pass nowFromServer as prop)
```

### Changes

```ts
// lib/format-datetime.ts — NEW
export interface Fmt {
  /** "Overdue 1d", "Due in 3h", "5h ago" */
  relative(d: Date | string, now: Date): string
  /** "Sat, May 2" */
  dayHeader(d: Date | string): string
  /** "May 31, 2026" */
  dateLong(d: Date | string): string
  /** "9:00 AM" */
  timeShort(d: Date | string): string
  /** "9:00 AM - 9:30 AM" (en-dash 0x2013, NOT em-dash) */
  timeRange(start: Date | string, end: Date | string): string
  /** "TODAY", "MAY 31, 2026" — uppercase section headers */
  sectionTitle(d: Date | string, now: Date): string
}

export const fmt: Fmt = { /* implementations using Intl.DateTimeFormat */ }
```

`page.tsx` (server component):

```tsx
export default async function TodayPage() {
  const nowFromServer = new Date()
  // ...load digest
  return <TodayShell ... nowFromServer={nowFromServer.toISOString()} />
}
```

Every component that previously called `new Date()` or rendered "X ago" now receives `nowFromServer: string`, parses once with `new Date(nowFromServer)`, and uses `fmt.relative(item.due_at, now)`.

### Grep checklist before merging

```
grep -rn "new Date()" app/ lib/ --include="*.tsx"
grep -rn "Date.now()" app/ lib/ --include="*.tsx"
grep -rn "ago\|Overdue\|Due tomorrow" app/today --include="*.tsx"
```

Every hit should either be inside `lib/format-datetime.ts` or take `now` as a parameter.

### Acceptance

- [ ] /today loads with **zero console errors**. React error #418 gone.
- [ ] Date strings across /today, /activity, calendar column, /profile use exactly the formats above. No other format leaks.
- [ ] `tsc --noEmit && npm run build` clean.

---

## Block 2 — HTML entity decode in Gmail subtitle pipeline (fixes P0-3 + P1-2)

Live audit at 10:16 PM: still 3 instances of literal `&#39;` on /today body text (`I&#39;m`, `I&#39;ll`, `it&#39;s`). Also the subtitle for Gmail rows is raw HTML preheader plus boilerplate ("View this email in your browser You are receiving this email because…").

### Files

```
lib/extract/gmail.ts     EDIT
lib/html.ts              NEW
scripts/backfill-subtitle-entities.ts  NEW  (one-time)
```

### Changes

```ts
// lib/html.ts — NEW
const ENTITY_MAP: Record<string, string> = {
  '&#39;': "'",
  '&apos;': "'",
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

const BOILERPLATE_PATTERNS = [
  /^view this email in your browser\.?\s*/i,
  /^you are receiving this email because[\s\S]*?(\.|$)/i,
  /^unsubscribe[\s\S]*?(\.|$)/i,
  /^if you no longer wish to receive[\s\S]*?(\.|$)/i,
]

export function decodeEntities(s: string): string {
  let out = s
  for (const [from, to] of Object.entries(ENTITY_MAP)) {
    out = out.replaceAll(from, to)
  }
  return out
}

export function stripEmailBoilerplate(s: string): string {
  let out = s.trim()
  for (let i = 0; i < 3; i++) {
    for (const re of BOILERPLATE_PATTERNS) {
      out = out.replace(re, '').trim()
    }
  }
  return out
}

export function cleanSubtitle(raw: string): string {
  return stripEmailBoilerplate(decodeEntities(raw)).slice(0, 240).trim()
}
```

In `lib/extract/gmail.ts → buildSubtitle()` (or whatever assembles `items.subtitle`):

```ts
import { cleanSubtitle } from '../html'

// existing code that builds the preview …
return cleanSubtitle(preview)
```

### Backfill script

```ts
// scripts/backfill-subtitle-entities.ts — one-time
import { supabase } from '@/lib/supabase'
import { cleanSubtitle } from '@/lib/html'

const { data } = await supabase
  .from('items')
  .select('id, subtitle')
  .or('subtitle.like.%&#39;%,subtitle.like.%&quot;%,subtitle.like.%&amp;%')
  .eq('source', 'gmail')

for (const row of data ?? []) {
  await supabase.from('items').update({ subtitle: cleanSubtitle(row.subtitle ?? '') }).eq('id', row.id)
}
```

Run once: `npx tsx scripts/backfill-subtitle-entities.ts`. Do NOT add as a migration.

### Acceptance

- [ ] `document.body.innerText.match(/&#39;/g)` on /today returns null.
- [ ] No row subtitle starts with "View this email in your browser" or "You are receiving this email because".
- [ ] Existing readable rows unchanged.

---

## Block 3 — Chip primitive (fixes I1 + I2 + I3 + I10 + I14)

Right now three chips sit on every row — `P0` (rounded-md), `PRODUCT` (rounded-full), `Overdue 1d` (rounded-md). Six padding pairs. Five fixed-pixel font sizes. The filter row and detail panel render selected-state opposite to each other.

### Files

```
app/_components/chip.tsx                 NEW
app/_components/status-pill.tsx          EDIT (use Chip internally)
app/_components/entity-chip.tsx          EDIT (use Chip + tokens, not raw colors)
app/today/today-view.tsx                 EDIT (replace 30+ inline chip class strings)
app/today/add-task-panel.tsx             EDIT
app/globals.css                          EDIT (add size tokens)
```

### Design tokens to add

```css
/* app/globals.css → @theme */
--text-xs:   11px;   /* row metadata, count pills */
--text-sm:   12px;   /* chips, secondary text */
--text-base: 13px;   /* row body, buttons */
--text-lg:   16px;   /* panel section heads */
--text-xl:   18px;   /* edit-mode title input */
```

Drop the inline `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[18px]` usages and let Tailwind v4 pick these up automatically as `text-xs`, `text-sm`, etc.

### Chip primitive

```tsx
// app/_components/chip.tsx — NEW
import { cn } from '@/lib/utils'
import { type ReactNode } from 'react'

export type ChipVariant = 'pill' | 'tag'
export type ChipSize    = 'sm' | 'md' | 'lg'
export type ChipState   = 'on' | 'off' | 'static'

const VARIANT: Record<ChipVariant, string> = {
  pill: 'rounded-full',
  tag:  'rounded-md',
}

const SIZE: Record<ChipSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
}

// Selected-state contract: on = filled bg + canvas text; off = border + colored text.
// Both filter row AND detail panel use this same rule (resolves I14).
const STATE: Record<ChipState, string> = {
  on:     'bg-current text-canvas border-transparent [&_*]:text-canvas',
  off:    'bg-transparent border-current',
  static: 'bg-current/15 border-current/30',
}

interface ChipProps {
  variant?: ChipVariant
  size?: ChipSize
  state?: ChipState
  color?: 'reply' | 'action' | 'commit' | 'fyi' | 'danger' | 'success' | 'muted'
  icon?: ReactNode
  children: ReactNode
  className?: string
  onClick?: () => void
  ariaLabel?: string
}

const COLOR: Record<NonNullable<ChipProps['color']>, string> = {
  reply:   'text-tag-reply-fg',
  action:  'text-tag-action-fg',
  commit:  'text-tag-commit-fg',
  fyi:     'text-tag-fyi-fg',
  danger:  'text-danger-fg',
  success: 'text-success-fg',
  muted:   'text-ink-muted',
}

export function Chip({
  variant = 'pill', size = 'sm', state = 'static',
  color = 'muted', icon, children, className, onClick, ariaLabel,
}: ChipProps) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 border font-medium transition-colors',
        VARIANT[variant],
        SIZE[size],
        COLOR[color],
        STATE[state],
        onClick && 'hover:opacity-80',
        className,
      )}
    >
      {icon}
      {children}
    </Tag>
  )
}
```

### Migration rules (apply consistently across `today-view.tsx`)

| Old pattern | New |
|---|---|
| Priority pill (`P0`/`P1`/…) | `<Chip variant="tag" size="sm" state={isAuto ? 'off' : 'on'} color={priorityColor}>` |
| Function pill (`PRODUCT`/`OPS`/…) | `<Chip variant="tag" size="sm" state="static" color={functionColor}>` |
| Status pill (`Draft ready`, `Overdue 1d`, …) | `<Chip variant="pill" size="sm" state="static" color={statusColor} icon={<…/>}>` |
| Filter row chip (selected) | `<Chip variant="pill" size="md" state="on" color={functionColor}>` |
| Filter row chip (unselected) | `<Chip variant="pill" size="md" state="off" color={functionColor}>` |
| Detail panel FUNCTIONS chip (selected) | identical to filter row "on" — resolves I14 |
| Entity chip (@person etc.) | `<Chip variant="pill" size="sm" state="static" color="commit">` |
| Count badge (`0/10`) | `<Chip variant="tag" size="sm" state="static" color="muted">` |

### Acceptance

- [ ] No inline `rounded-full px-… text-[…px]` chip class strings remain in `today-view.tsx`. Grep confirms.
- [ ] `text-[10px]` / `text-[11px]` / `text-[12px]` / `text-[13px]` / `text-[18px]` literals are all gone (use `text-xs` / `text-sm` / `text-base` etc).
- [ ] `entity-chip.tsx` no longer references `bg-green-400` / `bg-blue-400` / `bg-orange-400`.
- [ ] Filter row chip and detail panel chip render IDENTICAL "on" state.
- [ ] Status pill, priority chip, function chip use only `rounded-full` or `rounded-md` — no inline variations.

---

## Block 4 — Single `TaskCard` component for all four tabs (fixes I15 + I16 + P3-1 + I6 + P1-9)

Today Open / Prep / Cleared / Unread render four different layouts. Cleared row click does nothing. Unread row click silently kicks off a 3-second Claude call. The subtask count pill goes stale until the panel is reopened.

### Files

```
app/today/_components/task-card.tsx       NEW
app/today/today-view.tsx                  EDIT (use TaskCard everywhere)
app/today/actions.ts                      EDIT (add openClearedItem path)
```

### `<TaskCard>` API

```tsx
interface TaskCardProps {
  item: MockItem
  appearance: 'default' | 'muted'    // muted = cleared/dismissed
  rightAccent?: ReactNode             // tab-specific (Unread pill, Join btn, etc.)
  onSelect: () => void                // click → open panel
  loading?: boolean                   // for Unread → drafting state
  hoverActions?: ReactNode            // Dismiss/Complete/Slop/Snooze hover icons
}
```

Render rules (applied uniformly across tabs):

- **Strikethrough** title appears when `item.status === 'completed' || 'dismissed'`.
- **Priority pill** appears when `item.priority` is set, regardless of tab.
- **Subtask count pill** appears when `item.subtasks.length > 0`, regardless of tab. Driven by the same store as the panel so the row pill never goes stale (P1-9).
- **Function pill** appears when `item.function_ids.length > 0`, regardless of tab.
- **Status pill** uses the unified `'done'` label everywhere (resolves P3-1 / I6 — no more "Approved" for replies and "Done" for manuals).

### Tab routing in `today-view.tsx`

```tsx
{activeTab === 'open' && (
  <TaskCard item={i} onSelect={() => openPanel(i)}
    hoverActions={<TriageIcons item={i} />} />
)}

{activeTab === 'prep' && (
  <TaskCard item={i} onSelect={() => openPanel(i)}
    rightAccent={<JoinButton meetingUrl={i.meeting_url} />} />
)}

{activeTab === 'cleared' && (
  <TaskCard item={i} appearance="muted" onSelect={() => openClearedPanel(i)}
    hoverActions={<ReopenIcons item={i} />} />
)}

{activeTab === 'unread' && (
  <TaskCard item={i} onSelect={() => promoteUnreadAndOpen(i)}
    loading={pendingDraftIds.has(i.id)}
    rightAccent={
      <span className="text-ink-faint">{fmt.relative(i.received_at, now)}</span>
    } />
)}
```

### Cleared panel — read-only variant

`openClearedPanel` opens the same detail panel but in read-only mode:

- Subtask checkboxes disabled
- Edit pencil hidden
- Bottom action bar shows **Reopen** (status='open') and **Move to slop** instead of Dismiss / Mark as Done
- Send-now / Open-in-Gmail hidden (the task is done)

### Unread row click — loading state + auto-promotion

`promoteUnreadAndOpen(item)`:

```ts
1. setPendingDraftId(item.id)       // row shows spinner + disabled
2. const newItem = await openUnreadThread(item)  // existing server action
3. setPendingDraftId(null)
4. openPanel(newItem)                // panel slides in on the NEW reply task
5. toast({ text: `Drafted reply, moved to Open` })  // brief 3s toast
```

Row caption during loading: change "Hi Subash, …" → **"Drafting reply…"** in muted text.

### Acceptance

- [ ] Click on a Cleared row opens the detail panel in read-only mode. `hasDetailPanel: true`.
- [ ] Click on an Unread row shows row-level spinner for ~3s, then the detail panel opens on the new reply task. A toast confirms the promotion.
- [ ] All four tabs render rows using `<TaskCard>` (no parallel render paths).
- [ ] Priority pill, subtask count pill, function pill all appear on Cleared rows whenever the underlying data has values.
- [ ] Subtask count pill updates within 500ms of toggling a subtask in the panel (P1-9 resolved).
- [ ] Cleared status pill says "Done" (not "Approved") on Gmail replies. Same pill across sources.

---

## Block 5 — Mark-all-subtasks-done auto-completes the parent (fixes P0-12)

### Files

```
app/today/actions.ts    EDIT  (toggleSubtask)
```

### Change

In `toggleSubtask(subtaskId)`, after the optimistic toggle and DB update:

```ts
const { data: parent } = await supabase
  .from('items')
  .select('id, status, subtask_count, subtask_done_count')
  .eq('id', parentId).single()

if (parent && parent.subtask_count > 0 && parent.subtask_done_count === parent.subtask_count) {
  await supabase
    .from('items')
    .update({ status: 'completed', completed_at: new Date().toISOString(), auto_completed_reason: 'all_subtasks_done' })
    .eq('id', parentId)
  void writeTaskEvent(userId, parentId, 'auto_completed_via_subtasks')
}
```

(If `subtask_count` / `subtask_done_count` aren't denormalized columns, derive them via a fresh `COUNT(*) WHERE parent_id = $parent`.)

Show a brief toast on the auto-completion: `"All subtasks done. Task marked complete."` with an `Undo` action that flips status back to 'open'.

### Acceptance

- [ ] Open the SpendHound P0 task. Check off all 10 subtasks. The parent moves to Cleared automatically. A toast shows. Undo works.
- [ ] Existing already-done parents are untouched (only auto-complete on the 0→done transition).

---

## Block 6 — Empty-title Add task shows an inline error (fixes P0-11)

### Files

```
app/today/add-task-panel.tsx   EDIT
```

### Change

Bind a `useState<string | null>(null)` to `titleError`. On submit:

```tsx
if (!title.trim()) {
  setTitleError('Title is required.')
  titleInputRef.current?.focus()
  return
}
```

Render under the title input:

```tsx
{titleError && (
  <p className="mt-1 text-xs text-danger-fg">{titleError}</p>
)}
```

Plus border-color flip on the input when `titleError`.

### Acceptance

- [ ] Click Create with empty title → inline "Title is required." appears under the input, input gets red border, focus returns to the input. No silent fail.
- [ ] Type something → error clears.

---

## Block 7 — Pencil edit refreshes panel header (fixes P0-7)

### Files

```
app/today/today-shell.tsx   EDIT
app/today/today-view.tsx    EDIT (DetailPanel saveEdit callback)
```

### Change

`today-shell.tsx`:

```tsx
const handleEditSaved = (updates: Partial<MockItem>) => {
  setDisplayedItem(prev => prev ? { ...prev, ...updates } : prev)
  router.refresh()  // sync the row
}
```

Pass `handleEditSaved` to `<DetailPanel>` and call it after a successful Save server action.

### Acceptance

- [ ] Open detail panel → pencil → change title → Save → panel header updates within 500ms (no need to close and reopen).

---

## Block 8 — Subtask spinner disappears the moment any subtask renders (fixes P1-4)

### Files

```
app/today/today-view.tsx   EDIT (DetailPanel subtask render block)
```

### Change

```tsx
{generating && subtasks.length === 0 && (
  <div className="text-xs text-ink-muted">Generating description and subtasks...</div>
)}
```

The `&& subtasks.length === 0` guard kills the spinner the instant the first subtask materializes.

### Acceptance

- [ ] Open a freshly extracted task. The spinner shows briefly, then disappears as soon as the first subtask appears.

---

## Block 9 — Manual Add task does NOT auto-generate description + subtasks (fixes P0-8 + P1-11)

The manual task `"QA test task -- please ignore"` got a contradictory auto-description ("this task should be ignored and closed") AND auto-generated subtasks ("Confirm task generation system processed input correctly").

### Files

```
app/today/add-task-panel.tsx     EDIT  (onSubmit)
app/today/actions.ts             EDIT  (createManualItem)
```

### Change

`createManualItem` should NOT call `generateItemDetails` for manual tasks. Title saves as-is, description stays empty, subtasks stay empty. If the user wants a brief, they can click a button (out of scope).

In `generateItemDetails` (if it can still be invoked manually), add the guard:

```ts
if (item.source === 'manual') return { skipped: 'manual_no_autogen' }
```

### Acceptance

- [ ] Add a manual task. Open it. The detail panel shows ONLY the title. No description. No subtasks. No "Generating description and subtasks..." spinner.
- [ ] Open count increments by exactly 1.

---

## Block 10 — Source naming + dev-speak copy (fixes P2-1 + P2-2 + I4 + P2-3 + P2-8)

### Files

```
lib/source-labels.ts                NEW
app/activity/loaders.ts             EDIT (kill 'Meeting Notes')
app/profile/tabs/stats-tab.tsx      EDIT (chart legend uses sourceLabel())
app/connections/connections-view.tsx EDIT (Slack copy)
app/network/page.tsx                 EDIT (page copy)
```

### Changes

```ts
// lib/source-labels.ts — NEW
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

Update `app/activity/loaders.ts:233` — remove the inline override that returned `'Meeting Notes'` for granola and `'Calendar'` for calendar. Use `sourceLabel()`.

Update `app/profile/tabs/stats-tab.tsx` — pass `sourceLabel(seriesKey)` to the chart legend so legend stops being lowercase.

Update copy:

```diff
- DMs and channels. Coming in Week 5 (needs auth feature).
+ Slack messages. Coming soon.

- Coming next session. We'll scan your Gmail history once, extract distinct senders/recipients, derive each person's org from their email domain, and cache it for fast lookups.
+ Everyone you've emailed with, grouped by organization. Coming soon.
```

### Acceptance

- [ ] /activity Data Sources shows "Granola" and "Google Calendar" (matches /today, /connections, /profile).
- [ ] /profile Stats chart legend is Title Case ("Gmail", "Granola", "Google Calendar", "Linear", "Manual").
- [ ] /connections Slack and /network copy reads as user-friendly, no "Week 5" / "needs auth feature" / "Coming next session" leaks.

---

## Block 11 — Approved → Done unification (fixes P3-1 + I6)

Already covered structurally by Block 4 (TaskCard uses unified status pill). Belt-and-suspenders:

### Files

```
app/_components/status-pill.tsx   EDIT
app/today/today-view.tsx          EDIT (any direct status pill call sites)
```

### Change

In `status-pill.tsx`, kill the per-source label override. `kind='done'` always renders `"Done"`. Remove the call site that overrides `label="Approved"` for reply rows.

If the source-of-truth signal matters, surface it via tooltip on hover: `<Chip ... title={`Approved ${fmt.dateLong(item.completed_at)}`}>`.

### Acceptance

- [ ] Cleared tab shows "Done" pill on every cleared item, regardless of whether the source was a Gmail reply or a manual task.
- [ ] Hover tooltip on Gmail-reply cleared items reveals the approval timestamp.

---

## Block 12 — Plural helper + grep sweep (fixes I13)

### Files

```
lib/plural.ts                       NEW
app/profile/tabs/stats-tab.tsx      EDIT
```

### Change

```ts
// lib/plural.ts — NEW
export const plural = (n: number, singular: string, plural?: string) =>
  `${n} ${n === 1 ? singular : (plural ?? singular + 's')}`
```

`stats-tab.tsx`:

```tsx
- {n} tasks ({pct}% of total)
+ {plural(n, 'task')} ({pct}% of total)
```

Then `grep -rE "\\\$\\{[^}]+\\}\\s*(tasks|items|emails|calls|errors|drafts|threads)"` and apply `plural()` everywhere.

### Acceptance

- [ ] "Top function this week" card reads "1 task" not "1 tasks".
- [ ] All `${n} X` patterns in the codebase route through `plural()`.

---

## Block 13 — Greeting per tab (fixes P1-8)

### Files

```
app/today/today-view.tsx   EDIT
```

### Change

```tsx
const GREETINGS: Record<TabKind, (digest: Digest) => string> = {
  open: d => d.open_items.length > 50
    ? 'Heavy day. Triage the top of the list first.'
    : `${plural(d.open_items.length, 'thing')} on your list.`,
  prep: () => 'Prep for upcoming meetings.',
  cleared: d => `${plural(d.completed_today.length, 'item')} cleared today. Nice work.`,
  unread: d => `${plural(d.unread_count, 'thread')} need a look.`,
}

<h1>{GREETINGS[activeTab](digest)}</h1>
```

### Acceptance

- [ ] Greeting changes per tab. No "Heavy day. Triage..." on Cleared or Unread.

---

## Block 14 — Em-dash removal from Voice generator + regenerate (fixes P0-5)

### Files

```
lib/voice/generate.ts   EDIT
```

### Change

Append to the Voice system prompt:

```
Output rules:
- Never use em-dashes (--). Use periods, parentheses, colons, or single hyphens.
- Never use en-dashes (--). Use single hyphens.
```

Then trigger Regenerate from /profile → Voice to overwrite the existing prose.

### Acceptance

- [ ] `select count(*) from user_voices where voice_text ~ '[\\u2014\\u2013]'` returns 0 after regeneration.

---

## Block 15 — Snoozed row reflow (fixes P1-10)

### Files

```
app/today/today-shell.tsx   EDIT
```

### Change

Already partly correct — `filteredDigest` filters by `shellHiddenIds`. The gap is likely framer-motion's exit animation leaving residual height. Wrap the row in `<AnimatePresence>` and set `layout` on the row container so siblings reflow as the row exits:

```tsx
<motion.li
  layout
  initial={{ opacity: 1, height: 'auto' }}
  exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
  transition={{ duration: 0.18 }}
>
```

### Acceptance

- [ ] Snooze a task. The row collapses (no white-space gap), siblings move up smoothly.

---

## Block 16 — Toolbar buttons absolute-position when panel opens (fixes P1-14)

### Files

```
app/today/today-shell.tsx   EDIT
```

### Change

Wrap Add task + Re-run tasks in a container with `flex-shrink-0` and `min-w-[200px]` so they don't reflow when the right column flexes:

```tsx
<div className="flex flex-shrink-0 items-center gap-2 ml-auto">
  <Button>Add task</Button>
  <Button>Re-run tasks</Button>
</div>
```

### Acceptance

- [ ] Add task / Re-run tasks stay at the same x-coordinate whether the detail panel is open or closed.

---

## Block 17 — Subtask rename inline (fixes P1-13)

### Files

```
app/today/today-view.tsx   EDIT (Subtask row component)
app/today/actions.ts       EDIT (renameSubtask)
```

### Change

Subtask row: add a pencil icon on hover (right side, next to the existing X). Click pencil → swap title for an input, focus + select. Enter or blur → save. Escape → cancel.

```tsx
{editing ? (
  <input
    autoFocus
    defaultValue={subtask.title}
    onBlur={save} onKeyDown={e => e.key === 'Enter' ? save() : e.key === 'Escape' && cancel()}
  />
) : (
  <>
    <span>{subtask.title}</span>
    <button onClick={() => setEditing(true)} aria-label="Rename subtask"><PencilIcon /></button>
  </>
)}
```

### Acceptance

- [ ] Double-click OR hover-pencil-click on a subtask enters edit mode. Enter saves. Escape cancels.

---

## Block 18 — Linear "Rejected" tooltip + ENGG row description (fixes P1-15 + P2-12)

### Files

```
lib/extract/linear.ts            EDIT
app/_components/status-pill.tsx  EDIT
app/today/today-view.tsx         EDIT (row subtitle fallback)
```

### Changes

For "Rejected":

- Add a tooltip explaining: `"You marked this as not relevant on {date}."` (assuming Rejected = user-dismissed) OR `"Issue closed in Linear without merge."` if Linear-driven.

For ENGG description:

- In `lib/extract/linear.ts`, pull the issue description (first paragraph, max 200 chars) into `item.description` before insert.
- In the row template, if `subtitle` is just "Engg (ENGG) · QA Requested" with no body, fallback to showing `item.description` truncated.

### Acceptance

- [ ] Hover Rejected pill → tooltip explains the state.
- [ ] Linear ENGG-XXXX rows show body text from the issue description, not just "Engg (ENGG) · QA Requested".

---

## Block 19 — Unread tab redundant pill + EMAIL header tabs (fixes P2-5 + P3-4)

### Files

```
app/today/today-view.tsx   EDIT (Unread row component)
app/today/today-view.tsx   EDIT (DetailPanel reply header)
```

### Changes

Unread row: replace the green "Unread" pill with sender + arrival time (the pill is redundant — tab name says "Unread"):

```tsx
- <Chip color="commit">Unread</Chip>
+ <span className="text-xs text-ink-faint">{fmt.timeShort(item.received_at)}</span>
```

Detail panel reply header: the "EMAIL · REPLY · Draft" string at the top looks tab-like. Either turn it into actual tabs, or make it visually-obviously metadata:

```tsx
- <div className="text-sm font-medium">EMAIL · REPLY · Draft</div>
+ <div className="text-xs uppercase tracking-wider text-ink-faint">Gmail reply draft</div>
```

### Acceptance

- [ ] No "Unread" pill on Unread tab rows.
- [ ] "Gmail reply draft" label in detail panel reads as metadata, not as clickable tabs.

---

## Block 20 — Skip link + aria-current (fixes P1-16 + P1-17)

### Files

```
app/layout.tsx                    EDIT (add skip link at top of body)
app/_components/app-sidebar.tsx   EDIT (aria-current on active nav)
```

### Changes

```tsx
// app/layout.tsx
<body>
  <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md focus:ring-2 focus:ring-ink">
    Skip to content
  </a>
  {children}
</body>
```

In `app-sidebar.tsx`, on each nav link:

```tsx
<Link
  href={href}
  aria-current={pathname === href ? 'page' : undefined}
  className={...}
>
```

The page-content `<main>` already exists with `id="main"`-able landmark — confirm by grep.

### Acceptance

- [ ] Tab from the page-load focus → first focus is "Skip to content" (visible).
- [ ] Active sidebar nav item has `aria-current="page"` in the DOM.

---

## Block 21 — "Sent with Nummo" signature strip (fixes P3-2)

### Files

```
lib/html.ts (from Block 2)   EDIT
```

### Change

Add to `BOILERPLATE_PATTERNS`:

```ts
/sent with nummo\s*$/i,
/^sent from my (iphone|android|samsung|mac)\s*$/i,
```

### Acceptance

- [ ] "Sent with Nummo" no longer leaks into row previews.

---

## Block 22 — Session expiry extension (fixes P2-9)

### Files

```
lib/supabase-server.ts   EDIT  (refreshSession TTL config)
```

### Change

Refer to Supabase Auth docs for adjusting refresh-token TTL. Recommended target: 7 days sliding window. Also consider a `refreshSession()` interceptor on mutating server actions so an idle-ish session refreshes on any real activity.

### Acceptance

- [ ] After 1 hour of inactivity, navigating /today does NOT bounce to /login.

---

## Block 23 — `role: 'subtask'` in digest insert (one-line latent fix)

The shipped fix in `dd6595b` sets `parent_id` correctly on new subtask inserts but does NOT set `role: 'subtask'`. The column defaults to `'top'`. Latent today (load filters by `parent_id IS NULL`), but lurking.

### Files

```
lib/digest/run.ts   EDIT (around line 226 in the post-fix code)
```

### Change

```diff
  const subInserts = fresh.sub_items.map(sub => {
    return {
      user_id: userId,
      title: sub.title,
      task_type: (sub.task_type ?? 'action') as string,
      tag: 'action' as const,
      source: 'manual' as const,
      source_ref: { auto_subtask: true } as Record<string, unknown>,
      parent_id: inserted.id,
+     role: 'subtask' as const,
      parent_context: null as string | null,
      semantic_hash: subHash,
      status: 'open' as const,
    }
  })
```

### Acceptance

- [ ] `select count(*) from items where parent_id is not null and role = 'top'` returns 0 after the next digest run.

---

## Block 24 — Subtask within-parent dedup (fixes P0-2, the SpendHound dup problem)

The cascade-leak fix protects against cross-task leaks, but the Claude extractor still emits near-duplicate subtasks within one parent's `sub_items` array ("Schedule meeting with CEO upon return..." appears twice).

### Files

```
lib/extract/granola.ts            EDIT  (prompt + post-process)
lib/extract/gmail.ts              EDIT  (same)
lib/dedup-subtasks.ts             NEW
```

### Changes

Prompt addition (verbatim):

```
SUBTASK RULES:
1. Each subtask must describe a distinct action. Do NOT generate near-duplicates.
2. If two subtasks describe the same action with different wording, output ONE.
3. Order subtasks by execution order (what happens first goes first).
4. Cap at 5 subtasks per parent. If you have more, merge the granular ones.
```

Post-process safety net (simhash-style dedup):

```ts
// lib/dedup-subtasks.ts — NEW
import { computeSemanticHash } from './normalize'

const DUP_THRESHOLD = 0.85 // jaccard over normalized tokens

export function dedupSubtasks(parent: ExtractedItem): ExtractedItem {
  if (!parent.sub_items || parent.sub_items.length === 0) return parent
  const kept: typeof parent.sub_items = []
  for (const sub of parent.sub_items) {
    const isDup = kept.some(k => jaccard(tokens(k.title), tokens(sub.title)) >= DUP_THRESHOLD)
    if (!isDup) kept.push(sub)
  }
  return { ...parent, sub_items: kept }
}
```

Call `dedupSubtasks(parent)` before persist in `lib/digest/run.ts`.

Backfill existing items with duplicate subtasks:

```sql
-- one-off, after deploy
with dups as (
  select id from items where role = 'subtask' and id in (
    select b.id from items a join items b
      on a.parent_id = b.parent_id and a.id < b.id
      and a.title ilike b.title
      and a.user_id = b.user_id
  )
)
delete from items where id in (select id from dups);
```

### Acceptance

- [ ] Open the SpendHound task. Subtask list has no two near-duplicate titles. Ideally 5 distinct subtasks, not 10 with dups.
- [ ] Next digest run produces no near-duplicate subtasks for any new parent.

---

## Block 25 — Investigations (decide-then-fix)

These three each need a 30-minute look before writing code.

### Inv-1: `draft.followup` — 365 calls/day, $0.79, $24/mo. Where does it surface?

```
grep -rn "draft.followup\|generateFollowup\|FollowupDrafter" .
```

Either:
- (a) Find the surface that renders these → confirm it's working and reduce frequency if wasteful.
- (b) Find that nothing reads `follow_up_drafts` table → kill the prompt entirely.

### Inv-2: Open count definition — is the canonical "open" Open+Prep, or only Open?

- /today separates Open (74) and Prep (8) as different tabs.
- /profile Overview tile sums them and calls the total "Open tasks".

Pick one definition. Update the other label.

Recommended: rename /profile tile to "Active tasks" with split: "74 open / 8 prep / 0 unread" inside one card. Then no inconsistency.

### Inv-3: Calendar "Blocked 2:30 AM - 10:00 AM" — TZ bug or user's actual recurring event?

- If it's the user's actual Google Calendar event (a 7.5h "Blocked" overnight), leave it.
- If it's UTC times rendering on a Pacific-time grid, fix the formatter.

Check via:

```ts
const events = await loadEventsForDate('2026-05-31')
console.log(events.find(e => e.title === 'Blocked'))
// look at start/end raw timestamps + the user's timezone
```

### Acceptance

- [ ] Each investigation produces a one-paragraph decision in `docs/decisions/` or a code change.

---

## Ship order (suggested)

Each block is its own PR.

1. **Block 1** (date format) — biggest blast radius, almost certainly fixes P0-1 hydration. Go first.
2. **Block 23** (role: 'subtask') — one line, ship alongside Block 1 to clear that latent issue.
3. **Block 2** (entity decode + boilerplate strip) — small, clear win for legibility.
4. **Block 10** (source naming + dev-speak copy) — pure copy + token wiring. Fast.
5. **Block 11** (Approved → Done) — single label change.
6. **Block 12** (plural helper) — sweep and done.
7. **Block 6** (empty title error) — one form polish.
8. **Block 7** (panel header refresh) — small optimistic-update fix.
9. **Block 8** (subtask spinner guard) — one-line.
10. **Block 13** (greeting per tab) — copy + tab switch.
11. **Block 14** (em-dash voice prompt + regen) — prompt + one regen.
12. **Block 21** (Nummo signature strip) — Block 2 add-on.
13. **Block 19** (unread pill + EMAIL header) — small visual cleanup.
14. **Block 20** (skip link + aria-current) — accessibility plumbing.
15. **Block 5** (auto-complete parent on all-subtasks-done) — feature feel.
16. **Block 9** (manual task no autogen) — feature feel.
17. **Block 17** (subtask rename) — feature feel.
18. **Block 18** (Linear Rejected + ENGG description) — extractor + tooltip.
19. **Block 15** (snoozed row reflow) — animation polish.
20. **Block 16** (toolbar button positioning) — layout polish.
21. **Block 24** (within-parent subtask dedup) — prompt + safety net + backfill. Bigger commit.
22. **Block 3** (Chip primitive) — large refactor, touches every chip in `today-view.tsx`. Do near-last so it doesn't conflict with everything else.
23. **Block 4** (TaskCard) — biggest UX consolidation. Do last because it depends on Block 3 (chips) being canonical first.
24. **Block 22** (session TTL) — operational config change.
25. **Block 25** (investigations) — any time.

After every block:

```sh
tsc --noEmit && npm run build && npm run lint
```

If any of the still-open items from earlier reports surface during a block, add them to that block's acceptance criteria.

— Claude QA, master Cursor fix instructions

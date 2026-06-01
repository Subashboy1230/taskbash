# QA fix plan — taskbash, 2026-05-31

This is a Cursor-ready implementation plan for the bugs confirmed in `docs/qa-report-2026-05-31.md` (Round 1 + Round 2). It does **not** cover bugs Claude didn't test yet — those are listed under "What I did not test" in the QA report and will be specced separately after a second QA pass.

**Scope of this plan:** P0-1, P0-2, P0-3, P0-4, P0-5, P0-6, P0-7, P0-8, P0-9, P0-10, plus P1-1, P1-2, P1-4, P1-5, P1-6, P1-8, P1-9, P1-10, P1-11, P1-12. Lower-priority P2 / P3 items are queued at the bottom for one cleanup PR after the P0/P1 fixes land.

**Out of scope** (retracted or working as intended): P1-3 (Prompts rows are expandable; "no data" is collapsed-state summary).

**Ship order:** the bugs are interrelated. Fix Block A first (the cascading subtask leak is the root of five other bugs). Then Block B (function-chip crash + error-boundary scope). Then C, D, E in any order.

---

## Block A — Stop the cascading subtask leak (root cause for P0-6, P0-7, P0-8, P1-5, P1-6, P1-7, P1-9, P1-11)

### Symptom
Subtasks are persisted as rows in `items` with `source='manual'`. The on-open "Generating description and subtasks…" job then reads those leaked items, generates *their* descriptions + subtasks, and inserts the grandchildren as new items. Open count grew live: 75 → 77 → 80 in three panel-opens during QA.

### Root cause
Two places insert subtasks into `items` instead of attaching them to the parent:

1. **`lib/digest/run.ts`** — when an extractor returns `ExtractedItem` with `sub_items`, the loop `for (const parent of items) { allFresh.push(parent); for (const sub of parent.sub_items ?? []) allFresh.push(sub); }` flattens children into siblings. The diff engine then inserts each subtask as its own `items` row.
2. **`app/today/actions.ts` → `addSubtask` (or wherever the +Add a subtask button lands)** — writes both a subtask row attached to the parent AND a top-level `items` row.

Also: there's no guard preventing the description/subtask generator from running on a row that *is* a subtask. So even after we fix the inserts, the existing leaked rows will keep cascading on click.

### Fix

#### A.1 — Schema: add role marker (parent_id already exists)
**Correction after review:** `items.parent_id` already exists since `001_mvp.sql` line 72 — it's a self-referential `uuid references items(id) on delete cascade`, with index `idx_items_parent`. The `Item` type in `lib/types.ts` reflects it. We use the existing column. The only schema change is the `role` marker.

`migrations/028_subtask_role.sql`:

```sql
-- Subtasks live as items rows linked via the existing items.parent_id
-- self-referential FK. We add an explicit role marker so loaders can
-- filter top-level rows without scanning parent_id on every row.
alter table items
  add column if not exists role text not null default 'top'
    check (role in ('top', 'subtask'));

-- Backfill: any existing row with parent_id IS NOT NULL is a subtask.
update items set role = 'subtask' where parent_id is not null and role = 'top';

create index if not exists idx_items_role_top
  on items (user_id, status)
  where role = 'top';

comment on column items.role is
  'top = visible in /today top-level lists. subtask = nested under parent_id, never shown as standalone row.';
```

#### A.2 — Dev cleanup (NOT a migration — run manually)
**Correction after review:** This is a one-shot cleanup against Subash's QA-session leftovers. It does not belong in `/migrations/` — anyone running CI migrations later would either skip the commented-out block or re-run a no-op. Move it to `scripts/cleanup-qa-leaked-subtasks.ts` and run once locally:

```ts
// scripts/cleanup-qa-leaked-subtasks.ts — run once: npx tsx scripts/cleanup-qa-leaked-subtasks.ts
import { supabase } from '@/lib/supabase'

const SESSION_LEAKED_TITLES = [
  'Verify JSON output format is valid and properly structured',
  'Confirm task generation system processed input correctly',
  'Submit scores before end of business today',
  'Complete any partially finished scores from previous sessions',
  'Log into my.technovationchallenge.org and start a new project score',
  'Confirm Thursday 2:30 PM follow-up call with SpendHound specialist for 5-10 minute setup',
  'Confirm receipt and send completion notification',
  'Enter or upload scores into the submission system',
  'Verify scores for accuracy and completeness',
  'Gather all score sheets or data from relevant parties',
  'Check for em-dashes and replace with hyphens or colons',
  'Verify subtasks array has 2-4 items, each starting with a verb',
  'Confirm description field contains 1-2 sentences with specific context',
  'Validate JSON syntax using a linter or parser tool',
  'manually added subtask via QA',
  'QA test task — please ignore',
  'QA test task EDITED — please ignore',
]

await supabase
  .from('items')
  .delete()
  .eq('source', 'manual')
  .in('title', SESSION_LEAKED_TITLES)
```

Don't add this as migration 029. After running it once, the A.1 backfill `update items set role = 'subtask' where parent_id is not null` is sufficient for the rest.

#### A.3 — Fix `lib/digest/run.ts`: do not flatten sub_items into allFresh
Replace the loop in `tryRun`:

```ts
// BEFORE
for (const parent of items) {
  allFresh.push(parent);
  for (const sub of parent.sub_items ?? []) allFresh.push(sub);
}

// AFTER
for (const parent of items) {
  allFresh.push(parent);
  // sub_items stay attached to parent.sub_items. The insert step writes
  // them as subtask rows (parent_id + role='subtask'), NOT as siblings.
}
```

Then in the insert loop (around line 178), after the parent insert, write subtasks attached to the parent. **Correction after review:** the original sketch was missing explicit values for several columns. Schema reality (per `001_mvp.sql`): only `user_id`, `title`, `task_type`, `source`, `semantic_hash` are NOT NULL. `status` defaults to `'open'`, `first_seen_at`/`last_seen_at`/`created_at`/`updated_at` default to `now()`, `urgent` defaults to `false`, `source_ref` defaults to `'{}'::jsonb`. But for subtask hygiene, we should be explicit rather than rely on parent-inherited semantics that don't actually exist (priority is column-nullable, not "inherits from parent"):

```ts
if (!error && inserted?.id) {
  newCount += 1;
  // ...existing classifyCallId / task_events writes for the parent...

  if (fresh.sub_items && fresh.sub_items.length > 0) {
    const subtaskRows = fresh.sub_items.map(sub => ({
      user_id: userId,
      title: sub.title,
      task_type: sub.task_type ?? 'manual',           // matches existing 'manual' literal in task_type CHECK
      tag: sub.tag ?? 'action',                       // subtasks default to actionable
      parent_context: fresh.title,                    // subtask's "where it lives" is its parent's title
      source: fresh.source,                           // inherit from parent (gmail / granola / linear / etc.)
      source_ref: fresh.source_ref ?? {},             // inherit, explicit '{}' over null
      priority: fresh.urgent ? 'P1' : 'P3',           // urgent parent → P1, else P3 (parent's priority isn't on ExtractedItem)
      semantic_hash: computeSemanticHash(fresh.source, fresh.title, sub.title),
      parent_id: inserted.id,                          // existing self-FK on items
      role: 'subtask' as const,                        // new from migration 028
      // status, urgent, first_seen_at, last_seen_at, created_at, updated_at: defaults are fine
    }));

    const { error: subErr } = await supabase.from('items').insert(subtaskRows);
    if (subErr) console.error('[runDigest] subtask insert failed:', subErr);
    // Don't throw — parent is already inserted. Subtasks can be regenerated.
  }
}
```

Notes on the explicit values:

- `task_type: 'manual'` matches the existing CHECK constraint (`task_type in ('research', 'context_prep', 'review', 'follow_up', 'post_call', 'manual')`). Subtasks aren't a typed work-category, so `'manual'` is the closest match. Confirm in production data whether any other value is preferable.
- `priority: fresh.urgent ? 'P1' : 'P3'` — `Item.priority` is column-nullable, but the /today list sorts by effective priority, so leaving it null sends subtasks to the bottom of every group. Set explicitly so subtasks land at P3 (or P1 if the parent is urgent).
- `semantic_hash` uses `fresh.title` instead of `fresh.parent_context` so each subtask gets a unique hash within the parent context — otherwise two subtasks with the same title under different parents would collide on the unique index.

#### A.4 — Fix the on-open subtask generator: never run on a subtask
Find the server action that fires when the detail panel opens (likely `app/today/actions.ts → generateBriefAndSubtasks` or similar, called from the panel's `useEffect`). At the top of the function:

```ts
export async function generateBriefAndSubtasks(itemId: string) {
  const { data: item } = await supabase
    .from('items')
    .select('id, role, parent_item_id, brief_status')
    .eq('id', itemId)
    .single();
  if (!item) return { skipped: 'not_found' };
  if (item.role === 'subtask') return { skipped: 'is_subtask' };
  if (item.brief_status === 'generated') return { skipped: 'already_generated' };
  // ...existing Claude call + insert path...
}
```

In the same function, when the LLM returns sub_items, write them with `parent_item_id` + `role='subtask'`, never as top-level rows. This is the same fix as A.3 but for the on-demand path.

#### A.5 — Filter top-level lists to `role='top'`
Every loader that backs the /today list must add `.eq('role', 'top')` or `.is('parent_item_id', null)`. Audit:

- `lib/load-digest.ts` (the main one)
- `lib/load-functions.ts` if it joins items
- Any other `from('items').select(...)` that backs a list rendering

Subtasks remain queryable for the panel via `parent_item_id = $parent`.

#### A.6 — Update the activity feed loader to not surface subtask `created` events
In `lib/load-activity.ts` (or wherever the Tasks tab pulls task_events), join `items` and exclude `role='subtask'` rows from the `kind='created'` filter:

```ts
.from('task_events')
.select('*, items!inner(role)')
.eq('items.role', 'top')
.eq('kind', 'created')
```

Fixes P1-6.

#### A.7 — Add task form: do not auto-generate description for manual tasks
In `app/today/add-task-panel.tsx → onSubmit`, after the insert, **do not** call the brief/subtask generator. Manual tasks land with the user-typed title and no description. If the user later wants a brief, they can click a button (out of scope for this fix).

Fixes P0-8 and P1-11.

### Acceptance
- After A.1–A.7, creating a manual task increments Open count by exactly 1.
- Opening a parent task does not increment Open count.
- Opening a subtask (route shouldn't even allow this — they're not standalone) does not increment Open count.
- /activity → Tasks tab shows one "Found …" row per top-level task per digest, not one per subtask.

---

## Block B — Function-chip click crash + error-boundary scope (P0-9)

### Symptom
Clicking an unselected function chip in the detail panel throws `TypeError: network error` at the page level. The whole /today view error-boundaries out. "Try again" does not recover.

### Root cause hypothesis
1. The Server Action behind the chip click is likely `setItemFunctions(itemId, functionIds)` in `app/today/actions.ts`. Either it's throwing because the Supabase write fails (RLS? schema mismatch on `function_ids` column?) or because of a serialization error on the client → server boundary.
2. The error boundary is at `app/today/error.tsx`, which catches everything under /today. A failed chip mutation should not nuke the entire page.

### Fix

#### B.1 — Add an error boundary scoped to the detail panel
Create `app/today/_components/panel-error-boundary.tsx`:

```tsx
'use client';
import { Component, ReactNode } from 'react';

export class PanelErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm">
          <p className="text-red-400">Couldn't update this task.</p>
          <p className="text-zinc-500 mt-1">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
            className="mt-3 text-xs underline"
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap the `DetailPanel` content in `today-shell.tsx`:

```tsx
<PanelColumn closing={panelClosing}>
  <PanelErrorBoundary onReset={() => router.refresh()}>
    {displayedItem && <DetailPanel ... />}
  </PanelErrorBoundary>
</PanelColumn>
```

A failed function-chip click now degrades the *panel*, not the page.

#### B.2 — Wrap `setItemFunctions` Server Action in try/catch + return Result
In `app/today/actions.ts`:

```ts
export async function setItemFunctions(itemId: string, functionIds: string[]) {
  try {
    const { error } = await supabase
      .from('items')
      .update({ function_ids: functionIds })
      .eq('id', itemId);
    if (error) return { ok: false as const, error: error.message };
    // ...existing RL feedback capture if any...
    return { ok: true as const };
  } catch (err) {
    console.error('[setItemFunctions]', err);
    return { ok: false as const, error: 'Network error. Try again.' };
  }
}
```

Client side, the chip-click handler awaits the Result and toasts the error instead of throwing.

#### B.3 — Verify `items.function_ids` column exists with the expected shape
Run `\d items` in psql or `select column_name, data_type from information_schema.columns where table_name = 'items' and column_name = 'function_ids'`. If `function_ids` is `text[]` but the UI sends `uuid[]` (or vice versa), the Server Action throws a type error that surfaces as "network error" to the client. Align the types.

### Acceptance
- Clicking a function chip toggles its assigned state without crashing the page.
- If the write fails, only the FUNCTIONS section shows a retry button.

---

## Block C — Text rendering bugs (P0-1 hydration, P0-3 HTML entities, P0-5 em-dashes)

### C.1 — Hydration mismatch on /today (#418)

#### Symptom
Every /today load throws React error #418 ("text content did not match"). Confirmed at 1:44 PM and 1:49 PM.

#### Likely cause
Most #418s on a dashboard like this come from one of:

- `new Date()` rendered without a stable formatter (server gets one timestamp, client gets another).
- "X ago" relative time strings (`5h ago`, `Overdue 22h`).
- Timezone-sensitive formatting (the calendar TODAY card shows "2:30 AM – 10:00 AM" — see C.4).
- Random IDs (`Math.random()`, `crypto.randomUUID()`) rendered during SSR.

#### Fix
1. Grep for `new Date()` and `Date.now()` in everything reachable from `app/today/`. Identify any direct render of a Date or relative string.
2. Replace with a stable formatter that takes a `Date` from the server and renders the same string on client:
   ```tsx
   // BAD — server and client differ
   <span>{Math.round((Date.now() - itemAge) / 3600000)}h ago</span>

   // GOOD — server formats, client trusts
   <span suppressHydrationWarning>{relative(item.updated_at, nowFromServer)}</span>
   ```
3. Pass `nowFromServer = new Date()` from the page (server component) down through props. Every relative-time render uses *that* value.
4. As a last resort, add `suppressHydrationWarning` to the offending span — but only after step 1–3 don't fully fix it.

#### Acceptance
- /today loads with zero console errors. Confirm in Chrome DevTools.

### C.2 — `&#39;` apostrophes in Gmail subtitle (P0-3)

#### Symptom
JS audit found 3 occurrences of literal `&#39;` in /today innerText. All in Gmail subtitle preview text.

#### Root cause
Gmail's HTML body is HTML-decoded into a plaintext preview, but somewhere the decode is doubled — the source already contains the encoded entity from a previous step. Or: the preview is being inserted via `dangerouslySetInnerHTML`-equivalent without a final decode pass.

#### Fix
In `lib/extract/gmail.ts → buildSubtitle()` (or whatever produces `items.subtitle` for Gmail rows), add:

```ts
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
```

Apply to the subtitle (and the body preview if the same pipeline produces it) before insert. Run a one-shot backfill:

```sql
update items
set subtitle = replace(replace(replace(subtitle, '&#39;', ''''), '&quot;', '"'), '&amp;', '&')
where source = 'gmail' and (subtitle like '%&#39;%' or subtitle like '%&quot;%' or subtitle like '%&amp;%');
```

#### Acceptance
- JS audit `document.body.innerText.match(/&#39;/g)` on /today returns null.

### C.3 — Em-dashes in /profile → Voice (P0-5)

#### Symptom
The learned Writing Voice prose on /profile → Voice contains multiple em-dashes despite the em-dash ban.

#### Fix
In `lib/voice/generate.ts` (or wherever the Voice generator prompt lives), append to the system prompt:

```
Output rules:
- Never use em-dashes. Use periods, parentheses, colons, or hyphens instead.
- Never use en-dashes. Use hyphens.
```

After the prompt update, re-trigger the user's voice generation (the "Regenerate from last 30 days" button) to overwrite the existing prose.

#### Acceptance
- `select count(*) from user_voices where voice_text ~ '[—–]'` returns 0 after regeneration.

### C.4 — Calendar TODAY card shows "Blocked 2:30 AM – 10:00 AM" (P3-3)
The "Blocked" event with PT-ambiguous times is likely a timezone bug in the calendar loader. Investigation only — not blocking:

```ts
// In lib/load-day-events.ts, check whether event start/end are in user's
// timezone or UTC. Confirm via console.log of the raw event before render.
```

Likely fix: format event times with `Intl.DateTimeFormat(undefined, { timeZone: user.timezone, ... })` using the user's saved timezone (or `Intl.DateTimeFormat().resolvedOptions().timeZone` for the browser fallback).

---

## Block D — Detail panel state sync (P0-7, P1-4, P1-9)

### D.1 — Pencil-edit save updates row but not panel header (P0-7)
In `today-shell.tsx`, the `DetailPanel` receives `item` as a prop. After Save, the parent doesn't re-pass the updated item, so the panel's header keeps the old title.

Fix: after a successful edit save, optimistically update `displayedItem` in `today-shell.tsx`:

```tsx
const handleSaveEdit = (updates: Partial<MockItem>) => {
  setDisplayedItem(prev => prev ? { ...prev, ...updates } : prev);
  // ...existing server action call...
};
```

And pass `handleSaveEdit` down to `DetailPanel`.

### D.2 — Subtask count pill on row is stale until panel close (P1-9)
Same root cause as D.1 — the row count is derived from the parent's cached `subtask_count` field, which doesn't update until `router.refresh()`. Two options:

- (a) Fastest: call `router.refresh()` after every subtask write. Costs one round trip per click but keeps the row in sync.
- (b) Cleaner: lift subtask count into the same client-side optimistic store that drives the panel. `shellHiddenIds` already does this pattern for completed items — extend it for subtask state.

Pick (a) for now, queue (b) for the larger optimistic-store refactor.

### D.3 — "Generating description and subtasks…" spinner lingers (P1-4)
In the detail panel, the spinner is rendered as a sibling of the subtasks list. Once subtasks render, the spinner should disappear.

Fix in the panel component:

```tsx
{generating && subtasks.length === 0 && (
  <div className="text-xs text-zinc-500">Generating description and subtasks…</div>
)}
```

The `&& subtasks.length === 0` guard kills the spinner the moment any subtask materializes.

---

## Block E — Lower-priority polish (one cleanup PR)

### E.1 — Open count definition (P0-4)
On /profile → Overview, "Open tasks" tile currently sums `Open + Prep` and labels it `Open tasks` while /today separates them. Two fixes possible:

- Label the tile "Open + Prep" with both numbers split.
- Or rename to "Active tasks" (which reads naturally as "anything not cleared").

Recommend the second. Change `app/profile/overview-tab.tsx` and the label.

### E.2 — Slop chart empty state (P1-1)
Currently the chart renders axes + legend but no data. Add an empty-state branch:

```tsx
{series.every(s => s.points.length === 0) ? (
  <div className="text-sm text-zinc-500 text-center py-12">
    No slop feedback in the last 30 days. Mark items as slop to start training the extractors.
  </div>
) : (
  <SlopChart series={series} />
)}
```

### E.3 — Context-aware greeting on /today (P1-8)
The "Heavy day. Triage..." greeting renders on every tab. Drive it from the active tab:

```tsx
const greetings = {
  open: digest.open_items.length > 50
    ? "Heavy day. Triage the top of the list first."
    : "Today's queue. " + digest.open_items.length + " things on the list.",
  prep: "Prep for upcoming meetings.",
  cleared: digest.completed_today.length + " cleared today. Nice work.",
  unread: digest.unread_count + " unread threads need a look.",
};
```

### E.4 — Snoozed row leaves white-space gap (P1-10)
In the optimistic-hide path, the parent container needs to reflow. The current `shellHiddenIds` Set hides via display: none on the row. Switch to *removing* the row from the filtered list — same `useMemo` that's already there for `filteredDigest`:

```ts
const filteredDigest = useMemo(() => ({
  ...digest,
  open_items: digest.open_items.filter(i => !shellHiddenIds.has(i.id)),
}), [digest, shellHiddenIds]);
```

(This is what the code looks like it's already doing — verify and confirm; the gap may be coming from the framer-motion exit animation leaving residual height.)

### E.5 — Re-run tasks progress indicator (P1-12)
Currently the button shows a tiny spinning ring. Add per-source progress via streaming or polling `agent_events` of kind `digest.source_complete`:

```tsx
<button>
  {running
    ? `Running… ${sourcesComplete}/${sourcesTotal} (${currentSource})`
    : 'Re-run tasks'}
</button>
```

Cheap version: just change the label to "Re-running… (this takes ~30 seconds)" during the spinner.

### E.6 — Open in Gmail: add threading headers to the compose URL (P0-10 short-term fix)

**Update 2026-05-31:** The "Send now" half of P0-10 is now fixed in prod (commit reworked `executeProposedAction` in `app/today/actions.ts`). Send now goes through `lib/gmail/drafts.ts → createGmailDraft + sendGmailDraft`, MIME builder includes `In-Reply-To` and `References` headers, threading is preserved, and on failure the action returns an inline error and the item stays open. The Drafts API path is also idempotent — `gmail_draft_id` is persisted on `proposed_action` immediately after `createGmailDraft` returns, so a retry after a `sendGmailDraft` failure reuses the existing draft.

The "Open in Gmail" half is still URL-mailto compose. Short-term fix (still pending):

```ts
const url = new URL('https://mail.google.com/mail/u/0/');
url.searchParams.set('fs', '1');
url.searchParams.set('tf', 'cm');
url.searchParams.set('to', to);
url.searchParams.set('su', subject);
url.searchParams.set('body', body);
if (gmailThreadId) url.searchParams.set('th', gmailThreadId);
```

The full fix (drafts created at extraction time, not at send time) is the auto-Gmail-drafts PRD.

**Two follow-ups on the shipped Send-now change:**
- `fromEmail = 'subash@sigiq.ai'` is hard-coded inside `executeProposedAction`. Same `TODO(week5)` note already exists on `requestRefresh` ("load userEmail from the public.users row"). Combine into one cleanup.
- Manual prerequisite: add `https://www.googleapis.com/auth/gmail.modify` scope to the `google-mail` integration in the Nango dashboard, then re-auth Gmail in /connections. Without that scope, `drafts.create` and `drafts.send` return 403 and the user sees `Could not create Gmail draft: ...` inline in the panel.

---

## File-touch summary (for the PR description)

```
migrations/028_subtask_canonicalization.sql        NEW
migrations/029_backfill_leaked_subtasks.sql        NEW
lib/digest/run.ts                                  EDITED (Block A)
lib/load-digest.ts                                 EDITED (Block A.5)
lib/load-activity.ts                               EDITED (Block A.6)
lib/extract/gmail.ts                               EDITED (Block C.2)
lib/voice/generate.ts                              EDITED (Block C.3)
lib/load-day-events.ts                             EDITED (Block C.4) [investigation]
app/today/actions.ts                               EDITED (Block A.4, B.2, D.1)
app/today/today-shell.tsx                          EDITED (Block B.1, D.1, D.2)
app/today/today-view.tsx                           EDITED (Block C.1 — relative time refactor)
app/today/_components/panel-error-boundary.tsx     NEW (Block B.1)
app/today/add-task-panel.tsx                       EDITED (Block A.7)
app/today/detail-panel.tsx                         EDITED (Block D.3)
app/profile/overview-tab.tsx                       EDITED (Block E.1)
app/profile/stats-tab.tsx                          EDITED (Block E.2)
```

---

## Acceptance — the whole plan is done when

- [ ] `tsc --noEmit && npm run build` clean
- [ ] No em-dashes in `lib/voice/generate.ts` prompt; regen produces voice prose with zero em-dashes
- [ ] /today loads with zero console errors
- [ ] `document.body.innerText.match(/&#39;/g)` on /today returns null
- [ ] Manual Add task increments Open count by exactly 1, not 3
- [ ] Opening a parent task does not increment Open count
- [ ] Clicking a function chip toggles state without page crash; panel-scoped retry if it fails
- [ ] Pencil-edit title updates panel header immediately
- [ ] Subtask checkbox toggle updates row pill within 500ms
- [ ] "Generating description and subtasks…" spinner disappears as soon as any subtask renders
- [ ] /activity → Tasks shows one row per top-level task per digest, no subtask "Found …" rows
- [ ] /profile → Overview tile says "Active tasks" or shows split numbers; matches /today's sum
- [ ] /profile → Stats slop chart shows empty-state copy when no data
- [ ] /today greeting changes per tab
- [ ] Open in Gmail URL includes `&th={gmail_thread_id}` (or the auto-drafts PRD ships, whichever first)
- [ ] No em-dashes in any new strings introduced by this PR

— Plan written by Claude QA, 2026-05-31

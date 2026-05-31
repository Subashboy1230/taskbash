# PRD: /activity page

Hand this to Claude in Cursor. Self-contained — pairs with `CLAUDE.md` and the existing schema docs.

Status: spec, not built. Reverse-engineered from 5 Nummo screenshots Subash shared on 2026-05-31.

---

## 1. Goal

Give Subash a single page where he can audit everything taskbash has done on his behalf — every extraction, every classification, every reply sent, every task closed, every connection sync, every raw record pulled. Six tabs, chronologically grouped, status-pilled.

The page exists for three reasons:

1. **Trust** — when something feels off ("did the agent really send that reply?"), the user can scroll back and verify.
2. **Debug** — when an extraction is missing or wrong, having a feed of "what ran when" is the first place to look.
3. **Pattern recognition** — Subash can scan the Approvals tab and see "I rejected 4 of the last 6 EverTutor drafts — the agent's wrong about that thread" and tweak the voice.

URL: `/activity`. Replaces the existing placeholder. Uses shadcn `Tabs` and renders inside the existing `PageShell` (sidebar + main + calendar column).

---

## 2. Header

```
Activity
Everything taskbash has done across your automations and data sources
```

That's it. Title 28px semibold, subtitle 14px muted. Below the subtitle: the tab row.

---

## 3. Six tabs

| # | Tab | Default? | Source of truth | What it shows |
|---|---|---|---|---|
| 1 | All Activity | ✓ | UNION of all five below | Chronological feed of everything, type-mixed |
| 2 | Agent Runs | | `runs` table | Each digest cron + each on-demand Re-run |
| 3 | Tasks | | `items` lifecycle events | Created / completed / dismissed / snoozed / unsnoozed |
| 4 | Data Sources | | `runs.sources_run` per source | Each source's sync per run, with status |
| 5 | Approvals | | `items` where `reply_outcome IS NOT NULL` | Draft replies the user approved or rejected |
| 6 | Records | | `llm_calls.input_content` derived | The raw artifacts (email threads, Granola notes, Linear issues) pulled from sources |

Default tab on first load: **All Activity**. URL syncs via `?tab=tasks` etc., localStorage persists last-selected at `taskbash:activityTab`.

---

## 4. Row anatomy

Every row in every tab follows the same shape:

```
[timestamp]   [source icon or status dot]   [label]                            [right-side pill]
```

- **timestamp** left-aligned, 13px tabular-nums, `text-ink-muted`. Format: `12:33 AM` if today, `Mon 4:16 PM` if this week, `Apr 28 9:02 AM` if earlier.
- **source icon** 18px, uses the existing `<BrandLogo />` for Gmail/Granola/Linear/Calendar. For non-source events (run started, task completed) use a Tabler icon (`ti-refresh`, `ti-check`, `ti-trash`).
- **label** 14px, primary text. Single line, truncates with ellipsis on overflow.
- **right-side pill** 11px, status badge. Color depends on event type — see § 7.

Row padding 12px vertical, 16px horizontal. Hairline divider between rows (`border-t border-line` on every row except the first in a section).

---

## 5. Time grouping

Rows are grouped under collapsible date headers. Three buckets:

- **Today** — `event_at >= start of today`
- **Earlier This Week** — `event_at >= start of week AND event_at < start of today`
- **Earlier** — paginated, "Load more" button at the bottom

Each bucket is a Card with the date header on top and rows inside. Header is clickable to collapse/expand. Chevron icon on the right (`ti-chevron-down` rotates to `ti-chevron-up`).

Date header format:
- `Today  May 31, 2026`
- `Earlier This Week  May 29-30, 2026`
- `May 22-28, 2026` for older weeks
- `May 2026` for month-old data

The "Today" bucket is expanded by default. Others collapsed. Persist the collapsed/expanded state per bucket in `localStorage` under `taskbash:activitySections`.

---

## 6. Per-tab specs

### 6.1 All Activity

UNION of the other five feeds, sorted by `event_at DESC`. Each row carries its `type` so the icon + pill logic can branch.

Limit: 50 rows in the Today + Earlier This Week buckets; "Load more" pages 50 at a time from Earlier.

### 6.2 Agent Runs

Source: `runs` table. Query:

```sql
select
  id, started_at, completed_at, sources_run,
  fresh_count, new_count, carryover_count, completed_count,
  status, error
from runs
where user_id = $1
order by started_at desc
limit 50;
```

Row label format:
- `Morning digest ran` (if cron) or `Re-ran tasks` (if manual)
- Subtitle (12px muted, second line): `4 sources · 12 new · 27 carried`

Pill:
- `Succeeded` (green) when `status='succeeded'`
- `Failed` (red) when `status='failed'` — clicking expands the error message inline
- `Running` (blue, pulsing) when in flight

Icon: `ti-refresh`.

### 6.3 Tasks

Source: `items` lifecycle events. We don't currently log every lifecycle transition into a single table — they live across `items.created_at`, `items.completed_at`, `items.updated_at`, plus `item_feedback` for slop. The cleanest fix is a new `task_events` table that gets a row on every transition. Migration in § 8.1.

Query (after `task_events` exists):

```sql
select te.created_at, te.kind, te.item_id, i.title, i.source
from task_events te
join items i on i.id = te.item_id
where te.user_id = $1
order by te.created_at desc
limit 50;
```

Row label format:
- `kind='created'` → `Found "<title>"` with source icon
- `kind='completed'` → the title
- `kind='dismissed'` → the title
- `kind='snoozed'` → the title
- `kind='slop'` → the title

Pill mapping (matches Nummo):
- `Completed` — green (`bg-success-bg text-success-fg`)
- `Rejected` — red (`bg-danger-bg text-danger-fg`) — for `kind='dismissed'` OR `kind='completed' AND reply_outcome='rejected'`
- `Snoozed` — amber
- `Slop` — muted gray
- (no pill for `created` — it's the default state)

For tasks with `@-mention` style references in the title (Linear comments, Granola callouts), render the raw `@[Name](person:uuid)` pattern as a Badge component inline. See § 9 for the parser.

### 6.4 Data Sources

Each `runs.sources_run` entry becomes one row per source.

Query:

```sql
select
  r.started_at,
  unnest(r.sources_run) as source,
  r.status as run_status
from runs r
where r.user_id = $1
order by r.started_at desc
limit 100;
```

Row label format: source name capitalized (`Gmail`, `Granola`, `Calendar`, `Linear`). For Granola show `Meeting Notes`, for Calendar show `Calendar`, etc. — match Nummo's labels exactly.

Pill:
- `Synced` (green) — sources_run includes it AND `run_status='succeeded'`
- `Failed` (red) — sources_run does NOT include it, but it was attempted (need a new column `sources_failed text[]` on `runs` — see § 8.2)
- `Skipped` (gray) — source was disconnected at run time

Icon: the actual `<BrandLogo brand={source} />`.

### 6.5 Approvals

Source: `items` where the user took a draft-action decision. This requires the `reply_outcome` column from the Profile PRD (`migrations/016_reply_lifecycle.sql`). If that's not in yet, this tab waits.

Query:

```sql
select id, title, completed_at, reply_outcome, proposed_action
from items
where user_id = $1
  and reply_outcome is not null
order by completed_at desc
limit 50;
```

Row label format: the task title.

Pill:
- `Approved` (green) — `reply_outcome='approved'` (user clicked Send)
- `Rejected` (red) — `reply_outcome='rejected'` (user dismissed the draft)
- `Completed` (blue) — `reply_outcome='completed'` (closed without acting on the draft)

Icon: `ti-edit` (signals a drafted reply).

Hover state on a row: show a tooltip with the draft body preview (first 200 chars of `proposed_action.body`).

### 6.6 Records

Source: the raw items the extractors pulled from each source on the most recent runs. We need a lightweight log of what was pulled, distinct from what got extracted as a task.

Approach: derive from `llm_calls.input_content` which already stores the per-record payload for replay purposes (see migration 011 in the existing codebase).

Query:

```sql
select
  c.created_at,
  c.prompt_id,
  c.source_ref,
  c.input_content
from llm_calls c
where c.user_id = $1
  and c.prompt_id in ('extract.gmail', 'extract.granola', 'extract.linear', 'extract.calendar')
order by c.created_at desc
limit 100;
```

Row label format: extracted from `input_content`:
- Gmail: `c.input_content.subject` (the email subject)
- Granola: meeting title
- Linear: issue identifier + title
- Calendar: event name

Pill: the source type, formatted as `Email`, `Meeting`, `Issue`, `Event`. Style: muted gray pill (`bg-surface-muted text-ink-muted`).

Icon: source-specific `<BrandLogo />`.

Timestamp format: relative for recent (`9m ago`, `44m ago`, `7h ago`, `2d ago`) since this is the highest-volume tab and absolute times eat space. Switch to absolute date for >1 week.

---

## 7. Status pill palette

Reusable component: `<ActivityPill kind="..." />` that maps kind to color + label.

```tsx
const PILL = {
  synced:    { label: 'Synced',    bg: 'bg-success-bg',  fg: 'text-success-fg'  },
  succeeded: { label: 'Succeeded', bg: 'bg-success-bg',  fg: 'text-success-fg'  },
  completed: { label: 'Completed', bg: 'bg-tag-reply-bg', fg: 'text-tag-reply-fg' },
  approved:  { label: 'Approved',  bg: 'bg-success-bg',  fg: 'text-success-fg'  },
  rejected:  { label: 'Rejected',  bg: 'bg-danger-bg',   fg: 'text-danger-fg'   },
  failed:    { label: 'Failed',    bg: 'bg-danger-bg',   fg: 'text-danger-fg'   },
  snoozed:   { label: 'Snoozed',   bg: 'bg-tag-action-bg', fg: 'text-tag-action-fg' },
  skipped:   { label: 'Skipped',   bg: 'bg-surface-muted', fg: 'text-ink-faint' },
  slop:      { label: 'Slop',      bg: 'bg-surface-muted', fg: 'text-ink-muted' },
  running:   { label: 'Running',   bg: 'bg-tag-reply-bg', fg: 'text-tag-reply-fg', pulse: true },
  email:     { label: 'Email',     bg: 'bg-surface-muted', fg: 'text-ink-muted' },
  meeting:   { label: 'Meeting',   bg: 'bg-surface-muted', fg: 'text-ink-muted' },
  issue:     { label: 'Issue',     bg: 'bg-surface-muted', fg: 'text-ink-muted' },
  event:     { label: 'Event',     bg: 'bg-surface-muted', fg: 'text-ink-muted' },
}
```

11px font, 3px vertical padding, 8px horizontal padding, rounded-full. No icon inside the pill.

---

## 8. Database changes

Two migrations.

### 8.1 `migrations/023_task_events.sql`

Captures every task lifecycle transition as its own row. Powers the Tasks tab.

```sql
create table task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  kind text not null,  -- created | completed | dismissed | snoozed | unsnoozed | slop
  payload jsonb,        -- e.g. { reason: 'irrelevant' } for slop
  created_at timestamptz not null default now()
);

create index task_events_user_created_idx on task_events(user_id, created_at desc);
create index task_events_item_idx on task_events(item_id);

alter table task_events enable row level security;
create policy "users read own task events"
  on task_events for select
  using (auth.uid() = user_id);
```

Writes: every server action in `app/today/actions.ts` that mutates an item's status writes a `task_events` row in the same transaction. This is one line at each call site — small change. Backfill the existing items via:

```sql
insert into task_events (user_id, item_id, kind, created_at)
select user_id, id, 'created', created_at from items;

insert into task_events (user_id, item_id, kind, payload, created_at)
select user_id, id, 'completed', null, completed_at
from items where status = 'completed' and completed_at is not null;

insert into task_events (user_id, item_id, kind, payload, created_at)
select user_id, id, 'dismissed', null, updated_at
from items where status = 'dismissed';
```

### 8.2 `migrations/024_runs_sources_failed.sql`

Adds a `sources_failed text[]` column to `runs` so the Data Sources tab can distinguish "tried but failed" from "skipped because disconnected."

```sql
alter table runs add column sources_failed text[] default '{}'::text[];
comment on column runs.sources_failed is
  'Sources that were attempted but threw an error during this run.';
```

Update `runDigestForUser` in `lib/digest/run.ts` and `morning-digest.ts` to push to `sources_failed` in the catch block of each `tryRun` call.

---

## 9. The @-mention parser

Some task titles contain inline references that look like `@[Hollins P](person:1484beb7-...)` or `@[Mentormatch](c...)`. In the Nummo screenshot, these render as styled pill chips. Build a small util:

```ts
// lib/parse-mentions.tsx
export function renderMentions(text: string): React.ReactNode[] {
  const pattern = /@\[([^\]]+)\]\(([^:]+):([^)]+)\)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const [, label, kind] = match
    parts.push(<MentionChip key={match.index} kind={kind as 'person' | 'project' | 'thread'} label={label} />)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
```

Style of `<MentionChip>`: `inline-flex items-center gap-1 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted` with a small colored dot prefix (green for person, blue for project, orange for thread).

Use everywhere task titles are rendered: Activity page, /today page, /handled page.

---

## 10. Routes + components

```
app/activity/
├── page.tsx                       Server component, loads all six feed sources
├── activity-tabs.tsx              Client wrapper, shadcn Tabs + URL sync
├── tabs/
│   ├── all-tab.tsx                UNION feed
│   ├── runs-tab.tsx
│   ├── tasks-tab.tsx
│   ├── data-sources-tab.tsx
│   ├── approvals-tab.tsx
│   └── records-tab.tsx
├── components/
│   ├── activity-row.tsx           [timestamp] [icon] [label] [pill] layout
│   ├── activity-section.tsx       Card with date header + collapsible body
│   ├── activity-pill.tsx          The status pill from § 7
│   ├── mention-chip.tsx           From § 9
│   └── load-more.tsx              Paginate the Earlier bucket
└── loaders.ts                     loadAllActivity / loadRuns / loadTasks / loadDataSources / loadApprovals / loadRecords
```

Each loader returns the same shape so the renderer is uniform:

```ts
export interface ActivityRow {
  id: string
  event_at: string          // ISO
  kind: PillKind | null
  source: Source | null     // for the icon
  label: string             // primary text
  subtitle?: string         // optional second line
  expand_payload?: unknown  // for "click to see details" rows
}
```

---

## 11. Server-side data loading

All loaders are in `app/activity/loaders.ts` and called from the server component. No client-side fetching for initial render — the data is in the page on first paint.

```ts
export async function loadAllActivity(userId: string, limit = 50, before?: string): Promise<ActivityRow[]>
export async function loadRuns(userId: string, limit = 50, before?: string): Promise<ActivityRow[]>
export async function loadTaskEvents(userId: string, limit = 50, before?: string): Promise<ActivityRow[]>
export async function loadDataSourceSyncs(userId: string, limit = 50, before?: string): Promise<ActivityRow[]>
export async function loadApprovals(userId: string, limit = 50, before?: string): Promise<ActivityRow[]>
export async function loadRecords(userId: string, limit = 100, before?: string): Promise<ActivityRow[]>
```

`before` is the ISO timestamp of the oldest row currently shown — used for "Load more" pagination.

For All Activity, the loader fans out to all five and merges:

```ts
const [runs, tasks, syncs, approvals, records] = await Promise.all([
  loadRuns(userId, 30),
  loadTaskEvents(userId, 30),
  loadDataSourceSyncs(userId, 30),
  loadApprovals(userId, 30),
  loadRecords(userId, 30),
])
return [...runs, ...tasks, ...syncs, ...approvals, ...records]
  .sort((a, b) => b.event_at.localeCompare(a.event_at))
  .slice(0, 50)
```

---

## 12. Empty states

If a tab has zero rows in its history:

- Tabler icon at 32px (`ti-history` for All, `ti-refresh` for Runs, `ti-checkbox` for Tasks, `ti-database` for Records, etc.)
- Centered subtitle: `Nothing here yet. <Tab> activity will appear as taskbash runs.`
- For the Approvals tab specifically: `No draft replies yet. Connect Gmail to start drafting.` with a button linking to `/connections`.

---

## 13. Pagination

Cursor-based, not offset. The "Load more" button at the bottom of the Earlier bucket sends the oldest visible row's `event_at` as the `before` parameter to a server action `loadMoreActivity(tab, before)`. Response: the next 50 rows + a `hasMore` flag.

When `hasMore=false`, replace the button with a faint "End of history" line.

---

## 14. Real-time updates (optional, defer to v2)

When new activity arrives (a digest just completed, a task was just dismissed), the page doesn't auto-refresh. The user has to reload.

Future: subscribe to a Supabase Realtime channel on `task_events`, `runs`, and prepend new rows to the Today bucket with a subtle slide-in. Not v1 scope.

For v1, add a small "Updated 2m ago · Refresh" indicator in the top-right of the page (same pattern as `/today`).

---

## 15. Ship order (2 working days)

### Day 1 — Foundation

- **Morning:** Apply migrations 023 + 024. Backfill `task_events` from existing items. Update server actions in `app/today/actions.ts` to write `task_events` on every transition.
- **Afternoon:** Build `ActivityRow`, `ActivitySection`, `ActivityPill`, `MentionChip`. Build `loaders.ts` skeleton with the six loaders. Get `loadRuns` working end-to-end.

### Day 2 — Tabs + polish

- **Morning:** Build `activity-tabs.tsx` + the six tab components. Wire up all six loaders.
- **Afternoon:** Pagination (`loadMore` server action + "Load more" button). Time-grouping logic. Empty states. Test all six tabs against real data.

---

## 16. Acceptance criteria

The PRD is implemented correctly when:

- [ ] `/activity` renders with six tabs: All Activity / Agent Runs / Tasks / Data Sources / Approvals / Records
- [ ] URL syncs to `?tab=runs` etc.; localStorage persists last-selected
- [ ] Default tab on first visit is All Activity
- [ ] Header reads "Activity" + the matching subtitle
- [ ] Each tab shows rows grouped by Today / Earlier This Week / Earlier
- [ ] Date headers are collapsible; state persists per bucket in localStorage
- [ ] Every row uses the same layout: timestamp, icon, label, optional pill
- [ ] Pills use the kind→color mapping from § 7
- [ ] Source icons use the existing `<BrandLogo />` component
- [ ] Tasks tab shows all five `kind` transitions (created/completed/dismissed/snoozed/slop)
- [ ] Approvals tab shows Completed / Approved / Rejected pills based on `reply_outcome`
- [ ] Records tab renders relative time (`9m ago`, `7h ago`) for entries within a week
- [ ] @-mention pattern `@[Name](kind:uuid)` renders as a chip via the parser
- [ ] "Load more" paginates the Earlier bucket; "End of history" shows when done
- [ ] Empty states render correctly per tab
- [ ] Migrations 023 + 024 applied; `task_events` backfilled
- [ ] tsc + next build clean
- [ ] No em-dashes anywhere in copy

---

## 17. Out of scope

- Real-time updates via Supabase Realtime (v2)
- CSV export of activity feed (someday)
- Bulk actions on rows (e.g. select multiple, dismiss all) — activity is read-only
- Drill-down per row (clicking a row navigates to /today or /handled depending on type) — basic deep-link in v2

---

## 18. Gotchas

1. **`task_events` is write-heavy.** Every status mutation now hits two tables. Wrap the writes in a single transaction via `supabase.rpc` or accept that two inserts per mutation is fine for this volume (taskbash has ~30-50 mutations per user per day, trivial).

2. **The All Activity tab is the most expensive query.** It fans out five sub-queries in parallel and merges. With 200+ open items + 600+ cleared, this could be slow. Index `task_events(user_id, created_at desc)` is essential.

3. **`llm_calls.input_content` may not exist for older rows.** Migration 011 only started storing input_content from then on. Records tab will be sparse for the early history — that's fine, just label it "No record-level history before May 2026" in the empty state.

4. **The Approvals tab depends on `reply_outcome`.** That column comes from the Profile PRD's migration 016. If Profile is built first, this lands cleanly. If Activity ships first, the Approvals tab shows an empty state until Profile lands.

5. **Em-dash ban applies to copy.** Title, subtitle, empty states, button labels — all hyphens or rewrites.

6. **The `<MentionChip>` parser handles three kinds: person, project, thread.** Extend to more kinds as they appear in titles. Unknown kinds render as plain text (graceful fallback).

7. **Page lives inside `PageShell`** (sidebar + calendar column). Don't render full-bleed.

8. **`runs.completed_count` is currently always 0** because auto-complete-vanished is disabled. The Agent Runs subtitle should not say "X cleared" when always zero — instead say `4 sources · 12 new · 27 carried` (drop the cleared count for now).

---

## 19. Eval cron tile (added 2026-05-31)

The Inngest `eval-cron` function runs every 3 days at 9 AM PT. Each
run produces an `agent_events` row of `kind='eval.cron_completed'`,
plus one `kind='eval.regression'` row per dataset whose pass rate
dropped by more than 5 percentage points vs. the previous run.

The Activity page is where the user sees those results. Two surfaces:

### 19.1 Agent Runs tab — top-of-page eval card

When the Agent Runs tab loads, render an `EvalHealthCard` above the
chronological run list. Card layout:

```
┌────────────────────────────────────────────────────────────┐
│ Eval health                                                │
│ Last ran 2 days ago · next run in 1 day                    │
├────────────────────────────────────────────────────────────┤
│ gold-extract.gmail        88% ▁▂▃▅▆▅▆▇▇▇  ↑ 2pp           │
│ slop-extract.gmail        76% ▅▆▅▄▃▄▅▆▇▆  flat            │
│ gold-extract.granola      92% ▆▇▆▇▇▇▆▇▇▇  ↑ 1pp           │
│ slop-extract.granola      71% ▇▆▅▄▃▂▂▁▁▂  ↓ 12pp ⚠       │
│ gold-classify.functions   94% ▇▇▇▇▇▇▇▇▇▇  flat            │
└────────────────────────────────────────────────────────────┘
[View all runs in /observability]
```

Components:

- **Card** wraps the whole thing using shadcn `<Card>` (already in repo).
- **Header row** — H3 "Eval health" left, status line right ("Last ran 2d
  ago · next run in 1d"). Status computed from the most recent
  `agent_events` row with `kind='eval.cron_completed'` + the cron schedule.
- **One row per dataset** — name (mono, 12px), current pass rate
  (tabular-nums 16px), a 10-bar inline sparkline of the last 10 runs,
  and a delta indicator (`↑ Npp` green, `↓ Npp` red, `flat` gray).
- **Regression badge** — when delta < -5pp, append a small ⚠ icon
  (Tabler `ti-alert-triangle`) tinted red. Hovering the row shows a
  tooltip with the regression details from the agent_events payload.
- **Footer button** "View all runs in /observability" links to the
  existing observability dashboard for deep dives.

If no eval datasets exist yet: hide the card entirely. Don't render an
empty-state — eval datasets are an advanced feature, and seeing an empty
card every visit is noise.

### 19.2 Data query

```sql
-- Pass-rate series per dataset for the sparkline
select
  d.id as dataset_id, d.name, d.prompt_id,
  array_agg(
    round((r.passed::numeric / nullif(r.passed + r.failed, 0)) * 100, 1)
    order by r.started_at desc
  ) filter (where r.passed + r.failed > 0) as pass_rates,
  array_agg(r.started_at order by r.started_at desc) as timestamps
from eval_datasets d
join eval_runs r on r.dataset_id = d.id and r.ended_at is not null
group by d.id
order by d.name;
```

In the loader: take the first 10 elements of each array (most recent
10 runs per dataset), reverse to chronological order, compute delta as
`array[length] - array[length - 1]`.

Also load the most recent `kind='eval.cron_completed'` event to
compute "last ran X ago" and the cron's `next_run_at` (via the Inngest
function metadata if available, otherwise compute from cron expression).

### 19.3 Sparkline component

Inline `<EvalSparkline>` component. Pure SVG, no chart library:

```tsx
function EvalSparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null
  const max = 100
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const w = 80
  const h = 16
  const step = w / Math.max(values.length - 1, 1)
  const points = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}
```

The sparkline inherits color from text (`currentColor`). Green for the
gold datasets, amber for slop datasets, red for any dataset currently
in regression.

### 19.4 All Activity feed rendering

Two new row kinds for the All Activity feed:

**`eval.cron_completed`** — one row per cron run:

- Timestamp + `ti-refresh` icon
- Label: `Ran N evals · K regressions` (K from payload.regressions)
- Subtitle (12px muted): comma-separated `dataset: pass_rate%` list
- Pill: `Succeeded` if K=0; `Attention` (amber) if K>0

**`eval.regression`** — one row per dataset that regressed:

- Timestamp + `ti-alert-triangle` icon (red)
- Label: `<dataset_name> regressed` (e.g. `slop-extract.granola regressed`)
- Subtitle (12px muted): `Pass rate XX% → YY% (Δ-Npp)`
- Pill: `Regression` (red, `bg-danger-bg text-danger-fg`)
- Clicking the row navigates to `/observability?dataset=<name>` to see the
  cases that started failing

### 19.5 Add to ActivityPill kind palette

```ts
attention:   { label: 'Attention',   bg: 'bg-tag-action-bg', fg: 'text-tag-action-fg' },
regression:  { label: 'Regression',  bg: 'bg-danger-bg',     fg: 'text-danger-fg'     },
```

Add to the `PILL` table in §7.

### 19.6 New component file

```
app/activity/components/
├── eval-health-card.tsx       The card from §19.1
├── eval-sparkline.tsx         The svg sparkline from §19.3
```

### 19.7 New loader function

```ts
// app/activity/loaders.ts — add
export async function loadEvalHealth(userId: string): Promise<EvalHealth>

export interface EvalHealth {
  lastCronRanAt: string | null
  nextCronAt: string | null
  datasets: Array<{
    datasetId: string
    name: string
    promptId: string
    passRates: number[]        // last 10, chronological
    currentPassRate: number | null
    deltaPP: number | null
    isRegression: boolean      // delta < -5
  }>
}
```

Called from `app/activity/page.tsx` and passed to the Agent Runs tab.

### 19.8 Acceptance criteria (additions to §16)

- [ ] `EvalHealthCard` renders at the top of the Agent Runs tab when
      at least one eval dataset exists
- [ ] Card hides cleanly when no datasets exist
- [ ] Sparklines show the last 10 runs per dataset (or fewer if history
      is shorter)
- [ ] Delta indicator shows `↑ Npp` green, `↓ Npp` red, `flat` gray
- [ ] Regression rows in All Activity link to `/observability?dataset=…`
- [ ] `eval.cron_completed` events render with the correct pill kind
      (Succeeded when regressions=0, Attention when >0)
- [ ] `eval.regression` events render with the Regression pill

---

## 20. One-paragraph TL;DR

> Build `/activity` as a 6-tab page (All / Agent Runs / Tasks / Data Sources / Approvals / Records) modeled on Nummo's screenshots. Each tab is a chronologically-ordered feed of rows with `[timestamp] [source icon] [label] [pill]` shape, grouped under Today / Earlier This Week / Earlier collapsible headers. Tasks tab needs a new `task_events` table (migration 023) writing on every status transition in `app/today/actions.ts`; Data Sources tab needs a `sources_failed` column on `runs` (migration 024) so failed-vs-skipped is distinguishable; Records tab derives from `llm_calls.input_content`. Status pills use a fixed palette (Synced/Approved=green, Rejected/Failed=red, Snoozed=amber, Completed/Running=blue, Slop/Skipped=gray). `@-mention` patterns in task titles render as `<MentionChip>` pills. Pagination via cursor-based "Load more" using `before` timestamp. Server loaders fan out in parallel for the All tab. Ship in 2 days: day 1 = migrations + components + one tab working end-to-end; day 2 = wire remaining tabs + pagination + empty states. Acceptance is in §16. No em-dashes.

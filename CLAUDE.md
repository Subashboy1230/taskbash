# taskbash — handoff context

A working snapshot of the codebase as of May 30, 2026. Drop this into Cursor (or any coding agent) as the seed context so the assistant doesn't have to rediscover everything. Last updated after the Unread Gmail tab + Linear QA pipeline session.

---

## 1. What this is

**taskbash** (formerly ToDoo / cos-app) is a personal chief-of-staff task manager for Subash (subash@sigiq.ai). It pulls action items from Gmail, Granola (meeting notes), Linear, and Google Calendar, runs them through Claude to extract structured tasks, dedupes against what the user has already cleared, and shows everything on a single `/today` page. The user can mark tasks done, mark them as slop (wrong extraction), snooze, or compose Gmail replies that the agent has pre-drafted.

Production URL: `https://taskbash.app` (Vercel, deploys from `main` branch).
Preview URL: dev branch auto-deploys to `taskbash-git-dev-<team>.vercel.app`.
Repo: `https://github.com/Subashboy1230/taskbash`

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15.5 App Router (RSC + Server Actions) |
| Language | TypeScript |
| UI | Tailwind CSS v4 (`@theme` block in `app/globals.css`), shadcn/ui, Radix primitives |
| Auth | Supabase Auth (Google SSO) |
| DB | Supabase Postgres + RLS |
| Background jobs | Inngest (cron for morning digest) |
| LLM | Anthropic (`@anthropic-ai/sdk`) via a custom `tracedMessage` wrapper that logs every call to `llm_calls` table + Langfuse |
| External-API gateway | Nango (OAuth, token refresh, proxy for Gmail + Calendar) |
| Linear | Personal API key (direct GraphQL, no Nango) |
| Granola | API key (direct, no Nango) |
| Hosting | Vercel |
| Domain | GoDaddy → Vercel (A record + CNAME) |
| Observability | Langfuse (LLM traces) + `/observability` admin page (slop rate per prompt version) |

---

## 3. Repo layout

```
~/Desktop/cos-app-v1/
├── app/
│   ├── today/                    Main /today page (3-column shell)
│   │   ├── page.tsx              Server component — loads digest, wraps in TodayShell
│   │   ├── today-shell.tsx       Client shell — sidebar | main | calendar + Sheet for detail/add
│   │   ├── today-view.tsx        ~2.5k LOC. The actual task list UI. Big file.
│   │   ├── today-calendar-column.tsx   Right column: month grid + today's events
│   │   ├── add-task-panel.tsx    Slide-over form for manual task creation
│   │   └── actions.ts            Server actions (complete, dismiss, snooze, slop, addManual, requestRefresh, getEventsForDateAction, openUnreadThread)
│   ├── _components/
│   │   ├── ui/                   shadcn primitives (Button, Sheet, Tabs, DropdownMenu, etc.)
│   │   ├── app-sidebar.tsx       Left sidebar (Home / Profile / Connections / Activity / Network)
│   │   ├── page-shell.tsx        Wrap any page in the 3-column layout
│   │   ├── brand-logo.tsx        Gmail/Granola/Linear icons
│   │   └── status-pill.tsx       Reusable pill component
│   ├── connections/              OAuth UI for connecting Gmail/Calendar/Granola/Linear
│   ├── settings/functions/       Function (work bucket) CRUD: Product/Ops/QA/Hiring/GTM
│   ├── observability/            Admin: every LLM call, latency, slop rate
│   ├── handled/                  Completed tasks log
│   ├── profile/                  User profile placeholder
│   ├── activity/                 Timeline placeholder
│   ├── network/                  People-list placeholder (not built)
│   ├── login/                    Supabase Google SSO entry
│   ├── auth/callback/            Supabase OAuth redirect handler
│   ├── api/inngest/              Inngest webhook endpoint
│   ├── globals.css               Tailwind v4 @theme dark palette (Vercel-style)
│   └── layout.tsx
├── lib/
│   ├── extract/
│   │   ├── gmail.ts              Pull recent inbox threads → Claude → ExtractedItem[]
│   │   ├── granola.ts            Pull recent meetings → Claude → ExtractedItem[]
│   │   ├── calendar.ts           Generate prep briefs for upcoming events
│   │   ├── linear.ts             Filter assigned issues by user-mention-in-comments
│   │   ├── parse.ts              JSON extraction helpers
│   │   └── filters.ts            WORK_ONLY_RULE prompt fragment
│   ├── draft/
│   │   ├── reply.ts              Pre-draft a Gmail reply in user's voice
│   │   └── followup.ts           Decide if a meeting commitment needs a follow-up email
│   ├── digest/run.ts             The main pipeline: extract -> diff -> persist
│   ├── classify/functions.ts     Claude classifier: assign function tags to items
│   ├── brief.ts                  Generate the "why/know/done/next" brief per task
│   ├── diff.ts                   Diff engine: classify fresh items as new/carryover/suppressed
│   ├── normalize.ts              computeSemanticHash + normalizeText
│   ├── anthropic.ts              Claude client (raw)
│   ├── llm-trace.ts              tracedMessage wrapper (writes to llm_calls + Langfuse)
│   ├── langfuse.ts               Langfuse client
│   ├── nango.ts                  Nango proxy + connection management
│   ├── connections.ts            getActiveConnection per source
│   ├── load-digest.ts            Server loader for /today (open + cleared today)
│   ├── load-day-events.ts        Server loader for calendar column (any day)
│   ├── load-unread-gmail.ts      Server loader for unread inbox threads (Unread tab)
│   ├── load-functions.ts         Server loader for user_functions
│   ├── load-handled.ts           Server loader for /handled
│   ├── load-observability.ts     Server loader for /observability
│   ├── function-color.ts         Per-function chip color (name overrides + hash fallback)
│   ├── supabase.ts               Server-side service-role client
│   ├── supabase-server.ts        Auth-aware server client (RSC + Server Actions)
│   ├── supabase-browser.ts       Browser-side public-anon client
│   ├── types.ts                  All shared types — keep in lockstep with migrations
│   ├── mock-items.ts             Fixture data (legacy, for early dev)
│   └── eval/replay.ts            Re-run extractors against historical inputs
├── inngest/
│   ├── client.ts                 Inngest client + EVENTS constants
│   └── functions/morning-digest.ts   Cron version of runDigestForUser (durable via step.run)
├── migrations/                   Numbered SQL files (001-017). Apply via Supabase Mgmt API.
├── scripts/                      One-off helper scripts (tsx)
│   ├── debug-digest.ts           Run digest pipeline + print every stage's output
│   ├── restore-auto-completed.ts Emergency restore for wrongly-closed items
│   ├── rename-functions.ts       Rename existing function rows to short names
│   ├── replay-slop.ts            Re-run slop-marked extractions against current prompt
│   ├── run-eval.ts               Regression test prompts against eval datasets
│   ├── backfill-*.ts             One-off backfills for tags, briefs, follow-ups, functions
│   ├── seed-connections.ts       Initial connection setup
│   ├── test-*.ts                 Per-source smoke tests
│   └── trigger-digest.ts         Trigger the Inngest cron manually
├── components.json               shadcn config
├── CONTEXT.md                    This file
└── package.json
```

---

## 4. Database schema (key tables)

Run `cat migrations/*.sql` for full DDL. Headlines:

**`items`** — every task lives here. Fields:
- `id` uuid PK
- `user_id` uuid FK
- `title` text — what the user sees
- `source` text — gmail | granola | calendar | linear | slack | manual
- `source_ref` jsonb — stable ids per source (gmail_thread_id, gmail_message_id, granola_meeting_id, google_calendar_event_id, linear_issue_id, etc.)
- `semantic_hash` text — sha256(source + parent_context + title) slice 16. UNIQUE per (user_id, semantic_hash).
- `task_type` text — research | context_prep | review | follow_up | post_call | manual
- `tag` text — action | reply | commit | fyi | null
- `status` text — open | in_progress | snoozed | completed | dismissed
- `priority` text — P0 | P1 | P2 | P3 | null
- `due_at` timestamptz
- `urgent` boolean
- `parent_id` uuid — for sub-items
- `parent_context` text — meeting title / email subject
- `function_ids` uuid[] — many-to-many to user_functions (GIN-indexed)
- `proposed_action` jsonb — pre-drafted Gmail reply, etc.
- `source_excerpt` text — quoted source text shown in detail panel
- `brief` jsonb — { why, know[], done, next }
- `brief_status` text — pending | generated | failed
- `brief_generated_at` timestamptz
- `auto_completed_reason` text — was 'source_signal_gone' when extractor missed it (now disabled)
- `snooze_until` timestamptz
- `extraction_meta` jsonb — { llm_call_id, classify_call_id } for observability
- `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `completed_at`

**`user_functions`** — work buckets (Product, Ops, QA, Hiring, GTM). Soft-deleted via `deleted_at`.

**`connections`** — per-source auth state. Either `nango_connection_id` (Gmail/Calendar) or `api_key` (Granola/Linear).

**`llm_calls`** — every Claude call traced. Columns include `prompt_id`, `prompt_version`, `input_content` (for replay), `latency_ms`, `cost_usd`, `produced_item_ids`, `finish_reason`, `error`.

**`item_feedback`** — slop signals. When user marks an item as wrong/spam/repeat, snapshot goes here for prompt training.

**`eval_datasets` + `eval_cases`** — promoted-to-dataset examples for prompt regression tests.

**`runs` + `agent_events`** — Inngest cron audit log.

**`users`** — Supabase auth-managed + a public.users mirror with `email`, `communication_style` ("soul" for reply drafting).

---

## 5. The digest pipeline (the heart of the app)

This is the most important code path. Lives in `lib/digest/run.ts` (sync, called by Re-run button) and `inngest/functions/morning-digest.ts` (cron, same logic wrapped in `step.run` for durability).

**Important:** The Unread Gmail tab is NOT part of the digest pipeline. It is a separate server loader (`lib/load-unread-gmail.ts`) that fetches the raw inbox on page load. Unread threads become items only when the user clicks them (via `openUnreadThread` server action). Do not add unread inbox fetching to the digest extractors — it would create duplicate items and noise.

**Flow per re-run:**

1. **Auto-unsnooze.** Items with `status='snoozed'` and `snooze_until < now()` flip back to `status='open'`.
2. **Load currentItems.**
   - All `open` + `in_progress` items
   - **Top 100 most-recent cleared** (`completed | dismissed | snoozed`). Capped at 100 because re-checking 600+ rows is wasted work and the user wouldn't remember anything older.
3. **Run each connected extractor in parallel** (Gmail, Granola, Calendar, Linear). Skip any without an active connection. Errors don't bubble — a dead source just contributes 0 fresh items.
4. **Classify functions.** One batched Claude call assigns function tags to every fresh item across every source.
5. **Diff per source.** `diffSingleSource(currentItems, freshItems, source)` returns four buckets:
   - **newItems** — fresh, no match in currentItems → INSERT
   - **carryover** — fresh, matches an OPEN row → UPDATE last_seen_at
   - **suppressed** — fresh, matches a CLEARED row → DO NOTHING (the headline anti-resurfacing fix)
   - **completed** — was OPEN, not in fresh → currently a no-op (auto-complete-vanished disabled)
6. **Persist.** Insert newItems with the producing `llm_call_id` so `/observability` can join. Update last_seen_at on carryover. Suppressed and completed buckets are not written.
7. **Tag llm_calls with produced item ids** (for slop_rate computation).
8. **Flush Langfuse.**

**Match precedence in the diff** (this is subtle and load-bearing):

1. **semantic_hash first.** `hash(source + parent_context + title)`. Most specific — uniquely identifies an item.
2. **source_ref as fallback.** Handles LLM title variation across runs. Per-source key:
   - gmail: `gmail:{thread_id}:{message_id}` (BOTH ids; thread alone would collapse multiple messages)
   - granola: `granola:{meeting_id}`
   - calendar: `calendar:{event_id}`
   - linear: `linear:{issue_id}`
   - slack: `slack:{channel_id}:{ts}`

If both miss → NEW item.

**What ONLY closes a task:**
- User clicks Done in the UI
- User clicks Slop in the UI
- User snoozes and the snooze fires past `due_at` (handled elsewhere)
- Source itself transitions (e.g., a Linear issue moves to Done state — handled by extractor not returning it)

The digest will NEVER auto-close a task just because an extractor didn't return it. The `result.completed` bucket is computed for instrumentation but not acted on.

---

## 6. Recent critical fixes (commits on `dev` not yet on `main`)

Most recent first:

- **`b874931`** Mark as Done from detail panel hides task optimistically (shellHiddenIds in TodayShell); reply-to address now picks non-Subash participant so drafts don't self-address
- **`4017f9e`** Unread thread open: look up existing item by semantic_hash across all statuses (was filtering open only, causing unique constraint crash on re-open)
- **`dbb2ba3`** Detail panel Mark as Done now awaits completeItem + router.refresh()
- **`b45423a`** Calendar right column: events panel scrollable (flex-1 + overflow-y-auto)
- **`2cc7b76`** Calendar day clicks no longer filter the main task list — selectedDay is internal to TodayCalendarColumn, only drives the right column events panel
- **`6162e09`** Unread Gmail tab (lib/load-unread-gmail.ts + today-view.tsx UnreadTab + UnreadThreadRow); click drafts reply with Claude and upserts item to DB; SVG logo in sidebar (public/logo.svg); Linear QA pipeline issues (QA Requested / Changes Requested / In QA / QA Passed states pulled regardless of assignment, merged + deduped with mention issues)
- **`5d86660`** Cap cleared dedup at 100, raise display cap 50→200
- **`fae8698`** Gmail today's reply on a cleared thread now extracts as a new task (thread+message dedup, not thread alone)
- **`524e729`** Stop auto-complete-vanished entirely + restore script + Linear comment-mentions filter
- **`2fc9651`** Load cleared items into diff + source_ref matching (the original anti-resurface fix; superseded by 524e729 + fae8698)
- **`9cc4f3f`** Popover z-index, calendar collapse expands main, add manual task, function color overrides

These are all on `dev` waiting for QA before push to `main`. Run `git log --oneline dev origin/main..dev` to see the exact set pending.

---

## 7. Conventions

**Em-dashes are banned everywhere.** Every system prompt in `lib/extract/*` `lib/draft/*` `lib/brief.ts` `lib/classify/*` has an explicit `STYLE RULE (absolute): NEVER use em-dashes (—)`. Drafted Gmail replies in particular benefit since those go to recipients. UI strings also use hyphens or rewrites, not em-dashes. Code comments still have some; those aren't user-visible.

**shadcn/ui in `app/_components/ui/`.** Don't roll new primitives — use Button, Input, Label, Badge, Card, Sheet, Tabs, Tooltip, DropdownMenu, Separator from there. Tokens map to the dark palette via `globals.css`.

**Dark theme tokens** in `app/globals.css`:
- `--color-canvas` `#0a0a0a` background
- `--color-surface` `#141414` cards
- `--color-ink` `#fafafa` primary text
- `--color-accent` `#fafafa` (light-on-dark; buttons are light bg with dark text)
- Tag colors are translucent bg (18% opacity) with bright fg

**Function chip colors** are name-overridden in `lib/function-color.ts`:
- Product → pink, Ops → cyan, QA → amber, Hiring → blue, GTM → coral
- Falls back to a hash if name doesn't match the override table.

**Server actions are in `app/today/actions.ts`** and similar per-route `actions.ts` files. Always start with `'use server'`. Always call `revalidatePath('/today')` after a mutation.

**Server components do the data loading** (`loadDigest`, `loadUserFunctions`, etc.). Client components receive the data as props and handle interaction. Avoid client-side fetching for first paint.

**Service-role Supabase client** (`lib/supabase`) is for server actions and Inngest. **Anon-key client** (`lib/supabase-browser`) is for client components. **Auth-aware server client** (`lib/supabase-server`) is for RSC + Server Actions that need RLS.

---

## 8. Local dev

**Setup:**

```bash
cd ~/Desktop/cos-app-v1
npm install
cp .env.example .env.local   # then fill in keys (see below)
```

**Required env vars (`.env.local`):**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — admin client (RLS-bypass)
- `ANTHROPIC_API_KEY`
- `NANGO_SECRET_KEY` — for Gmail + Calendar
- `GRANOLA_API_KEY` — direct, no Nango
- `LINEAR_API_KEY` — personal API key
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` — optional, observability
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — for cron
- `APP_USER_ID` — Subash's auth.users.id (used as fallback when no session)

**Run:**

```bash
npm run dev                 # localhost:3000
npm run inngest             # local Inngest dev server (for cron testing)
npm run typecheck
npm run build               # production build (verify before push)
```

**Useful scripts:**

```bash
npx tsx scripts/debug-digest.ts gmail        # Run extractor + diff with full output
npx tsx scripts/debug-digest.ts              # All sources
npx tsx scripts/restore-auto-completed.ts    # Undo wrongful auto-complete (last 24h)
npx tsx scripts/restore-auto-completed.ts --since=2026-05-29T00:00:00Z
npx tsx scripts/rename-functions.ts          # Bulk rename existing function rows
npx tsx scripts/test-gmail.ts                # Smoke test Gmail extractor
npx tsx scripts/trigger-digest.ts            # Fire the Inngest cron
npm run eval                                 # Regression test prompts
```

---

## 9. Deployment

**Branches:**
- `main` → auto-deploys to `https://taskbash.app` (production)
- `dev` → auto-deploys to `https://taskbash-git-dev-<team>.vercel.app` (preview)

**Push to dev first, verify on preview, then merge to main:**

```bash
git checkout dev
git push origin dev                  # triggers Vercel preview build
# verify preview URL works
git checkout main
git merge dev
git push origin main                 # ships to prod
```

**Migrations** are applied via the Supabase Management API (one-off, not in the app). When you add a new `migrations/NNN_*.sql`:

```bash
# See scripts/apply-migration.ts pattern (build one if missing)
curl -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -d "$(cat migrations/014_new.sql | jq -Rs .)"
```

Or use a Supabase CLI workflow if you set one up.

---

## 10. Auth + connections

**Auth:** Supabase + Google SSO. `app/auth/callback/route.ts` handles the OAuth redirect. Sessions are HTTP-only cookies via `@supabase/ssr`.

**Connections** (per source):
- **Gmail + Google Calendar** via Nango OAuth. User clicks Connect on `/connections`, Nango popup handles consent, `nango_connection_id` saved to `connections` table.
- **Granola** via direct API key. User pastes the key on `/connections`.
- **Linear** via direct Personal API key. User mints one at linear.app → Settings → Security & access → Personal API keys.
- **Slack** is scaffolded (`lib/extract/slack.ts` written) but OAuth flow not wired — deferred.

`lib/connections.ts → getActiveConnection(source)` is the single read path. Returns `null` if disconnected.

---

## 11. Observability + evals

**Every Claude call goes through `tracedMessage()`** which:
- Writes the call to `llm_calls` (input/output/latency/cost)
- Fire-and-forgets to Langfuse for ad-hoc inspection
- Returns the call id so the caller can stamp it on produced items

**`/observability`** shows:
- Recent calls table (per-call latency, cost, error)
- Slop rate per prompt_id + prompt_version (the headline metric — keep it dropping)
- Promote-to-dataset action (right-click a call, add to eval set)

**Eval workflow:**
1. User marks an item as Slop with a reason
2. `item_feedback` row captures the snapshot
3. Optionally promote to an `eval_dataset`
4. `npm run eval` re-runs the current prompt against every case and reports pass/fail

This is the loop: production usage → slop signals → eval cases → prompt iteration.

---

## 12. Known issues / pending work

**Pending:**
- `#41` Slack OAuth + extractor (deferred to Week 5)
- `#49` Rotate Linear Personal API key — user said done verbally, never marked
- `#108` Network page MVP — sidebar entry exists but page is a placeholder. Plan: scan Gmail for distinct contacts, cache to a `contacts` table, render people list with name + org + last interaction
- Mark as Done from the Sheet detail panel is partially working — `completeItem` fires and `router.refresh()` is called, but the task may not visually disappear consistently; investigate whether the shellHiddenIds optimistic hide is being applied before the refresh cycle
- The DetailPanel's Edit + History header buttons have no onClick handlers — decorative
- Unread tab: `openUnreadThread` drafts reply with Claude but the reply-to address uses heuristic (first non-Subash From header); works for simple threads, may be wrong on CC'd threads
- `.gitignore` doesn't exclude `.taskbash-*.md` status files or `.claude/settings.local.json` (both have snuck into recent commits)

**Nice-to-haves discussed but not scoped:**
- Inline subtask renaming (currently can add/check/delete only)
- Drag-to-reorder priorities within a bucket
- Recurring tasks ("every Friday, file expenses")
- Cmd+K command palette (key handler exists, does nothing)

**Subash's working set right now:**
- ~184 open items in DB (a lot — residue from the wrongful auto-clear + restore cycle). With auto-complete-vanished now disabled, this needs to be worked down manually by clearing through it.
- 665 cleared items in 60 days (but dedup only checks top 100 now)

---

## 13. Future direction (the strategic plan)

The product is a personal assistant that gets smarter from your slop signals. Direction:

**Near-term (next 2 weeks):**
- Network page MVP — surface every distinct person you've talked to with last-interaction context
- Cmd+K command palette
- Slack OAuth
- Drag-to-reorder priorities

**Medium-term:**
- "Soul" — learned communication style for drafted replies. Currently in `lib/draft/reply.ts`; needs more training signal.
- Smarter brief generation — current `lib/brief.ts` produces why/know/done/next; can incorporate prior brief revisions
- Calendar prep briefs — already extract for upcoming events; want them to read prior context (last meeting with this person, prior commitments)

**Long-term thesis:**
- Move from "extract + dedup" to "agent that closes the loop." E.g., if a thread is `tag='reply'`, the agent drafts it (done), tracks whether you sent it, follows up if not.
- Multi-tenant: currently hard-codes `subash@sigiq.ai` in many places. Week 5+ work to generalize.
- A "morning briefing" voice/audio digest you listen to while making coffee.

---

## 14. Key gotchas Cursor should know

1. **Don't reinstate auto-complete-vanished.** Easy mistake to "fix" the `result.completed` no-op in `lib/digest/run.ts` line ~190. That's intentional. The diff still computes it but we don't act on it. Tasks only close when the user clears them.

2. **Don't change semantic_hash inputs.** It hashes source + parent_context + title. Changing those inputs invalidates the unique index and breaks dedup across the existing 800+ items.

3. **`lib/nango.ts` validates env at module load.** Any script that imports it must call `dotenv.config()` BEFORE the import (dynamic imports are the workaround — see `scripts/debug-digest.ts`).

4. **Server actions revalidate paths explicitly.** After every mutation, `revalidatePath('/today')` or the page won't refresh.

5. **Tailwind v4 uses `@theme`, not `tailwind.config.ts`.** All tokens live in `app/globals.css`. Don't create a tailwind.config or it'll fight the @theme.

6. **shadcn primitives expect token names from globals.css.** If you copy-paste a stock shadcn component, it uses `bg-background text-foreground` etc. These are mapped to our dark palette via `globals.css`. Don't override with raw colors.

7. **Em-dash banned in AI prompts AND UI.** If you add a system prompt or UI string, write it without em-dashes. Use hyphens, colons, periods, or rewrite.

8. **TodayView is ~2.5k LOC and growing.** Worth refactoring at some point (split TaskRow, DetailPanel, FilterBar into their own files). Defer until you actually need to.

9. **`days` lookback is 7 by default** for Gmail and Granola. If a task is older than that and gets cleared, it can't be auto-restored from the source — it'd need a wider window. Tunable in `runDigestForUser`.

10. **The Re-run tasks button calls `runDigestForUser` synchronously** and takes 30-60 seconds (one Claude call per Gmail thread + per Granola meeting). The UI shows a Loader2 spin. Don't let users mash it — there's no rate limiting.

---

## 15. One-page summary for Cursor

> taskbash is a Next.js 15 + Supabase + Anthropic personal task manager. It extracts action items from Gmail / Granola / Linear / Calendar via Claude, dedupes them by stable source_refs and semantic hashes, and shows everything on /today. Tabs: Open (main task list), Prep (calendar), Cleared Today, Unread (live unread Gmail inbox — NOT extracted by the digest, surfaced as a separate tab via lib/load-unread-gmail.ts; clicking a thread drafts a reply with Claude via openUnreadThread server action and upserts to items table). Linear extractor pulls both assigned+mentioned issues AND any issue in QA Requested / Changes Requested / In QA / QA Passed states regardless of assignment. Calendar day clicks only update the right-column events panel — they do NOT filter the main task list. Sidebar uses public/logo.svg SVG mark. Key invariants: tasks only close on user action (never auto-closed by extractor), semantic_hash = sha256(source+parent_context+title).slice(16), dedup checks top 100 cleared items. Dev branch is ~15 commits ahead of main. Local dev: `npm run dev`; debug pipeline: `npx tsx scripts/debug-digest.ts gmail`.

That's the whole story. Open this file in Cursor before starting work, plus the relevant `lib/*` files for whatever you're editing.

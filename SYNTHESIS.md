# taskbash — project synthesis

> Snapshot as of **2026-06-14**, branch **`feat/hackathon-stack`**.
> This is the current-state overview. `README.md` ("Week 1, no UI yet") and `CLAUDE.md` (dated May 30) are both stale — `CLAUDE.md` is still the best deep handoff but predates migrations 018-030 and the entire "hackathon stack" (Nebius, Tavily, Composio/Slack, mem0, WhatsApp, Sentry).

---

## What it is

**taskbash** (née `cos-app` → `ToDoo`) is a **personal chief-of-staff task manager**, single-user, built for and around Subash (subash@sigiq.ai). It watches your work surfaces — Gmail, Granola meeting notes, Google Calendar, Linear, and Slack — runs everything through Claude to **extract structured action items**, dedupes them against what you've already dealt with, and presents one ranked list on `/today`. It also drafts your email replies in your voice, writes prep briefs before meetings, and pings you on WhatsApp.

- **Prod:** `taskbash.app` (Vercel, deploys from `main`)
- **Repo:** `github.com/Subashboy1230/taskbash`

## The thesis

Two ideas hold the whole thing together:

1. **Durable state, not a rotating to-do file.** The `items` table is canonical. Every run diffs fresh extractions against existing state, so a task you cleared yesterday never resurfaces, and a task that's still live just gets its `last_seen_at` bumped.
2. **It gets smarter from your mistakes.** When you mark an item "slop" (wrong extraction), that signal flows into a feedback loop — `item_feedback` → mem0 memory + eval datasets → prompt iteration — measured by **slop-rate per prompt version** on `/observability`. The product's north-star metric is that rate trending down.

## The digest pipeline (the heart)

Lives in `lib/digest/run.ts`, wrapped for durability in `inngest/functions/morning-digest.ts`. One run:

```
1. Auto-unsnooze      snoozed items past their time flip back to open
2. Load current state open + in_progress, plus top-100 most-recent cleared
3. Extract (parallel) Gmail · Granola · Calendar · Linear · Slack
                      dead/disconnected sources contribute 0, never throw
4. Classify functions ONE batched LLM call tags every fresh item (Product/Ops/QA/…)
                      injects mem0 user-preference memories as soft constraints
5. Diff per source    new → INSERT · carryover → bump last_seen_at
                      suppressed (matches a cleared item) → DO NOTHING  ← anti-resurface
                      completed (vanished from source) → computed but NOT acted on
6. Persist + tag      insert with producing llm_call_id so /observability can join
7. Flush traces       Langfuse
```

**Load-bearing invariants** (don't break these):

- **Tasks only close on user action.** The digest *never* auto-completes a task just because an extractor stopped returning it. Auto-complete-vanished was tried and deliberately disabled (`result.completed` is computed for instrumentation only).
- **Dedup match order:** `semantic_hash = sha256(source + parent_context + title).slice(16)` first, then per-source `source_ref` fallback (Gmail uses *both* thread + message id, so a new reply on a cleared thread correctly becomes a new task). Don't change the hash inputs — it invalidates the unique index across 800+ existing items.
- **The Unread Gmail tab is NOT in the pipeline.** It's a live inbox view (`lib/load-unread-gmail.ts`); threads become items only when you click them.

## Tech stack (current)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router (RSC + Server Actions), TS strict |
| UI | Tailwind v4 (`@theme` in `app/globals.css`), shadcn/ui + Radix, dark Vercel-style palette |
| Auth + DB | Supabase (Google SSO, Postgres, RLS) |
| Background jobs | Inngest (7 functions) |
| LLM primary | Anthropic — **Haiku 4.5** (extract/classify/fast), **Opus 4.7** (briefs/prep) |
| LLM classifier | **Nebius Token Factory / Llama 3.3 70B**, flag-gated `CLASSIFY_PROVIDER=nebius` |
| OAuth gateway | Nango (Gmail, Calendar) |
| Slack | Composio v3 SDK (`@composio/core`) |
| Enrichment | Tavily ("who they are" attendee blurbs on prep briefs) |
| Memory | mem0 (learned user preferences) |
| Messaging | Twilio (WhatsApp digest + meeting reminders) |
| Observability | Langfuse (LLM traces) + Sentry (exceptions) + `/observability` page |

Every Claude call goes through one wrapper, `lib/llm-trace.ts` `tracedMessage()`, which logs input/output/latency/cost to `llm_calls`, fires to Langfuse, and returns the call id so produced items link back for slop-rate math. The Nebius classifier path mirrors this via `lib/nebius-trace.ts` so per-prompt slop rate works across both providers.

## Product surface (what's actually built)

- **`/today`** — the app. Three columns (sidebar · task list/detail · calendar). Tabs: Open, Prep, Cleared Today, Snoozed, Unread. Drag-to-reorder (fractional `sort_order` midpoint insertion), inline subtasks, AI descriptions, draft approve/send, snooze, slop. `today-view.tsx` is ~2.5k LOC and overdue for a split.
- **`/connections`** — OAuth + API-key setup for 5 sources.
- **`/profile`** — Overview · **Voice** (communication style extracted from your sent mail) · **Prompts** (every system prompt + slop rate + "suggest a tweak") · Stats.
- **`/observability`** — admin LLM ops: per-prompt cost/latency/error/slop-rate, promote-call-to-eval-dataset.
- **`/activity`** — ops timeline: runs, task lifecycle events (`task_events`), source syncs, approvals, eval health.
- **`/handled`** — completion archive.
- **`/settings/functions`** + **`/settings/whatsapp`** — work-bucket CRUD and notification prefs.
- **`/home`** — full marketing landing page.
- **`/network`** — the one real placeholder ("everyone you've emailed, by org" — not built).

## Background jobs & cadence

| Job | Schedule | Does |
|---|---|---|
| `morning-digest` | 7:00 AM PT | full extract → diff → persist |
| `gmail-poll` | every 5 min | incremental Gmail (`history.list`) → new items |
| `whatsapp-meeting-scheduler` | every 5 min | finds meetings 9-11 min out, fires reminder event |
| `whatsapp-meeting-reminder` | event-driven | ~10 min pre-meeting WhatsApp w/ prep summary |
| `whatsapp-morning-digest` | hourly | TZ-aware; sends to users whose local time matches, respects quiet hours |
| `draft-cleanup` | 4:00 AM | deletes Gmail drafts >14 days old |
| `eval-cron` | every 3 days | re-runs eval datasets, alerts on >5pp regression |

Inngest webhook at `app/api/inngest/route.ts`; Twilio status/inbound webhook (STOP/START/HELP) at `app/api/whatsapp/webhook/route.ts` (HMAC-verified).

## Data model in one breath

`items` is everything (title, `source`, `source_ref`, `semantic_hash`, status, priority, `function_ids[]`, `brief`, `proposed_action`, `gmail_draft_id`, `draft_confidence`, `role` top/subtask…). Supporting cast: `user_functions` (work buckets), `connections` (per-source auth), `llm_calls` (every traced call), `item_feedback` + `eval_datasets`/`eval_cases` (the learning loop), `task_events` (lifecycle audit), `whatsapp_messages_sent` (idempotent on `dedup_key`), `runs`/`agent_events` (cron audit). `users` carries `communication_style` + `voice_examples` (reply voice) and the WhatsApp prefs.

Migrations run 001→030 (021/022/029 skipped). 018-030 added: AI descriptions, voice capture, prompt-suggestions, task-events audit, `runs.sources_failed`, the full Gmail-draft lifecycle (ids + confidence + blocklist + auto-draft toggles), explicit subtask `role`, and the WhatsApp system.

## Current state & frontier

- **`feat/hackathon-stack`** is the active branch and the frontier: it layered **Nebius classifier, Tavily enrichment, Composio/Slack, mem0 memory, WhatsApp/Twilio, and Sentry** on top of the documented base, and closed the three big slop clusters (Linear QA-mention filter, Granola owner-aware extraction, Gmail verb-stem dedup), wiring mem0 into the slop→classify loop.
- **Resolved since the June-10 docs:** the slop docs flagged a broken feedback loop (no `llm_call_id` linkage) and several PRDs (activity page, profile/voice, auto-Gmail-drafts) as "to build" — those are now **shipped** (linkage is in `extraction_meta`, the pages exist, drafts materialize into Gmail via `lib/gmail/drafts.ts`).
- **Known debt:** ~180 stale open items (residue from the auto-clear/restore incident, now manual to work down); a hydration error (#418) flagged in QA; a 16-item UI-consistency audit (pill shapes, source naming, font literals) staged but not executed; `/network` unbuilt.
- **Next strategic step:** the **Week 4 multi-tenant auth epic** — converting from the hardcoded single user (`APP_USER_ID`) to real per-user OAuth, which unlocks signup and Subash's work email.

## House rules baked into the code

- **Em-dashes are banned** in every AI prompt *and* user-facing string (drafts go to real recipients). Hyphens/colons only.
- shadcn primitives only (`app/_components/ui/`); tokens come from `globals.css` `@theme` (no `tailwind.config`).
- Server components load data; client components take props; every mutation calls `revalidatePath`.
- `lib/nango.ts` validates env at module load — scripts must `dotenv.config()` before importing it (use dynamic import; see `scripts/debug-digest.ts`).
- Three Supabase clients: service-role (`lib/supabase`, server actions + Inngest), anon (`lib/supabase-browser`, client), auth-aware (`lib/supabase-server`, RSC under RLS).

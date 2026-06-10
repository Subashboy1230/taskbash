# cos-app — v1 (Week 1 scaffold)

A personal chief-of-staff task manager. Pulls action items from your sources (Granola, eventually Gmail + Slack), runs a morning diff against yesterday's state, and surfaces what's new / carried over / quietly completed.

This repo is the **Week 1** subset — just the diff engine, no UI yet. By end of Week 1 you should be able to:

1. Connect Granola via Nango Connect
2. Trigger the morning digest manually
3. See items appear in your Supabase `items` table
4. Run it again tomorrow and see new vs carryover correctly diffed

UI, Gmail, Slack, briefs, and the admin panel all come in Weeks 2–6.

---

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router) on Vercel |
| Database | Supabase Postgres + RLS + Auth |
| Background jobs | Inngest (crons + event functions) |
| OAuth + connectors | Nango (Gmail / Calendar / Granola / Linear), Composio (Slack) |
| LLM (primary) | Anthropic Claude (Haiku for extraction, Sonnet for synthesis) |
| LLM (classifier) | Nebius Token Factory (Meta Llama 3.1 70B) for `classify.functions`, flag-gated |
| Web search / enrichment | Tavily (live "who they are" blurbs on meeting prep briefs) |
| Observability | Langfuse (LLM traces, slop scores) + Sentry (production exceptions) |
| Messaging | Twilio (WhatsApp morning digest + meeting reminders) |
| Language | TypeScript (strict) |

---

## Setup

Follow [WEEK_1_CHECKLIST.md](./WEEK_1_CHECKLIST.md) step-by-step. It walks you through:

1. Creating accounts (Supabase, Nango, Inngest, Anthropic, Vercel)
2. Running the migration
3. Configuring `.env.local`
4. Connecting Granola via Nango
5. Running the dev servers
6. Triggering the digest manually
7. Verifying the diff works tomorrow

Or for the impatient:

```bash
npm install
cp .env.example .env.local      # then fill in keys
# In Supabase SQL editor, run migrations/001_mvp.sql

# Three terminals:
npm run dev                      # Next.js
npm run inngest                  # Inngest dev server
npm run test:diff                # trigger the digest manually
```

---

## Project structure

```
cos-app-v1/
├── migrations/
│   └── 001_mvp.sql            # Run in Supabase SQL editor
├── lib/
│   ├── types.ts               # Schema types
│   ├── supabase.ts            # Server-side admin client
│   ├── nango.ts               # Nango proxy wrapper
│   ├── anthropic.ts           # Claude client + model constants
│   ├── normalize.ts           # Dedupe key normalization + hash
│   ├── diff.ts                # Pure diff function (new/carryover/completed)
│   └── extract/
│       └── granola.ts         # Granola → Claude → ExtractedItem[]
├── inngest/
│   ├── client.ts              # Inngest client + event name constants
│   └── functions/
│       └── morning-digest.ts  # The daily 7am job
├── app/
│   └── api/
│       └── inngest/
│           └── route.ts       # Inngest webhook receiver
├── scripts/
│   └── test-diff.ts           # Manually trigger the digest
├── package.json
├── tsconfig.json
├── next.config.ts
└── .env.example
```

---

## Architecture in one paragraph

The product is a personal task manager where every task has a brief attached (briefs come in Week 5+). The `items` table is the canonical state. Inngest cron functions pull data from sources (Granola for now), Claude extracts action items, the diff engine compares fresh data against existing open items, and three buckets fall out: **new** items get inserted, **carryover** items get their `last_seen_at` bumped, and items that have **vanished from source** get auto-completed. State is durable across runs — no JSON file rotating between sessions.

For the full architecture, see the sibling docs in `../`:
- `brief-spec.md` — what makes a great task brief (Week 5+ feature)
- `item-model.md` — the full schema (only a subset is implemented in Week 1)
- `agents.md` — orchestration architecture (extractors / retrieval / synthesis / memory)
- `admin-ui.md` — operator panel (Week 4+)

---

## Granola API — important note

Nango's Granola integration **may not be fully featured**. If the proxy call in `lib/extract/granola.ts` returns 404 or auth errors, two fallbacks:

1. **Direct Granola API** — Granola has a public API at `api.granola.so`. Get a personal access token from Granola settings, store as `GRANOLA_PAT` env var, swap the `nangoProxy` call for a raw `fetch`. Lose token refresh; gain working extraction.
2. **MCP client** — Install `@modelcontextprotocol/sdk`, connect to Granola's MCP server, use `query_granola_meetings` tool. More setup; matches what your existing Claude skill does today.

Pick (1) for Week 1 if Nango doesn't work. We'll properly wire (2) in Week 3 when we have time.

---

## Week 1 success criteria

By end of Week 1, you've verified all of these in the Supabase dashboard:

- [ ] Running the digest creates a row in `runs` with `status = 'succeeded'`
- [ ] First run inserts N rows into `items` with `status = 'open'`
- [ ] Re-running the same day → 0 new, N carryover (no duplicates)
- [ ] Day 2: items still in Granola → carryover; items that disappeared → `status = 'completed'`, `auto_completed_reason = 'source_signal_gone'`
- [ ] `agent_events` has one row per significant decision

Once those check out, move to Week 2: Gmail + Slack connectors + the `/today` page.

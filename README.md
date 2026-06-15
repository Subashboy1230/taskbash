# taskbash

**An AI chief of staff that auto-extracts your tasks** from Gmail, Google Calendar, Granola, and Linear, dedupes them against what you've already handled, and surfaces one ranked list every morning — with pre-drafted replies and meeting prep already attached.

🔗 **Live (in production): https://taskbash.app**  ·  Built for BuilderShip, June 2026.

---

## Sponsor integrations (with receipts)

Every sponsor below is **load-bearing** — remove it and a real feature breaks. Click straight to the code.

| Sponsor | What it does in taskbash | Where in the code |
|---|---|---|
| **Composio** | OAuth connector fabric across all sources; Slack ingestion. Migrated to the **v3 SDK** (`@composio/core`) with Auth Configs + Connected Accounts. | [`lib/connectors/composio.ts`](lib/connectors/composio.ts), [`scripts/composio-init-slack.ts`](scripts/composio-init-slack.ts) |
| **Tavily** | Live web search on every external meeting attendee at extraction time, so prep cards arrive pre-populated (prep 5 min → 30 sec). | [`lib/enrich/tavily.ts`](lib/enrich/tavily.ts), [`scripts/backfill-tavily.ts`](scripts/backfill-tavily.ts) |
| **Nebius Token Factory** | Function classifier on **Llama 3.3 70B** at ~1/10 Claude Haiku's cost per call; every call traced into an `llm_calls` table for A/B + slop tracking. | [`lib/nebius-trace.ts`](lib/nebius-trace.ts), [`lib/classify/functions.ts`](lib/classify/functions.ts) |
| **mem0** | Closes the feedback loop: clicking **"slop"** distills a durable user preference that the *next* classify call reads back, so the agent learns what to surface. | [`lib/memory/mem0.ts`](lib/memory/mem0.ts), [`lib/memory/record.ts`](lib/memory/record.ts), [`lib/memory/fetch.ts`](lib/memory/fetch.ts) |

The slop → preference loop in one path: mark slop in [`app/today/actions.ts`](app/today/actions.ts) → recorded to `item_feedback` + mem0 → read back in [`lib/classify/functions.ts`](lib/classify/functions.ts) on the next run.

---

## How it works

The digest pipeline ([`lib/digest/run.ts`](lib/digest/run.ts)) runs on an Inngest cron and on demand:

```
extract (Granola · Gmail · Calendar · Linear · Slack, in parallel)
  → classify into work areas (Nebius Llama 3.3 70B, mem0-aware)
  → diff vs. existing tasks (new / carryover / suppressed)
  → persist + deliver (prep briefs via Tavily, Gmail drafts in your voice)
```

Durable state in the `items` table is canonical: a task you cleared never resurfaces, and tasks only close on **your** action — never auto-closed by an extractor.

## Built-in observability & evals (the depth)

Every LLM call goes through one wrapper ([`lib/llm-trace.ts`](lib/llm-trace.ts)) that logs input/output/latency/cost to an `llm_calls` table and fires to Langfuse. The [`/observability`](app/observability/page.tsx) admin page shows per-prompt **slop rate** by prompt version — the north-star metric. Slop signals become eval cases, so production usage → eval datasets → prompt iteration.

## Stack

Next.js 15 (App Router) · Supabase (Postgres + RLS + Auth) · Inngest (crons) · Anthropic Claude (Haiku extract / Opus synthesis) · Nango (Gmail/Calendar OAuth) · **Composio · Tavily · Nebius · mem0** · Langfuse + Sentry · Twilio (WhatsApp digest) · Vercel.

## Run it locally

```bash
npm install --legacy-peer-deps
cp .env.example .env.local      # fill in keys (see .env.example)
# apply migrations/*.sql to your Supabase project
npm run dev                     # http://localhost:3000
npm run inngest                 # local cron runner (separate terminal)
```

See [`CLAUDE.md`](CLAUDE.md) for the full architecture and conventions.

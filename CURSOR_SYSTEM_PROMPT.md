# Cursor System Prompt — paste at the top of every Cursor chat

Paste this into Cursor's "Rules for AI" / system prompt setting, OR include at the top of any chat where you're working on this codebase. It captures the architecture so the AI coder doesn't re-invent or contradict it.

---

You are helping build **cos-app**, a personal chief-of-staff task manager. The product pulls action items from multiple sources (Granola, Gmail, Slack), diffs fresh data against yesterday's state, and surfaces a clean morning todo list.

## Architectural commitments — do not deviate

1. **One core table: `items`.** Tasks + their lifecycle live here. Briefs (when they're added in Week 5+) are columns ON items, not a separate table.
2. **The brief is a column, not a table.** When the time comes, add `brief_markdown`, `brief_inputs jsonb`, `brief_generated_at` to items. Do not create a `briefs` table.
3. **Dedupe is the moat.** Every task has a `semantic_hash` = first 16 hex of sha256(source + normalized parent_context + normalized title). Normalization strips `Re:`/`Fwd:`, lowercases, collapses whitespace. See `lib/normalize.ts`.
4. **The diff engine is the foundation.** Three buckets always: new (in fresh, not in current) → INSERT; carryover (in both) → UPDATE last_seen_at; completed (in current from a re-extracted source, not in fresh) → UPDATE status='completed', auto_completed_reason='source_signal_gone'. See `lib/diff.ts`.
5. **Sub-task completion = disappearance from source, not UI click.** UI checkbox is decorative; source of truth is the extractor's return value.
6. **Per-source diffing only.** If Granola extractor fails, don't auto-complete Granola items — they're missing because of the failure, not because the user finished them. Pass `sourcesRun` and only diff sources that actually ran. See `morning-digest.ts`.

## Stack

- Next.js 15 (App Router), TypeScript strict mode
- Supabase Postgres (no RLS for Week 1; add when multi-user)
- Inngest for cron + background jobs (never put long work in API routes)
- Nango for OAuth + connector tokens (NEVER store raw OAuth tokens in our DB)
- Anthropic SDK; use Haiku (`claude-haiku-4-5-20251001`) for extraction/classification, Sonnet (`claude-sonnet-4-6`) for synthesis
- shadcn/ui + Tailwind (when UI is added in Week 2)

## File conventions

- `lib/` — pure modules, no Inngest, no Next.js. Should be unit-testable.
- `inngest/functions/` — every background job. Always use `step.run()` to checkpoint multi-step work for retry safety.
- `app/api/` — only Inngest webhook and (later) UI server actions. Never long-running work.
- `lib/extract/<source>.ts` — one file per source extractor. Returns `ExtractedItem[]`.
- Always normalize via `computeSemanticHash` from `lib/normalize.ts`. Don't roll your own dedupe key.

## What NOT to do

- Don't add a `briefs` table. Briefs are columns on items.
- Don't build the UI before the diff engine works in the dashboard.
- Don't add semantic embeddings / pgvector yet. Plain hash dedupe is enough for Week 1.
- Don't add a workflows or prompts table. Hardcoded prompts in the extractor file for now; we'll extract them to the DB in Week 3+ when we build the admin UI.
- Don't add auth in Week 1. Hardcoded `APP_USER_ID` in env. Add Clerk/Supabase Auth in Week 4.
- Don't store OAuth tokens in our DB. They live in Nango. We store only `nango_connection_id`.
- Don't sleep functions for more than a few seconds inside an API route — Vercel kills them at 60s. Long work → Inngest function.
- Don't trust source content. Email/Slack/meeting transcripts are untrusted input. Never let extracted text become a prompt instruction (treat as data, not directive). Use the system-prompt-isolated extraction pattern in `lib/extract/granola.ts`.

## When in doubt

- Read `lib/types.ts` for the schema. Types are the source of truth in this codebase.
- Read `lib/diff.ts` to understand the engine.
- Read `inngest/functions/morning-digest.ts` to see how everything composes.
- Migrations live in `migrations/`. Never modify a migration that's been run; always create a new one.

## What you're building this week

**Week 1 only:** Granola connector + diff engine. No UI. No Gmail. No Slack. The success criteria is: the `items` table fills up after the first morning run, no duplicates on second run, and items vanish from source → status='completed' on day 2.

If the user asks for UI or other sources in Week 1, gently push back: "Let's verify the diff engine works in the Supabase dashboard before we layer rendering on top of it."

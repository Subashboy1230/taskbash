# Week 4 — Multi-user auth & per-user Connect

**Goal:** Turn ToDoo from "single hardcoded user" into a real multi-tenant product where any user signs up, connects their own Gmail/Granola/Slack, and gets their own digest. Side effect: unblocks Subash's work email and Slack OAuth (we control `user_scope` in code via the Nango SDK, no more dashboard-flow brittleness).

## Architecture decisions

These shape everything; flag any you want to change before we start.

- **Auth provider — Supabase Auth.** Already on Supabase, free tier is generous, JWT-based sessions work cleanly with Next.js server actions. Alternatives (Clerk, Auth.js) add cost or complexity for no real upside here.
- **Auth methods — Google SSO + email magic link.** Google SSO is the primary path (most users have Google, matches our OAuth-everywhere pattern). Magic link is the fallback for anyone who doesn't.
- **Per-user data — Row Level Security (RLS) on Supabase.** Every table (`items`, `runs`, `connections`, `agent_events`) gets a policy: `auth.uid() = user_id`. Database-enforced isolation; impossible to leak across users even if app code has a bug.
- **Per-user OAuth — Nango SDK in code.** Replace the dashboard "test connection" hack with the Nango Connect SDK in our app. We pass `authorization_params: { user_scope, login_hint }` directly, which solves Slack's bot-user problem and the work-email account-picker problem in one move.
- **Connections — already in schema.** `connections` table (from migration 001) and `Connection` interface in `lib/types.ts` exist but unused. Wire them up: each user's per-source OAuth connections live there, replacing the hardcoded env vars (`APP_NANGO_GMAIL_CONNECTION_ID`, etc.).
- **Morning digest — loops over users.** Currently runs for one hardcoded user. Becomes: query all users with active connections → for each, extract using their connections → diff/persist scoped to that user.
- **Subash's existing data — migrated to his auth user.** When you sign up for the first time with `subashraj411@gmail.com`, a migration script re-points your existing items from the hardcoded `00000000-…-0001` user_id to your real auth user_id. No data loss.

## Day-by-day breakdown

### Day 1 — Supabase Auth wired up
- Enable Auth in Supabase project (Google provider + email)
- Configure Google OAuth credentials (reuse the Google Cloud project we already have; add another OAuth client for app login)
- Install `@supabase/ssr` package for Next.js
- Build `lib/supabase-browser.ts` and `lib/supabase-server.ts` (client + server Supabase clients with auth)
- Build `/login` page — Google SSO button + magic link form
- Build `/auth/callback` route handler for the OAuth redirect
- Middleware to refresh session on every request
- `/today` becomes auth-gated — redirect to `/login` if no session

### Day 2 — Connections table + per-user reads
- Migration 003 — RLS policies on `items`, `runs`, `connections`, `agent_events` (`auth.uid() = user_id`)
- Update `lib/load-digest.ts` to take the auth user_id (no more hardcoded `APP_USER_ID`)
- Update server actions in `app/today/actions.ts` to scope to auth user_id
- Migration script: re-point Subash's existing items to his new auth user_id after first login

### Day 3 — Nango Connect UI for Gmail
- Add `@nangohq/frontend` package
- New page: `/connections` — lists this user's connections, shows "Connect Gmail" / "Granola" / "Slack" buttons
- Each button triggers Nango.auth() with provider-specific `authorization_params`
- On success, store the connection: `user_id, provider, nango_connection_id, scopes, status='active'` in the `connections` table
- Gmail extractor reads connection from DB (per user) instead of `APP_NANGO_GMAIL_CONNECTION_ID` env var

### Day 4 — Granola + Slack connections
- Granola: similar Connect button + DB record. Granola API key is per-workspace, so we'll either use Nango's Granola provider or a one-time API key paste UI.
- Slack: same pattern as Gmail but with `user_scope` in `authorization_params` — solves the bot-user problem cleanly. Same scopes we configured in the Slack app already.
- Slack extractor reads connection from DB.

### Day 5 — Multi-tenant morning digest
- Refactor `inngest/functions/morning-digest.ts` to loop over all users with active connections (instead of a single `APP_USER_ID`)
- For each user: load their connections, run their extractors, diff/persist scoped to their user_id
- One run row per user per cron tick, so the inspector shows per-user runs
- Update `inngest/client.ts` if needed for per-user event triggering

### Day 6 — Hardening
- Error isolation: one user's extraction failure must not break other users' runs
- Cost guardrails: per-user limits on Claude calls per run (e.g., max 50 conversations/extractions per user per day)
- Per-user rate limiting on the Nango proxy (avoid getting one user throttled by another's volume)
- Logging: tag every log line with `user_id` so we can debug per-user issues

### Day 7 — Polish & dogfood
- Connection-status indicators on `/today` ("Gmail connected ✓", "Slack disconnected" with reconnect button)
- Onboarding flow for first-time users: signup → connect first source → see digest
- Account settings page (sign out, disconnect a source, delete account)
- Dogfooding sweep — anything that feels off when you sign up fresh

## Migration strategy (Subash's existing data)

Order of operations on first deploy:
1. Day 1 ships: you log in for the first time with `subashraj411@gmail.com` via Google SSO → Supabase Auth creates your real user_id (let's call it `<new_uid>`)
2. Day 2 ships with a one-time migration script:
   ```sql
   UPDATE items SET user_id = '<new_uid>'
     WHERE user_id = '00000000-0000-0000-0000-000000000001';
   UPDATE runs SET user_id = '<new_uid>' WHERE user_id = '00000000-…-0001';
   -- same for agent_events
   ```
3. Existing connections (`APP_NANGO_GMAIL_CONNECTION_ID` env var → DB row): insert a row in `connections` table for your existing Gmail connection so it keeps working post-migration.
4. After migration succeeds, the hardcoded `APP_USER_ID` env var can be removed.

Risk: while migration runs, `/today` might briefly show no items (if you visit between SSO and migration). Mitigation: run the migration in the `/auth/callback` handler on first login.

## Risks & unknowns

- **Supabase Auth + RLS edge cases.** Server actions need to use the auth-aware Supabase client (not the service-role one for user-facing reads), or RLS won't apply. Easy to get wrong; we'll need a clear pattern.
- **Nango SDK frontend usage.** `@nangohq/frontend` runs in the browser and needs a "session token" minted on the server. Standard pattern but new code for us.
- **Slack OAuth still TBD.** Even with `user_scope` in `authorization_params`, sigiq.ai workspace might still require admin approval. If so, the fallback is having you install in a personal Slack workspace or asking your admin to allowlist the app.
- **Granola OAuth via Nango.** We've been calling Granola's direct API with a personal key. For multi-user, each user needs to authorize. Need to confirm Nango's Granola provider supports the OAuth flow we need (Granola Enterprise plan).
- **Cost.** Each user's daily digest = ~50–100 Claude calls. At Haiku/Sonnet prices, it's pennies per user per day, but with many users it adds up. Worth tracking from Day 6.

## Success criteria

- A new user can sign up from scratch, connect Gmail (and Granola and Slack), and see their first digest within 5 minutes of landing on the site.
- Subash's existing data is preserved through the migration — same items, same briefs.
- No user can see another user's items, even with a hand-crafted API call (RLS verified).
- Morning digest cron runs for all users without one user's failure affecting another.
- The Slack work-email connection works (one of the goals of this whole epic).

## What this unlocks for the product roadmap

- True dogfooding with teammates — sharing the URL actually works
- Future: pricing, billing (Stripe), per-plan limits
- Future: shared workspaces (multiple chiefs of staff on one team)
- Future: public launch when verified by Google

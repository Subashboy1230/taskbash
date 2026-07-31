# Agent Activity Panel — Handoff

Snapshot for the next agent. Goal: understand what changed, security-review it, and deploy.
Branch: `feat/hackathon-stack`. App: taskbash (`cos-app`), Next 15.5 + Supabase + Inngest.

---

## 1. Read this first (the one critical fact)

The **/today "Re-run tasks" button now plays a hardcoded DEMO MOCK**, not the real digest.

- `app/today/today-view.tsx` `handleRefresh()` calls `onRunStarted('mock')` — it does **not** call `requestRefresh()` anymore.
- `app/today/agent-activity-panel.tsx` LIVE mode plays a scripted, client-side sequence from `app/today/mock-run.ts` (60s, real tool logos, cycling sub-states, 3 round-robin variants). No backend, no LLM calls, no network.
- The **real** digest pipeline (`lib/digest/run.ts` `runDigestForUser`) still exists and is improved (see §4). It still runs on the 7am Inngest cron. Only the manual Re-run button was switched to the mock.
- **HISTORY mode is real**: the history icon (above the calendar) reads actual past `runs`/`run_steps` from the DB via the committed API route.

**Decision required before prod:** shipping as-is means Re-run is a mock for real users. Either keep it (this is a demo build) or revert to the real digest — see §7.

---

## 2. Git state (what's committed vs pending)

**Already committed on `feat/hackathon-stack`** (by the earlier sessions / the other Claude):
- `f4127d9` Add run-steps feature: API routes + actions + integration
- `229bd31` Add untracked files referenced by today-shell + digest run-steps
- `8629997` Mock `/workflows` page (separate demo work — not part of this feature)
- `bf3c635` Home page "AI Chief of Staff" badge + workflows framing (separate)

Committed files for THIS feature: `app/api/runs/[runId]/steps/route.ts`, `lib/load-run-steps.ts`,
`app/today/run-activity-actions.ts`, `lib/types.ts` (RunStep types), `app/today/actions.ts`
(`requestRefresh` returns a runId), `inngest/functions/morning-digest.ts` (runId threading),
`app/today/today-shell.tsx` + `app/today/today-calendar-column.tsx` (panel wiring + history icon),
`package.json` + lockfile (`react-is` build fix).

**Uncommitted (working tree) — the demo-mock pivot:**
- Modified: `app/today/agent-activity-panel.tsx`, `app/today/today-view.tsx`,
  `lib/digest/run.ts`, `lib/digest/run-steps.ts`
- New: `app/today/mock-run.ts`, `migrations/031_run_steps.sql`,
  `public/logo-{inngest,composio,mem0,anthropic,nebius,tavily}.png`, `SYNTHESIS.md`
- `scripts/export-items.ts` is pre-existing untracked — NOT part of this work.

`git diff` / `git status` to review. Run `git log --oneline origin/main..HEAD` for the full pending set.

---

## 3. Database

- `migrations/031_run_steps.sql` creates the `run_steps` table (RLS: users select own; service-role
  insert/update). **It is already APPLIED to the live Supabase DB** (run via the Management API this
  session), but the **migration file is uncommitted** — commit it for the record.
- During testing (before the mock pivot) the REAL digest ran a few times and **added real tasks** to
  `items` (open count grew ~200 → ~250+) and created real `runs`/`run_steps`. Non-destructive, but the
  owner may want to clear those test-added tasks. The history icon will show these real runs.

---

## 4. What changed in the real pipeline (`lib/digest/run.ts`, uncommitted)

These affect the **cron digest** too (not just the now-mock manual button):
- Sources (Granola/Gmail/Calendar/Linear/Slack) now run **in parallel** (`Promise.all`) instead of
  sequentially → faster, and one slow source can't block the others.
- **Per-source timeout = 90s** (`SOURCE_TIMEOUT_MS`): a source exceeding it is marked
  "took too long, skipped" so the run always completes. Note: parallel extraction = more concurrent
  Claude calls.
- `steps.finalize(...)` safety net flips any leftover "running" step to a terminal status at the end.
- `run_steps` emission throughout (start / per-source / classify / diff / done), best-effort (never
  blocks the digest). Emitter: `lib/digest/run-steps.ts`.

---

## 5. Environment / secrets

- `.env.local` currently has `APP_USER_ID` (owner-added) and `ANTHROPIC_API_KEY` + `MEM0_API_KEY`
  (restored from `.env.local.bak` after they went missing mid-session). Verify it's complete.
- Same keys must exist in **Vercel** for prod: `SUPABASE_*`, `ANTHROPIC_API_KEY`, `NANGO_*`,
  `GRANOLA_API_KEY`, `LINEAR_API_KEY`, `NEBIUS*`, `TAVILY*`, `COMPOSIO*`, `MEM0_API_KEY`,
  `INNGEST_*`, `LANGFUSE_*`. Confirm before deploy.

---

## 6. Build / deploy

- `npm run build` **passes** now. It was previously broken (unrelated) by `recharts` needing
  `react-is`; fixed by adding `react-is` (committed).
- Install with `npm install --legacy-peer-deps` (React 19 peer conflicts).
- Deploy flow (per `CLAUDE.md`): `feat/hackathon-stack` → `dev` (Vercel preview) → `main` (prod at
  taskbash.app). Migration 031 is already applied to the shared Supabase, so no DB step needed at
  deploy, but commit the file.
- A local dev server is running in the background on **localhost:3004** from this session — stop it;
  it's unrelated to deploy.

---

## 7. To revert Re-run to the REAL digest (if prod should not ship the mock)

1. `app/today/today-view.tsx` `handleRefresh()`: call `requestRefresh()` (committed in
   `app/today/actions.ts`), and on `{ ok, runId }` call `onRunStarted(runId)`.
2. `app/today/agent-activity-panel.tsx` LIVE mode: replace the `mock-run.ts` clock player with
   polling `GET /api/runs/{runId}/steps` until `run.status` is terminal (the pre-mock version of this
   file is in git history — `git show 229bd31:app/today/agent-activity-panel.tsx` or similar).
3. Real runs need the Inngest dev server locally (`npm run inngest`) or Inngest Cloud in prod.

Keeping the mock requires no change — just commit the working tree.

---

## 8. Security — review before deploy (recommend `/security-review`)

Found in an earlier audit of the broader codebase (most predate this feature, but relevant to ship):
1. **`resolveUserId()` fails open to `APP_USER_ID`** (`lib/supabase-server.ts`): with the
   RLS-bypassing service-role client, an unauthenticated request resolves to the seed user. Fine for
   single-user; a real risk for multi-tenant. The new `GET /api/runs/[runId]/steps` is scoped by
   `user_id` but inherits this fail-open.
2. **IDOR on `llm_calls`**: read by client-supplied id without `user_id` scoping on the service-role
   client — `app/observability/actions.ts` (`promoteCallToDataset`), `app/today/actions.ts`
   (`markItemSlop`), `app/settings/functions/actions.ts` (`setItemFunctions`).
3. **PostgREST `.or()` string interpolation** of `userId` in `lib/load-observability.ts`
   (filter-injection latent; safe while `userId` is a trusted UUID).

This feature's new code is low-risk: the API route is GET + user-scoped, `run_steps` has RLS, and
`mock-run.ts` is pure client data with no input.

Minor: the auth middleware matcher (`middleware.ts`) excludes `png/svg/jpg/...` from auth but NOT
`avif` — that's why the mem0 logo was converted to PNG. Add `avif` to the matcher if you add `.avif`
static assets.

---

## 9. Suggested order for the next agent

1. `git status` / `git diff` to see the uncommitted mock pivot.
2. Decide **mock vs. real** for prod (§1, §7).
3. `npm install --legacy-peer-deps && npm run build` — confirm clean.
4. Run `/security-review`; address items in §8 per single- vs multi-tenant intent.
5. Commit pending work (include `migrations/031_run_steps.sql`).
6. Verify Vercel env vars (§5).
7. Deploy per branch flow (§6).

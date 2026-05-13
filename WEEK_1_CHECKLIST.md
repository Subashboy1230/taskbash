# Week 1 Checklist — Day-by-Day

You're the only one who can do the account creation + OAuth flows. This checklist walks through each step so you can knock it out in ~2 focused half-days.

Mark each box `[x]` as you go.

---

## Day 1 — Accounts + database (~3 hours)

### Create accounts

- [ ] **Supabase** — sign up at [supabase.com](https://supabase.com). Create a new project. Pick the cheapest region close to you. Save the database password somewhere (you won't need it for this, but you will later).
- [ ] **Nango** — sign up at [nango.dev](https://nango.dev). Create an environment (default name is fine).
- [ ] **Inngest** — sign up at [inngest.com](https://inngest.com). Create an app called `cos-app`.
- [ ] **Anthropic** — if you don't already have it, sign up at [console.anthropic.com](https://console.anthropic.com). Generate an API key.
- [ ] **GitHub** — create a new private repo `cos-app` (you'll push code here today).
- [ ] **Vercel** — create an account if you don't have one. Don't deploy yet — just have the account ready.

### Pull this code into your repo

- [ ] Copy the contents of `cos-app-v1/` into a fresh local directory (call it `cos-app`).
- [ ] `cd cos-app && git init && git add . && git commit -m "Initial scaffold"`
- [ ] Add GitHub remote: `git remote add origin git@github.com:YOU/cos-app.git && git push -u origin main`

### Install + verify

- [ ] `npm install` — should complete with no errors.
- [ ] `npm run typecheck` — should pass with no errors.

### Run the Supabase migration

- [ ] Open your Supabase project → SQL editor → New query.
- [ ] Paste the entire contents of `migrations/001_mvp.sql`.
- [ ] **Edit the seed insert** (line ~21): change `subash@sigiq.ai` to your actual email if different. Keep the UUID for now.
- [ ] Run. Verify in **Table editor** that you see: `users` (1 row), `connections` (0), `items` (0), `runs` (0), `agent_events` (0).

### Fill in `.env.local`

- [ ] `cp .env.example .env.local`
- [ ] **Supabase**: project Settings → API → copy Project URL + service_role key + anon key. Paste into `.env.local`.
- [ ] **Anthropic**: paste your API key.
- [ ] **Inngest**: dashboard → Manage → Event Keys → create one. Dashboard → Manage → Signing Keys → create one. Paste both.
- [ ] **`APP_USER_ID`**: keep the default `00000000-0000-0000-0000-000000000001` for now.

You'll fill in **Nango** keys on Day 2.

---

## Day 2 — Nango + Granola (~2 hours)

### Set up Nango

- [ ] In Nango dashboard, go to **Environment Settings**.
- [ ] Copy the **Secret Key** → paste into `.env.local` as `NANGO_SECRET_KEY`.
- [ ] Go to **Integrations** → **+ New Integration** → search "Granola."
- [ ] **If Granola is listed**: configure with the OAuth credentials Granola gives you ([Granola developer settings](https://granola.ai)). Confirm the integration ID is `granola` or update `NANGO_GRANOLA_PROVIDER_KEY` in `.env.local` to match.
- [ ] **If Granola is NOT listed**: skip Nango for Granola — see "Fallback" below.

### Connect your Granola account

If you got the Nango integration working:

- [ ] In Nango dashboard → **Connect**, generate a connect link for the `granola` integration with `end_user_id = 00000000-0000-0000-0000-000000000001` (your APP_USER_ID).
- [ ] Open the link in a new tab → click through Granola OAuth.
- [ ] Back in Nango dashboard, you'll see a new connection. **Copy the connection ID**.
- [ ] Paste into `.env.local` as `APP_NANGO_GRANOLA_CONNECTION_ID`.
- [ ] Manually insert the connection row in Supabase SQL editor:
  ```sql
  insert into connections (user_id, provider, nango_connection_id, status)
  values (
    '00000000-0000-0000-0000-000000000001',
    'granola',
    'PASTE_NANGO_CONNECTION_ID_HERE',
    'active'
  );
  ```

### Fallback: Direct Granola API (only if Nango doesn't support Granola)

- [ ] Get a personal access token from Granola settings (web → settings → developer).
- [ ] Add to `.env.local`: `GRANOLA_PAT=...`
- [ ] In `lib/extract/granola.ts`, swap the `nangoProxy` call for a direct `fetch`:
  ```ts
  const res = await fetch('https://api.granola.so/meetings?since=' + since, {
    headers: { Authorization: `Bearer ${process.env.GRANOLA_PAT}` },
  })
  const data = await res.json()
  return { meetings: data.meetings }
  ```
- [ ] (Skip the Nango connection row insert above.)

### First run — manual

- [ ] Three terminals:
  - **Terminal 1**: `npm run dev` (Next.js)
  - **Terminal 2**: `npm run inngest` (Inngest dev server — UI at http://localhost:8288)
  - **Terminal 3**: `npm run test:diff` (manually trigger the digest)
- [ ] Open the Inngest dev UI at http://localhost:8288. Watch the `morning-digest` function execute step-by-step.
- [ ] If it succeeds, open Supabase → Table editor → `items`. You should see N rows from your last 7 days of Granola meetings.
- [ ] Check `runs` → one row, `status = 'succeeded'`, with counts.
- [ ] Check `agent_events` → at least 1–2 rows.

### Troubleshooting

- **Inngest function never fires**: check Terminal 2 is connected to your Next.js dev server (it auto-detects port 3000).
- **Granola fetch fails**: copy the actual error from the Inngest UI. If it's a 404, the endpoint shape is wrong — check Granola's actual API docs. If 401, the token isn't flowing.
- **Claude returns garbage**: check `lib/extract/granola.ts` — the prompt assumes Granola returns `summary` or `notes` fields. Inspect the raw response and adjust field names.

---

## Day 3 — Verify the diff actually works (~1 hour, next day)

### Re-run same-day (sanity check)

- [ ] Run `npm run test:diff` again, same day.
- [ ] In Inngest UI, the function should report `{ new: 0, carryover: N, completed: 0 }`. Verify in Supabase that `items` row count is unchanged — no duplicates created.

### Wait until tomorrow, then run again

- [ ] Tomorrow morning, mark one of yesterday's Granola meetings as deleted (or wait for the 7-day window to roll one off naturally).
- [ ] Run `npm run test:diff`.
- [ ] Expected: that meeting's items have `status = 'completed'` and `auto_completed_reason = 'source_signal_gone'`. Any new commitments from new meetings appear as new rows.

### Inspect agent_events

```sql
select kind, payload, occurred_at
from agent_events
where user_id = '00000000-0000-0000-0000-000000000001'
order by occurred_at desc
limit 20;
```

You should see a clear trail of `extract.completed`, `task.auto_completed`, etc.

---

## Done — what you have

A working diff engine that pulls Granola action items, dedupes against yesterday, surfaces new + completed, and persists everything durably. No UI yet, but the engine is sound.

Next: **Week 2** — Gmail + Slack connectors + the `/today` Next.js page.

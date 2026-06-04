# WhatsApp via Twilio — session handoff

**Session date:** 2026-06-01
**Branch:** main (committed + pushed + Vercel-deployed during the session)
**What shipped:** outbound WhatsApp morning digest + 10-minute pre-meeting reminders, end-to-end. Currently waiting on Meta approvals before the first real send.

---

## TL;DR for whoever picks this up

The plumbing is done. Code is live in prod. DB row is configured. Only thing standing between us and the first real WhatsApp message is **Meta approving 2 templates (~24-48h)** and **Meta approving the WhatsApp Business Sender (~1-3 days)**.

If you're being asked to fix something in the WhatsApp area, first check:

1. `whatsapp_messages_sent` table in Supabase — `status` column tells you whether sends succeeded, failed, or are pending. `error` column has the Twilio error message. Most common errors: `63016` (template not yet approved) and `21408` (no WhatsApp sender on the account).
2. Inngest dashboard for the user — look at runs of `whatsapp-morning-digest`, `whatsapp-meeting-scheduler`, `whatsapp-meeting-reminder`. The cron schedules are documented at the top of each function file.
3. Twilio Console → Messaging → Content Template Builder → check the WhatsApp `Approval status` on each of the two templates.
4. Twilio Console → Messaging → Senders → status of the WhatsApp sender for the configured From number.

---

## Files created or changed this session

### New code

```
migrations/030_whatsapp.sql
  → applied to production Supabase via Management API (HTTP 201 confirmed)
  → adds 7 columns to users + new table whatsapp_messages_sent

lib/whatsapp.ts
  → Twilio Content API wrapper. Idempotent on (user_id, dedup_key).
  → Quiet-hours helper (isInsideQuietHours).
  → Settings loader (getWhatsAppSettings).
  → Never throws — returns { ok, error } so callers can decide.

inngest/functions/whatsapp-morning-digest.ts
  → Hourly cron (0 * * * *). Per-user TZ + digest_time match in JS.
  → Builds 7-variable payload: first name, date, P0/P1/unread counts,
    next meeting today, top 3 tasks.
  → Honors quiet hours.

inngest/functions/whatsapp-meeting-scheduler.ts
  → */5 * * * *. Finds calendar items starting 9-11 min from now.
  → Fires whatsapp/meeting-reminder.requested event per meeting.
  → Idempotency check against whatsapp_messages_sent before firing.

inngest/functions/whatsapp-meeting-reminder.ts
  → Event-triggered. Loads meeting + items.brief.
  → 4 variables: title, time_range (12h with TZ abbrev), attendees, prep summary.
  → Strips markdown from brief before sending.

app/api/whatsapp/webhook/route.ts
  → Twilio inbound webhook. Verifies X-Twilio-Signature.
  → Handles STOP / START / HELP keywords per WhatsApp policy.
  → Status callback path updates whatsapp_messages_sent.status.

app/settings/whatsapp/page.tsx
app/settings/whatsapp/whatsapp-settings-form.tsx
app/settings/whatsapp/actions.ts
  → Settings UI. Phone (E.164), 2 toggles, digest time, quiet hours,
    timezone. Save / Send test digest / Disconnect actions.
  → Live at https://taskbash.app/settings/whatsapp (verified).

scripts/twilio-create-templates.js
  → One-off (now re-runnable). Idempotent template create + WhatsApp
    approval submission. Reads creds from .env.local, writes returned
    HX SIDs back into .env.local.
  → Has already run once this session — both templates exist on the
    Twilio account, both submitted for Meta approval.

docs/whatsapp-setup.md
  → Step-by-step runbook for the parts Claude couldn't do (Twilio account
    creation, Meta business verification, etc.). Still useful for diagnosing
    state in Twilio Console.
```

### Edits to existing files

```
inngest/client.ts
  → Added 2 events:
    whatsappMorningDigestRequested  = 'whatsapp/morning-digest.requested'
    whatsappMeetingReminderRequested = 'whatsapp/meeting-reminder.requested'

app/api/inngest/route.ts
  → Registered the 3 new functions:
    whatsappMorningDigest, whatsappMeetingScheduler, whatsappMeetingReminder

middleware.ts
  → Added /api/whatsapp/webhook to the public-routes list (Twilio webhook
    is verified by signature, not Supabase auth).

.env.example
  → Documented all 5 TWILIO_* vars + the optional TWILIO_MESSAGING_SERVICE_SID.
```

---

## State of the system right now

### What's live in production

- **Supabase:** all 7 user columns + `whatsapp_messages_sent` table exist.
- **Vercel:** code deployed. `/settings/whatsapp` renders. `/api/inngest` is alive (returns 401 to unauthenticated probes — that's Inngest's signed-auth behavior).
- **Vercel env vars:** the user pasted the 5 `TWILIO_*` vars into Production / Preview / Development. Confirmed.
- **DB row:** `public.users WHERE id = 'd470e729-29eb-41bb-8785-9dddedbe8597'` (subash@sigiq.ai) has:
  - `whatsapp_e164 = '+18608560798'`
  - `whatsapp_morning_digest_enabled = true`
  - `whatsapp_meeting_reminders_enabled = true`
  - `whatsapp_digest_time_local = '09:00'`
  - `whatsapp_quiet_before = '06:30'`
  - `whatsapp_quiet_after = '22:00'`
  - `timezone = 'America/Los_Angeles'`
  - `whatsapp_consent_at = 2026-06-01 08:22:18 UTC`

### What's pending (external)

- **Meta template approval (24-48h)**. Both templates submitted, status `received`.
  - `taskbash_morning_digest` → `HX71725bb4afca22155e4bbf5e7c56ac4b`
  - `taskbash_meeting_reminder` → `HXafbcd478804d2ad90e71e085670b2256`
- **Meta + Twilio WhatsApp Sender approval (1-3 days)**. The user has a Twilio-owned phone number `+18555108812` ready for WhatsApp registration, but the Senders list is currently empty (no approved WhatsApp sender). `TWILIO_WHATSAPP_FROM` in env is set to `whatsapp:+18555108812` in anticipation — when approval lands, no code change needed.

### What's not yet done (will need a real fix when sender approval lands)

- **Webhook URL on the WhatsApp sender** in Twilio. Can't set it via API until the sender exists. Once the sender is approved, the easiest path is:
  ```sh
  curl -X POST -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
    https://messaging.twilio.com/v2/Channels/Senders/<SENDER_SID> \
    -d "Webhook.Callback.Url=https://taskbash.app/api/whatsapp/webhook" \
    -d "Webhook.Callback.Method=POST"
  ```
  (Or do it in Twilio Console → Senders → click your sender → set webhook URL.)

---

## Behavior details worth knowing

- **Idempotency** is hard-enforced by the `(user_id, dedup_key)` unique index on `whatsapp_messages_sent`. Re-triggering the same morning digest or the same meeting reminder is a no-op. Dedup keys are `morning_digest:<YYYY-MM-DD>` and `meeting_reminder:<item_id>`.

- **Quiet hours wrap midnight.** `whatsapp_quiet_before = '06:30'` and `whatsapp_quiet_after = '22:00'` means "do not send between 22:00 and 06:30." See `isInsideQuietHours()` in `lib/whatsapp.ts` for the exact formula.

- **Per-user timezone** is resolved inside the cron, not at cron-schedule time. The cron fires every hour (UTC), and the function decides per user whether the current local hour matches their `whatsapp_digest_time_local`. This lets us support any digest time + any timezone without re-registering crons.

- **The scheduler uses a 9-11 minute window** (cron runs every 5 min). Idempotency guarantees overlapping windows don't duplicate. If you change the schedule frequency, adjust the window in `whatsapp-meeting-scheduler.ts`.

- **Template variables are positional** (`{{1}}`, `{{2}}`, …). The Twilio template's variable indices MUST match what the Inngest function passes in `variables`. If you edit a template's body to add/remove a variable, you also have to update the corresponding `buildDigestVariables()` or `whatsappMeetingReminder` code.

- **Webhook signature verification** is strict on the URL. The `NEXT_PUBLIC_APP_URL` env var has to be set to the exact URL Twilio is POSTing to (`https://taskbash.app/api/whatsapp/webhook`), trailing slash matters. If Twilio webhooks come back with 403, that's the first thing to check.

---

## Latent bug to fix while you're in the area (carried over from Round 4 QA)

In `lib/digest/run.ts`, the subtask insert added in commit `dd6595b` sets `parent_id` correctly but **does not set `role: 'subtask' as const`**. The column defaults to `'top'`, so new subtasks land with `role='top'` while their `parent_id` is non-null. The load path (`load-digest.ts`) filters by `parent_id IS NULL`, so the bug is latent today, but any future query filtering by `role='top'` will accidentally include subtasks. One-line fix: add `role: 'subtask' as const` to the `subInserts` map.

---

## Open work that's specced but not started

Both docs are in `docs/`:

- `docs/cursor-fix-instructions.md` — 25-block master plan for the still-open Round 1-3 QA bugs (hydration #418, HTML entity leak, subtask duplication on SpendHound, etc.) plus all 16 UI inconsistencies (chip primitive, TaskCard unification, source naming map, date format library, etc.). Each block is independent and ordered by impact.
- `docs/ui-consistency-audit.md` — the source data for the UI portions of the fix plan. Has screenshots + DOM measurements.
- `docs/qa-round4-delta.md` — status snapshot of which Round 1-3 bugs were fixed by recent commits and which are still open.
- `docs/whatsapp-setup.md` — Twilio-side runbook (account creation, template submission, etc.). The template submission step is now done.

---

## What to ping the user about

- **When the WhatsApp sender is approved**, set the webhook URL (curl command above), then trigger a test digest via the `/settings/whatsapp` page button (or `inngest.send({ name: 'whatsapp/morning-digest.requested' })`).
- **When templates are approved**, no code action needed. The next cron tick will succeed instead of erroring `63016`.
- **If you read whatsapp_messages_sent and see error column populated**, surface the value as-is. The Twilio error code is the diagnostic.

---

## TypeScript / build status at session end

- `tsc --noEmit` exit 0.
- No em-dashes in any UI string or AI prompt (em-dash ban from task #115 still respected).
- No raw Tailwind color classes (`bg-green-400` etc.) in the new code — uses design tokens.
- Inline `text-[Npx]` sizes used in `whatsapp-settings-form.tsx` follow the existing pattern in this codebase. If you ship the Chip primitive (Block 3 in `cursor-fix-instructions.md`), retrofit those size literals too.

— Claude, end of WhatsApp session

# WhatsApp setup runbook

Everything Claude couldn't do for you — the bits that require entering your phone, payment info, or business identity into someone else's site.

## Step 1 — Apply migration 030

```sh
psql "$DATABASE_URL" -f migrations/030_whatsapp.sql
```

Or via Supabase Studio: paste the contents of `migrations/030_whatsapp.sql` into the SQL editor and run.

Verify:

```sh
psql "$DATABASE_URL" -c "\\d users" | grep whatsapp
psql "$DATABASE_URL" -c "\\d whatsapp_messages_sent"
```

## Step 2 — Create Twilio account + WhatsApp sender

1. Sign up at https://twilio.com (free, no card needed for the first $15 trial credit).
2. Top-up at least $20 once you're past the trial — required for WhatsApp production messages.
3. Console → Messaging → Senders → "New WhatsApp sender."
4. Pick **"Use my own WhatsApp Business Account"** if you have one, otherwise **"Connect via embedded signup"** — Meta will walk you through creating a Meta Business account and verifying your phone number for WhatsApp.
5. The business profile name is what shows in WhatsApp. Use **"taskbash"**.
6. Submit. Approval typically takes 1-3 business days.

While that's in review, do Step 3 in parallel.

## Step 3 — Submit two message templates

Templates are how WhatsApp lets you send proactive messages. Each template gets reviewed by Meta. Approval window: 24-48 hours.

In Twilio Console → Messaging → Content Template Builder:

### Template 1: `morning_digest`

- **Friendly name:** `morning_digest`
- **Category:** UTILITY
- **Language:** English (en)
- **Body:**

```
☀️ {{1}}, your {{2}} digest

{{3}} P0 · {{4}} P1 · {{5}} unread

Next: {{6}}

Top:
{{7}}

Open: taskbash.app/today
```

- **Sample values** (for Meta review):
  - {{1}}: `Subash`
  - {{2}}: `Mon Jun 1`
  - {{3}}: `2`
  - {{4}}: `5`
  - {{5}}: `4`
  - {{6}}: `9:00 AM Sigiq.ai x NationGraph`
  - {{7}}: `1) Discuss SpendHound. 2) Set up EverTutor. 3) Reply to Karttikeya.`

### Template 2: `meeting_reminder`

- **Friendly name:** `meeting_reminder`
- **Category:** UTILITY
- **Language:** English (en)
- **Body:**

```
⏰ In 10 min: {{1}}

{{2}}

With: {{3}}

Prep: {{4}}
```

- **Sample values:**
  - {{1}}: `Sigiq.ai x NationGraph`
  - {{2}}: `9:00 - 9:30 AM PT`
  - {{3}}: `luke@nationgraph.com, josh@nationgraph.com`
  - {{4}}: `NationGraph is pitching their gov sales intel platform. Aim: evaluate fit for EdTech vertical. They have prior touchpoints with two SigIQ customers.`

Submit both. While Meta reviews, copy the Content SIDs (start with `HX`) — you'll need them in Step 5.

## Step 4 — Configure webhook in Twilio

In Twilio Console → Messaging → Senders → your WhatsApp sender:

- **Webhook URL for incoming messages:** `https://taskbash.app/api/whatsapp/webhook`
- **Status callback URL:** same URL
- **Method:** POST

Save.

## Step 5 — Add env vars

In `.env.local` AND in Vercel production env:

```
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+1XXXXXXXXXX

# After template approval (Step 3) — paste the Content SIDs here
TWILIO_TEMPLATE_MORNING_DIGEST_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TEMPLATE_MEETING_REMINDER_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional — if you use a Messaging Service, takes precedence over From
# TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Already set probably, but the webhook signature check needs this
NEXT_PUBLIC_APP_URL=https://taskbash.app
```

Restart `npm run dev`. Redeploy to Vercel.

## Step 6 — Opt in via the app

1. Go to https://taskbash.app/settings/whatsapp
2. Enter your phone in E.164: `+14155551234` (with `+` and country code)
3. Toggle both **Morning digest** and **Meeting reminders** on
4. Confirm digest time is 09:00 and timezone is `America/Los_Angeles`
5. Save

## Step 7 — Smoke test

Click **Send test digest** in the settings UI. You should receive the morning digest on your WhatsApp within ~30 seconds.

If nothing arrives:

```sh
# Inngest dashboard (or local CLI): check if the function ran
# Supabase: did a row land in whatsapp_messages_sent?
psql "$DATABASE_URL" -c "select id, kind, status, error, sent_at from whatsapp_messages_sent order by sent_at desc limit 5"
```

Common failures:

| Symptom | Fix |
|---|---|
| `error: Twilio env missing` | Check all 4 TWILIO_* vars are set in the running process |
| `error: 63016` (template not approved) | Wait for Meta. Status is in Twilio Content Template Builder. |
| `error: 63007` (number not on WhatsApp) | The recipient phone doesn't have WhatsApp. Use a different number. |
| `error: 21408` (perm denied) | Your Twilio account / sender isn't approved for WhatsApp yet. Check Senders. |
| Webhook 403 in Twilio logs | `TWILIO_AUTH_TOKEN` mismatch, or `NEXT_PUBLIC_APP_URL` wrong (signature is over the full URL). |

## Step 8 — Watch the first morning digest

Around 9 AM PT tomorrow, the cron fires. You should get the digest within a minute or so.

Check `whatsapp_messages_sent`:

```sh
psql "$DATABASE_URL" -c "select id, kind, dedup_key, status, sent_at from whatsapp_messages_sent order by sent_at desc limit 10"
```

For meeting reminders: every 5 minutes, the scheduler looks ahead 9-11 minutes. If you have a calendar event in that window and reminders are on, you should get a ping ~10 minutes out.

## Cost watch

At your volume (~9 messages/day) you'll spend roughly $0.10-0.20/day on WhatsApp utility messages plus Twilio platform fees. Set a billing alert at $20/mo in Twilio Console → Billing → Usage → Alerts to catch any runaway.

## Privacy update

`docs/privacy-policy.md` or `app/privacy/page.tsx` should mention:

- We use Twilio and Meta (WhatsApp) as subprocessors to deliver WhatsApp messages.
- Outbound message content includes meeting titles, attendee names, and prep brief summaries.
- Users may opt out at any time via /settings/whatsapp or by replying STOP.

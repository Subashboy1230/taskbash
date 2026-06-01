-- WhatsApp notifications via Twilio.
--
-- Two outbound message types:
--   1. Morning digest (daily cron)
--   2. 10-minute pre-meeting reminder (event-triggered)
--
-- Both require Meta-approved templates submitted via Twilio Content API,
-- so the variable shape is fixed. Per-user opt-in + quiet hours enforced
-- inside the Inngest functions before sendTemplate is called.

-- ── Per-user settings ────────────────────────────────────────────────
alter table users add column if not exists whatsapp_e164 text;
  -- E.164 format with + prefix, e.g. '+14155551234'
alter table users add column if not exists whatsapp_consent_at timestamptz;
  -- Set when user opts in via /settings/whatsapp. Required by WhatsApp policy
  -- before we may send any template message. NULL = never opted in.
alter table users add column if not exists whatsapp_morning_digest_enabled boolean default false;
alter table users add column if not exists whatsapp_meeting_reminders_enabled boolean default false;
alter table users add column if not exists whatsapp_digest_time_local text default '09:00';
  -- 24h HH:MM in the user's local timezone. Cron resolves the per-user TZ
  -- and only fires for users whose digest time matches the current hour.
alter table users add column if not exists whatsapp_quiet_before text default '06:30';
alter table users add column if not exists whatsapp_quiet_after text default '22:00';
alter table users add column if not exists timezone text default 'America/Los_Angeles';
  -- IANA timezone. Used for digest-time matching and quiet-hours enforcement.

comment on column users.whatsapp_e164 is
  'WhatsApp phone in E.164 format (e.g. +14155551234). NULL = no WhatsApp configured.';
comment on column users.whatsapp_consent_at is
  'Timestamp when the user opted into WhatsApp messaging. WhatsApp policy requires opt-in before any outbound template.';
comment on column users.whatsapp_digest_time_local is
  '24h HH:MM in users.timezone. Cron fires per hour; users whose digest_time matches the current local hour get sent.';

-- ── Reminder log (idempotency + audit) ───────────────────────────────
-- Prevents duplicate sends across cron runs, Inngest retries, and crashes.
-- Unique (user_id, dedup_key) means re-firing the same morning digest or
-- the same meeting reminder a second time is a no-op.
create table if not exists whatsapp_messages_sent (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null,            -- 'morning_digest' | 'meeting_reminder'
  dedup_key       text not null,            -- 'morning_digest:2026-06-01' or 'meeting_reminder:<event_id>'
  template_name   text not null,            -- which Meta template was used
  template_sid    text,                     -- Twilio Content SID actually sent
  twilio_message_sid text,                  -- Twilio Message SID returned on success
  variables       jsonb not null default '{}'::jsonb,
  sent_at         timestamptz not null default now(),
  status          text not null default 'queued', -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  error           text,
  unique (user_id, dedup_key)
);

create index if not exists whatsapp_messages_sent_user_idx on whatsapp_messages_sent(user_id, sent_at desc);
create index if not exists whatsapp_messages_sent_kind_idx on whatsapp_messages_sent(kind, sent_at desc);

alter table whatsapp_messages_sent enable row level security;
create policy "users see own whatsapp logs"
  on whatsapp_messages_sent for select
  using (auth.uid() = user_id);
-- No insert/update/delete policy. Background jobs use the service-role
-- client which bypasses RLS; users never write to this table directly.

comment on table whatsapp_messages_sent is
  'One row per outbound WhatsApp template send. Unique on (user_id, dedup_key) prevents duplicates from Inngest retries and overlapping cron runs.';

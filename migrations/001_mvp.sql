-- ============================================================
-- Migration 001 — MVP schema for the diff engine.
-- Run this in Supabase SQL editor on a fresh project.
--
-- Scope: just what the morning-digest needs.
--   Deferred to later migrations:
--     - briefs / brief generation columns
--     - workflows + prompts tables
--     - pgvector embedding + semantic dedupe
--     - source_cache (will add when we add Gmail/Slack)
--     - RLS policies (will add when we flip to multi-user)
-- ============================================================

-- ---------- users ----------
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  created_at  timestamptz default now(),
  settings    jsonb default '{}'::jsonb
);

-- Seed YOU as the only user. Update the UUID + email to match yours.
insert into users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'subash@sigiq.ai')
on conflict (id) do nothing;

-- ---------- connections ----------
-- One row per (user, provider) OAuth grant. Tokens live in Nango, not here.
create table if not exists connections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references users(id) not null,
  provider             text not null,        -- 'granola' | 'gmail' | 'slack' (future)
  nango_connection_id  text not null,        -- the ID Nango gives you after OAuth
  status               text default 'active', -- 'active' | 'expired' | 'error'
  scopes               text[],
  last_sync_at         timestamptz,
  created_at           timestamptz default now(),
  unique (user_id, provider)
);

create index if not exists idx_connections_user
  on connections (user_id, status);

-- ---------- items ----------
-- The whole product lives here. Tasks + their lifecycle.
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) not null,

  -- WHAT IT IS
  title           text not null,
  task_type       text not null,    -- 'research' | 'context_prep' | 'review' | 'follow_up' | 'post_call' | 'manual'
  tag             text,             -- from Subash's workflow: 'action' | 'reply' | 'commit' | 'fyi' | null
  parent_context  text,             -- meeting title, email thread subject, etc.

  -- STATE
  status          text default 'open',  -- 'open' | 'in_progress' | 'snoozed' | 'completed' | 'dismissed'
  priority        text,             -- 'P0' | 'P1' | 'P2' | 'P3' | null
  due_at          timestamptz,
  snooze_until    timestamptz,
  completed_at    timestamptz,
  urgent          bool default false,

  -- ORIGIN
  source          text not null,    -- 'granola' | 'gmail' | 'slack' | 'manual'
  source_ref      jsonb default '{}'::jsonb,
  -- examples:
  --   { "granola_meeting_id": "...", "granola_meeting_date": "..." }
  --   { "gmail_thread_id": "...", "gmail_message_id": "..." }
  --   { "slack_channel_id": "...", "slack_ts": "..." }

  parent_id       uuid references items(id) on delete cascade,  -- for sub-tasks

  -- DEDUPE
  semantic_hash   text not null,    -- sha256(source + normalized parent_context + normalized title), first 16 chars

  -- HOUSEKEEPING
  first_seen_at   timestamptz default now(),
  last_seen_at    timestamptz default now(),
  age_days        int generated always as
                    (extract(day from (now() - first_seen_at))::int) stored,
  auto_completed_reason text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- The dedupe key. Same (user, source, parent, title) won't create duplicates.
create unique index if not exists uniq_items_semantic
  on items (user_id, semantic_hash);

-- Home feed query
create index if not exists idx_items_open_feed
  on items (user_id, status, priority, due_at, first_seen_at)
  where status in ('open', 'in_progress');

-- Sub-tasks lookup
create index if not exists idx_items_parent
  on items (parent_id)
  where parent_id is not null;

-- "What's still alive in source?" — used by diff
create index if not exists idx_items_last_seen
  on items (user_id, source, last_seen_at);

-- ---------- runs ----------
-- One row per morning-digest execution. Lets you see history + debug.
create table if not exists runs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references users(id) not null,
  started_at        timestamptz default now(),
  completed_at     timestamptz,
  trigger           text not null,    -- 'cron' | 'manual'
  sources_run       text[],           -- which extractors ran in this digest
  fresh_count       int default 0,    -- items returned by extractors total
  new_count         int default 0,
  carryover_count   int default 0,
  completed_count   int default 0,    -- items auto-completed by diff
  status            text default 'running',  -- 'running' | 'succeeded' | 'failed'
  error_message     text
);

create index if not exists idx_runs_user_started
  on runs (user_id, started_at desc);

-- ---------- agent_events ----------
-- Debug + audit log. Every interesting decision the agent makes.
create table if not exists agent_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) not null,
  item_id      uuid references items(id) on delete set null,
  run_id       uuid references runs(id) on delete set null,
  kind         text not null,
  -- 'task.created' | 'task.carried_over' | 'task.auto_completed'
  -- | 'extract.started' | 'extract.completed' | 'extract.failed'
  -- | 'dedupe.matched' | 'classifier.tagged'
  payload      jsonb default '{}'::jsonb,
  occurred_at  timestamptz default now()
);

create index if not exists idx_events_user_occurred
  on agent_events (user_id, occurred_at desc);
create index if not exists idx_events_kind
  on agent_events (kind, occurred_at desc);

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_items_updated_at on items;
create trigger trg_items_updated_at
  before update on items
  for each row execute function set_updated_at();

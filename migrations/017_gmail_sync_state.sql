-- 017: Gmail incremental sync state for real-time polling
create table if not exists gmail_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_history_id text,
  last_polled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

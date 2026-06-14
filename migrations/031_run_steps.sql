-- 031_run_steps.sql
-- run_steps: ordered, user-facing step events for a single digest run.
--
-- Written best-effort by runDigestForUser as the pipeline progresses
-- (start -> per-source extraction -> classify -> diff/persist -> done).
-- A step is inserted as 'running' and later updated to 'done' | 'skipped'
-- | 'failed'. Read by the Agent Activity panel (polled while a run is in
-- flight) and by run history. Additive only; a failed write never blocks
-- the digest.

create table if not exists run_steps (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references runs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  seq          int not null,            -- monotonic order within a run
  phase        text not null,           -- start | source | classify | diff | finalize | done | error
  source       text,                    -- granola | gmail | calendar | linear | slack | null
  label        text not null,           -- friendly, user-facing line
  status       text not null default 'running',  -- running | done | skipped | failed
  detail       jsonb,                   -- { model?, prompt_id?, prompt_version?, tool?, note? }
  item_count   int,                     -- items found / added, when relevant
  started_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists run_steps_run_seq_idx on run_steps(run_id, seq);
create index if not exists run_steps_user_idx on run_steps(user_id);

alter table run_steps enable row level security;

create policy "users read own run steps"
  on run_steps for select
  using (auth.uid() = user_id);

create policy "service role write run steps"
  on run_steps for insert
  with check (true);

create policy "service role update run steps"
  on run_steps for update
  using (true);

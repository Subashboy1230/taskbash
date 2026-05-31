-- task_events: one row per item lifecycle transition
-- Powers the Tasks tab on /activity

create table if not exists task_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references items(id) on delete cascade,
  kind       text not null,  -- created | completed | dismissed | snoozed | unsnoozed | slop
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_events_user_created_idx on task_events(user_id, created_at desc);
create index if not exists task_events_item_idx on task_events(item_id);

alter table task_events enable row level security;
create policy "users read own task events"
  on task_events for select
  using (auth.uid() = user_id);
create policy "service role write task events"
  on task_events for insert
  with check (true);

-- Backfill from existing items
insert into task_events (user_id, item_id, kind, created_at)
select user_id, id, 'created', created_at from items
on conflict do nothing;

insert into task_events (user_id, item_id, kind, created_at)
select user_id, id, 'completed', completed_at
from items where status = 'completed' and completed_at is not null
on conflict do nothing;

insert into task_events (user_id, item_id, kind, created_at)
select user_id, id, 'dismissed', updated_at
from items where status = 'dismissed'
on conflict do nothing;

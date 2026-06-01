-- Add explicit role marker to items so top-level tasks and subtasks are
-- distinguishable without joining on parent_id IS NULL.
-- parent_id already exists (migration 001) as the self-referential FK.

alter table items
  add column if not exists role text not null default 'top'
    check (role in ('top', 'subtask'));

create index if not exists items_role_idx on items(role)
  where role = 'subtask';

comment on column items.role is
  'top = visible in /today top-level list. subtask = nested under parent_id, never shown standalone.';

-- Backfill: rows that already have parent_id set are subtasks.
update items set role = 'subtask' where parent_id is not null and role = 'top';

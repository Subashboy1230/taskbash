-- Migration 012 — User-defined functions for grouping cross-source work.
--
-- The user (Subash) splits his day across Product, Marketing, People Ops,
-- QA, Hiring etc. Items already carry source + tag + priority, but those
-- describe *where the item came from* and *what kind of work it is at a
-- low level*. Function is the user's MENTAL BUCKETING dimension:
--
--   "Show me only people-ops tasks today."
--   "Group my Open list by function."
--
-- Many-to-many on purpose — a single task ("interview Sam for senior PM")
-- can belong to both Hiring and Product Management. We use a uuid[] column
-- on items rather than a join table because:
--   - Small per-user cardinality (≤30 functions ever)
--   - GIN index on uuid[] gives fast `function_ids && '{f1,f2}'` queries
--   - One less table to maintain

-- ─── user_functions ─────────────────────────────────────────────────
create table if not exists public.user_functions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  -- Optional 6-char hex color for the chip ('#7B68EE'). When null we
  -- pick a deterministic hash-based color in the UI.
  color       text,
  -- Lower numbers sort first in chip rows and group sections. Defaults
  -- to created order via a trigger below.
  sort_order  integer not null default 1000,
  created_at  timestamptz not null default now(),
  -- Soft delete — keeps existing items.function_ids references valid
  -- while making the function invisible in the UI.
  deleted_at  timestamptz,
  unique (user_id, name)
);

create index if not exists idx_user_functions_owner
  on public.user_functions (user_id, sort_order)
  where deleted_at is null;

-- ─── items.function_ids ────────────────────────────────────────────
-- Many-to-many via array. Use array-contains operators for filters:
--   .contains('function_ids', [funcId])
--   .overlaps('function_ids', [funcId1, funcId2])
alter table public.items
  add column if not exists function_ids uuid[] default '{}'::uuid[];

-- GIN index for fast filter queries by function.
create index if not exists idx_items_function_ids
  on public.items using gin (function_ids);

-- ─── RLS ────────────────────────────────────────────────────────────
alter table public.user_functions enable row level security;

drop policy if exists user_functions_owner on public.user_functions;
create policy user_functions_owner on public.user_functions
  for all using (auth.uid() = user_id);

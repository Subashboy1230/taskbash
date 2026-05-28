-- ============================================================
-- Migration 004 — Multi-user auth foundation.
--
-- Wires Supabase Auth into our schema:
--   1. public.users.id now references auth.users(id) — the auth provider
--      becomes the source of truth for who exists.
--   2. RLS policies on items, connections, runs, agent_events scope every
--      row to its owning user. Once enabled, the existing service-role
--      Supabase client we use server-side bypasses RLS (good — it represents
--      "trusted server code"), but any anon/authenticated client will only
--      see their own rows.
--   3. A trigger auto-inserts into public.users whenever someone signs up
--      via auth.users, so we never have a profile-row missing case.
--
-- Run this in Supabase SQL editor AFTER enabling Google OAuth provider in
-- Authentication → Providers.
-- ============================================================

-- ─── 1. Link public.users.id to auth.users.id ──────────────────────────
--
-- The existing seed user has id 00000000-0000-0000-0000-000000000001 — Subash.
-- We need that row to keep pointing at his real data until he signs in via
-- Google; then a one-off migration script updates user_id on all his rows to
-- his new auth.users.id. For now, just add the FK constraint loosely (no
-- cascade — we don't want to delete a user's data if they delete their
-- auth row).
--
-- Drop the existing default first (gen_random_uuid()) so new rows MUST
-- come from auth, then add the FK.

alter table public.users
  alter column id drop default;

-- FK to auth.users is deferred. The existing seed user (Subash) has no
-- matching auth.users row yet, so adding the FK now fails validation.
-- Run scripts/migrate-subash-to-auth.ts AFTER Subash signs in via Google
-- (it updates user_id on all his rows to his new auth.users.id and then
-- adds the FK with full validation). For now the trigger below ensures
-- new signups always create a matching public.users row.

-- Per-user settings columns (timezone for digest scheduling, display name).
alter table public.users
  add column if not exists timezone text default 'America/Los_Angeles',
  add column if not exists full_name text;

-- ─── 2. Auto-create public.users row on auth signup ────────────────────
--
-- Supabase Auth puts new signups in auth.users; we mirror them into
-- public.users so the rest of the app can use a single users table.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ─── 3. Enable RLS + scoped policies ───────────────────────────────────
--
-- Each table gets RLS turned on plus a single policy: rows are visible /
-- mutable only if user_id matches the current auth.uid().
--
-- Our server code uses the service-role key, which BYPASSES RLS by design
-- (so the morning-digest can write items for any user, the auth callback
-- can insert into users, etc.). RLS only kicks in for anon/authenticated
-- clients — relevant if/when we add a browser-side query path.

alter table public.users        enable row level security;
alter table public.items        enable row level security;
alter table public.connections  enable row level security;
alter table public.runs         enable row level security;
alter table public.agent_events enable row level security;

-- users: each authenticated user can see/update their own profile row.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (auth.uid() = id);

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (auth.uid() = id);

-- items: each user sees/writes only their own.
drop policy if exists items_owner_all on public.items;
create policy items_owner_all on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- connections: same.
drop policy if exists connections_owner_all on public.connections;
create policy connections_owner_all on public.connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- runs: same.
drop policy if exists runs_owner_all on public.runs;
create policy runs_owner_all on public.runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- agent_events: same.
drop policy if exists agent_events_owner_all on public.agent_events;
create policy agent_events_owner_all on public.agent_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

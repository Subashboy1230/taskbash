-- ============================================================
-- Migration 007 — Migrate Subash's existing data from the hardcoded seed
-- user_id (00000000-0000-0000-0000-000000000001) to his real auth.users.id
-- (d470e729-29eb-41bb-8785-9dddedbe8597).
--
-- Why: when Subash signed in via Google, auth.users gave him a new id, but
-- migration 005's trigger uses `on conflict do nothing` — so his
-- public.users row never got created (the seed row's email collided). This
-- migration:
--   1. Renames the seed row's email so the new insert doesn't conflict
--   2. Inserts (or updates) the public.users row keyed by auth.users.id,
--      carrying over communication_style (Soul) from the seed row
--   3. Repoints every items / connections / runs / agent_events row to
--      the new id
--   4. Deletes the seed row
--
-- Idempotent: re-running after success is a no-op.
--
-- AFTER running this in Supabase, update APP_USER_ID in your .env.local
-- (and Vercel) to the new id so Inngest jobs and scripts keep finding
-- Subash's data via the resolveUserId() fallback path.
-- ============================================================

do $$
declare
  old_id constant uuid := '00000000-0000-0000-0000-000000000001';
  new_id constant uuid := 'd470e729-29eb-41bb-8785-9dddedbe8597';
  carry_soul text;
  carry_settings jsonb;
begin
  -- Nothing to do if the seed row is already gone.
  if not exists (select 1 from public.users where id = old_id) then
    raise notice 'Seed user % already migrated, skipping.', old_id;
    return;
  end if;

  -- Stash data we want to keep.
  select communication_style, settings
    into carry_soul, carry_settings
    from public.users where id = old_id;

  -- Rename the seed row's email so the new insert doesn't collide with
  -- the unique constraint on public.users.email.
  update public.users
    set email = 'archived-' || id::text || '@local'
    where id = old_id;

  -- Create or update the row for the real auth user, carrying Soul over.
  insert into public.users (id, email, timezone, communication_style, settings)
  values (
    new_id,
    'subash@sigiq.ai',
    'America/Los_Angeles',
    carry_soul,
    coalesce(carry_settings, '{}'::jsonb)
  )
  on conflict (id) do update
    set communication_style = excluded.communication_style,
        settings            = excluded.settings;

  -- Move all foreign-key references.
  update public.items        set user_id = new_id where user_id = old_id;
  update public.connections  set user_id = new_id where user_id = old_id;
  update public.runs         set user_id = new_id where user_id = old_id;
  update public.agent_events set user_id = new_id where user_id = old_id;

  -- Drop the seed row.
  delete from public.users where id = old_id;

  raise notice 'Migrated data from % to %', old_id, new_id;
end $$;

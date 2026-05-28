-- ============================================================
-- Migration 005 — Fix handle_new_auth_user trigger so it doesn't
-- block Supabase Auth signup when an existing public.users row
-- collides on either id OR email.
--
-- Cause: the seed row has email 'subash@sigiq.ai'. When Subash signs in
-- with that same email via Google, the trigger's INSERT into public.users
-- hits the email UNIQUE constraint. The previous `on conflict (id) do
-- nothing` only handled id collisions, so the email collision raised
-- "Database error saving new user" and Supabase rolled back the signup.
--
-- Fix: `on conflict do nothing` (no target) covers any unique violation,
-- AND wrap in EXCEPTION ... WHEN OTHERS so any other failure (constraint,
-- privilege, etc.) doesn't take down auth signup.
-- ============================================================

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
  on conflict do nothing;
  return new;
exception when others then
  -- Never block auth signup just because we couldn't mirror the row.
  -- The auth user still gets created; the public profile can be
  -- backfilled later by a one-off script.
  return new;
end;
$$;

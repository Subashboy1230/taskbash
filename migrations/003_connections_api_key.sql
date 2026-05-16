-- Week 4 Option B — connections become the source of truth for OAuth + API
-- credentials, replacing hardcoded env vars.

-- Add api_key column for API-key auth providers (Granola). For OAuth providers
-- (Gmail, Slack) this stays null and nango_connection_id is used instead.
-- Note: stored in plain text for now (single-user). Encrypt at app-layer
-- before going multi-user / public.
alter table connections
  add column if not exists api_key text;

-- nango_connection_id can be empty for API-key providers — make it nullable.
alter table connections
  alter column nango_connection_id drop not null;

-- Seed Subash's existing Gmail connection (the nango_connection_id is the
-- value previously in APP_NANGO_GMAIL_CONNECTION_ID env var).
insert into connections (user_id, provider, nango_connection_id, status)
values (
  '00000000-0000-0000-0000-000000000001',
  'gmail',
  '85b85275-0b47-4546-a53e-ac7efe4cbf69',
  'active'
)
on conflict (user_id, provider) do nothing;

-- Granola gets seeded by scripts/seed-connections.ts (it pulls the API key
-- from .env.local — secrets don't belong in SQL files).

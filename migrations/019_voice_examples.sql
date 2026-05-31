alter table users add column if not exists voice_examples jsonb;
alter table users add column if not exists voice_updated_at timestamptz;

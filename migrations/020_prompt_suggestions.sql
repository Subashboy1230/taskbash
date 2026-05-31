create table if not exists prompt_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  prompt_id text not null,
  prompt_version integer not null,
  suggestion text not null,
  outcome text,
  status text not null default 'open',
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now()
);
create index if not exists prompt_suggestions_user_id_idx on prompt_suggestions(user_id);
create index if not exists prompt_suggestions_prompt_id_idx on prompt_suggestions(prompt_id);
alter table prompt_suggestions enable row level security;
create policy if not exists "users insert own suggestions" on prompt_suggestions for insert with check (auth.uid() = user_id);
create policy if not exists "users read own suggestions" on prompt_suggestions for select using (auth.uid() = user_id);

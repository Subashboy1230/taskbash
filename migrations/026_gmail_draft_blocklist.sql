create table if not exists gmail_draft_blocklist (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  pattern           text not null,
  pattern_kind      text not null,  -- 'email' | 'domain'
  added_from_item_id uuid references items(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (user_id, pattern)
);

create index if not exists gmail_draft_blocklist_user_idx
  on gmail_draft_blocklist(user_id);

alter table gmail_draft_blocklist enable row level security;
create policy "users manage own blocklist"
  on gmail_draft_blocklist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

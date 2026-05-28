-- Migration 008 — Feedback signal for LLM training.
--
-- Every time the user clicks "Slop" (or another feedback verdict) on an
-- item, we write a row here capturing the FULL item snapshot at the
-- moment of feedback. That gives us a clean training corpus for the
-- extraction prompts:
--
--   "Here's an email body + extracted item + the user said 'irrelevant'.
--    Rewrite the extraction prompt so it would have skipped this."
--
-- We use a separate table (not a JSONB column on items) so:
--   1. Feedback persists even if the item is later deleted
--   2. We can capture multiple feedback rounds per item (e.g. user fixes
--      the tag then later marks it irrelevant)
--   3. Training-data export is a single `select * from item_feedback`
--
-- Also adds extraction_meta to items so future extractors can persist
-- the model + prompt version + raw response that produced each row.

-- ─── item_feedback ──────────────────────────────────────────────────
create table if not exists public.item_feedback (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  user_id     uuid not null,

  -- The verdict. 'slop' = shouldn't have been extracted at all.
  -- Other kinds reserved for future use (wrong tag, wrong urgency, good).
  kind        text not null check (kind in ('slop', 'wrong_tag', 'wrong_urgency', 'duplicate', 'good')),

  -- Optional category for slop verdicts.
  -- 'irrelevant' | 'spam' | 'low_signal' | 'misread_title' | 'other'
  reason      text,

  -- Optional free-text note ("This is a marketing blast we never want")
  note        text,

  -- Snapshot of the item at the moment of feedback. The item itself may
  -- change (status, completed_at, etc.) but the training signal stays
  -- anchored to what the user actually saw and rejected.
  item_snapshot jsonb not null,

  created_at  timestamptz not null default now()
);

create index if not exists idx_item_feedback_user_kind
  on public.item_feedback (user_id, kind, created_at desc);
create index if not exists idx_item_feedback_item
  on public.item_feedback (item_id);

-- ─── extraction_meta on items ──────────────────────────────────────
-- JSONB so extractors can dump anything useful for prompt iteration:
--   {
--     "model": "claude-haiku-4-5",
--     "prompt_id": "gmail_extract_v3",
--     "prompt_version": 3,
--     "extracted_at": "2026-05-28T07:00:00Z",
--     "input_tokens": 1240,
--     "output_tokens": 90,
--     "full_source_content": "... the entire email body, untruncated ..."
--   }
alter table public.items
  add column if not exists extraction_meta jsonb;

create index if not exists idx_items_extraction_meta_model
  on public.items ((extraction_meta->>'model'))
  where extraction_meta is not null;

-- ─── RLS for item_feedback ─────────────────────────────────────────
alter table public.item_feedback enable row level security;

drop policy if exists item_feedback_owner_select on public.item_feedback;
create policy item_feedback_owner_select on public.item_feedback
  for select using (auth.uid() = user_id);

drop policy if exists item_feedback_owner_insert on public.item_feedback;
create policy item_feedback_owner_insert on public.item_feedback
  for insert with check (auth.uid() = user_id);

-- Allow the service-role key (used by the extractors / training scripts)
-- to bypass RLS naturally — service role bypasses RLS by default in
-- Supabase, so no explicit policy needed.

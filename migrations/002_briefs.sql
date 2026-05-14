-- ============================================================
-- Migration 002 — the brief (the differentiator).
-- Each task gets a synthesized Why/Know/Done/Next brief, stored as jsonb.
-- Run this in Supabase SQL editor after 001_mvp.sql.
-- ============================================================

alter table items
  add column if not exists brief jsonb,
  add column if not exists brief_generated_at timestamptz,
  add column if not exists brief_status text default 'pending';

-- brief jsonb shape:
--   { "why": "...", "know": ["...", "..."], "done": "...", "next": "..." }
-- brief_status: 'pending' (no brief yet) | 'generated' | 'failed'

-- Index for "which items still need briefs" lookups
create index if not exists idx_items_brief_status
  on items (user_id, brief_status)
  where brief_status = 'pending';

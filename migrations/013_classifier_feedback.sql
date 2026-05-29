-- Migration 013 — RL feedback loop for the function classifier (and
-- future classifiers).
--
-- The Slop button captures negative signal for EXTRACTORS:
--   "This shouldn't have been extracted at all."
--
-- For the function classifier we need a different shape of feedback:
--   "You said this task belongs to no functions. I disagree — add Hiring."
--   "You said it's Marketing. Wrong — it's Product."
--
-- These are CORRECTIONS, not slop. We pipe them into the same
-- item_feedback table (kind='wrong_tag') but with two structural adds:
--
--   1. correction jsonb       — clean before/after the user's edit
--   2. classifier_call_id     — already covered by llm_call_id; we just
--      need each item to KNOW which classify.functions call produced
--      its tags so setItemFunctions can find the right call to attach
--      feedback to. Stored on items.extraction_meta.classify_call_id
--      (no schema change — extraction_meta is jsonb).

alter table public.item_feedback
  add column if not exists correction jsonb;

-- Helpful when querying "show me every function-tag correction"
create index if not exists idx_item_feedback_correction_kind
  on public.item_feedback (kind)
  where kind in ('wrong_tag', 'wrong_urgency') and correction is not null;

-- 018: Add description column to items for AI-generated task summaries.
-- Separate from parent_context (source metadata) and source_excerpt (raw content).
alter table items add column if not exists description text;

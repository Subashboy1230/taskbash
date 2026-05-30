-- 014: per-item manual sort order for drag-to-reorder on /today
-- Uses float8 so we can insert between any two items without renumbering
-- (same approach as Figma/Linear). Default null = not manually ordered;
-- those items fall back to the existing priority/due_at sort.

alter table items
  add column if not exists sort_order float8 default null;

-- Index so load-digest ORDER BY sort_order is fast
create index if not exists idx_items_sort_order
  on items (user_id, sort_order)
  where sort_order is not null;

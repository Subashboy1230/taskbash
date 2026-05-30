alter table items add column if not exists reply_outcome text;
-- 'approved' | 'rejected' | 'completed' | null

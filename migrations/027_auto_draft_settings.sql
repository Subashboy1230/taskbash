alter table users add column if not exists auto_draft_enabled boolean default true;
alter table users add column if not exists auto_draft_borderline boolean default false;

comment on column users.auto_draft_enabled is
  'Whether the agent should pre-create Gmail drafts on extraction.';
comment on column users.auto_draft_borderline is
  'When true, also drafts for borderline (medium-confidence) replies.';

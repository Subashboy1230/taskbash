alter table items add column if not exists gmail_draft_id text;
alter table items add column if not exists draft_confidence text;
alter table items add column if not exists draft_expired_at timestamptz;

create index if not exists items_gmail_draft_idx
  on items(gmail_draft_id) where gmail_draft_id is not null;

comment on column items.gmail_draft_id is
  'Gmail Draft resource id. Used by sendDraft() via drafts.send and by dismiss to delete.';
comment on column items.draft_confidence is
  'Extractor-emitted confidence the email warranted a pre-written reply: high | medium | low | skip';
comment on column items.draft_expired_at is
  'Set when the Gmail draft was auto-deleted after 14 days of inactivity.';

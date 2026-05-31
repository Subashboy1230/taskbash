-- Add sources_failed column to runs for the Data Sources tab
alter table runs add column if not exists sources_failed text[] default '{}'::text[];
comment on column runs.sources_failed is
  'Sources that were attempted but threw an error during this run.';

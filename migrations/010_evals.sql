-- Migration 010 — Eval datasets.
--
-- Closes the OTHER half of the eval loop that item_feedback opened:
--
--   item_feedback (slop)  →  "don't extract things like this"
--   eval_datasets         →  "preserve quality on cases like this"
--
-- The workflow:
--
--   1. After a morning digest, /observability shows the recent calls
--   2. For a call that produced exactly the output you wanted, click
--      Promote → adds it to a dataset as a "gold case"
--   3. Slop signals auto-promote into the dataset as `slop_negative`
--      cases (expected_output = '' — the prompt should produce nothing)
--   4. Before shipping a prompt change, run `npm run eval -- --dataset X`
--   5. Get a pass/fail count: "v4 passes 42/47 gold cases, regression
--      on 2 cases" — green light or red flag before deploy

-- ─── eval_datasets — a named bundle of cases for a prompt_id ─────────
create table if not exists public.eval_datasets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  name        text not null,
  -- Which extractor/draft prompt these cases test. Matches the
  -- llm_calls.prompt_id values: 'extract.gmail', 'draft.reply', etc.
  prompt_id   text not null,
  description text,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

-- ─── eval_cases — individual input/expected pairs ────────────────────
create table if not exists public.eval_cases (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      uuid not null references public.eval_datasets(id) on delete cascade,
  -- Where did this case come from?
  --   'promoted_from_trace' — user clicked Promote on a real LLM call
  --   'manual'              — hand-authored (future: a /evals page editor)
  --   'slop_negative'       — auto-generated from a slop signal
  source          text not null default 'promoted_from_trace'
                    check (source in ('promoted_from_trace', 'manual', 'slop_negative')),
  -- Link back to the producing call, when applicable.
  source_llm_call_id uuid,
  source_feedback_id uuid,
  -- The full Anthropic request to replay. The eval runner sends this
  -- as-is to anthropic.messages.create.
  request_payload jsonb not null,
  -- What we expect to come back. Compared against the response text per
  -- expected_behavior:
  --   'exact'         — string-equal (after trim)
  --   'contains'      — expected substring appears in output
  --   'empty'         — output is empty / no items extracted (slop case)
  --   'manual_review' — score by hand; runner just records the output
  expected_output text,
  expected_behavior text not null default 'exact'
                    check (expected_behavior in ('exact', 'contains', 'empty', 'manual_review')),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_eval_cases_dataset
  on public.eval_cases (dataset_id);

-- ─── eval_runs — one row per `npm run eval -- --dataset X` invocation ─
create table if not exists public.eval_runs (
  id              uuid primary key default gen_random_uuid(),
  dataset_id      uuid not null references public.eval_datasets(id) on delete cascade,
  -- What the runner saw in the codebase at run time. Lets you compare
  -- pass rate across prompt versions over time.
  prompt_id       text not null,
  prompt_version  integer,
  model           text,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  total           integer not null default 0,
  passed          integer not null default 0,
  failed          integer not null default 0,
  errored         integer not null default 0,
  -- Optional human note attached to the run ("after rewording the
  -- system prompt to be more conservative")
  notes           text
);

create index if not exists idx_eval_runs_dataset_started
  on public.eval_runs (dataset_id, started_at desc);

-- ─── eval_case_results — per-case outcomes for a run ────────────────
create table if not exists public.eval_case_results (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.eval_runs(id) on delete cascade,
  case_id     uuid not null references public.eval_cases(id) on delete cascade,
  output      text,
  passed      boolean not null,
  -- Compact diff snippet shown in the CLI summary for failed cases.
  diff        text,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_eval_case_results_run
  on public.eval_case_results (run_id);
create index if not exists idx_eval_case_results_case
  on public.eval_case_results (case_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.eval_datasets enable row level security;
alter table public.eval_cases enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_case_results enable row level security;

drop policy if exists eval_datasets_owner on public.eval_datasets;
create policy eval_datasets_owner on public.eval_datasets
  for all using (auth.uid() = user_id);

-- Children inherit ownership via dataset_id.
drop policy if exists eval_cases_owner on public.eval_cases;
create policy eval_cases_owner on public.eval_cases
  for select using (
    exists (
      select 1 from public.eval_datasets d
      where d.id = dataset_id and d.user_id = auth.uid()
    )
  );

drop policy if exists eval_runs_owner on public.eval_runs;
create policy eval_runs_owner on public.eval_runs
  for select using (
    exists (
      select 1 from public.eval_datasets d
      where d.id = dataset_id and d.user_id = auth.uid()
    )
  );

drop policy if exists eval_case_results_owner on public.eval_case_results;
create policy eval_case_results_owner on public.eval_case_results
  for select using (
    exists (
      select 1
      from public.eval_runs r
      join public.eval_datasets d on d.id = r.dataset_id
      where r.id = run_id and d.user_id = auth.uid()
    )
  );

-- Inserts / updates come from the service role (the runner + the
-- promote action), which bypasses RLS by default.

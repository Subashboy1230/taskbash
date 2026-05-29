-- Migration 009 — LLM call observability.
--
-- Every call to Claude (Anthropic) lands a row here. Schema follows the
-- OpenTelemetry GenAI semantic conventions
-- (https://opentelemetry.io/docs/specs/semconv/gen-ai/) so the data is
-- portable to other observability tools (Langfuse, LangSmith, OTel
-- collectors) later without a remap.
--
-- The "operation" + "prompt_id" + "prompt_version" axes give us per-
-- prompt-version slop rate, cost regression detection, and prompt A/B
-- testing — the table of stakes for Phase 1.

create table if not exists public.llm_calls (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid,            -- nullable: extractors run for one user
                                       -- but background scripts may run system-wide

  -- ─── OpenTelemetry GenAI: required attributes ────────────────────
  -- gen_ai.system: the provider — 'anthropic' always for now
  system              text not null default 'anthropic',
  -- gen_ai.operation.name: 'chat' for messages.create, 'embedding' future
  operation           text not null default 'chat',
  -- gen_ai.request.model: what model we asked for
  request_model       text not null,
  -- gen_ai.response.model: what the API said it actually used
  response_model      text,
  -- gen_ai.response.id: provider-side trace handle
  response_id         text,
  -- gen_ai.response.finish_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error'
  finish_reason       text,

  -- ─── Token + cost accounting ─────────────────────────────────────
  -- gen_ai.usage.input_tokens / .output_tokens
  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,   -- prompt-caching savings tracking
  cache_creation_tokens integer,
  -- Computed cost in USD (caller fills in based on model pricing)
  cost_usd            numeric(10, 6),

  -- ─── Timing ──────────────────────────────────────────────────────
  started_at          timestamptz not null,
  ended_at            timestamptz not null,
  latency_ms          integer generated always as (
    extract(milliseconds from (ended_at - started_at))::integer
  ) stored,

  -- ─── Application-side context — why this call happened ───────────
  -- Which surface area triggered this call. Use these to bucket slop
  -- rate per source.
  --   'extract.gmail' | 'extract.granola' | 'extract.calendar' |
  --   'extract.linear' | 'extract.slack' | 'draft.reply' |
  --   'draft.followup' | 'classify.tag' | 'brief.synthesize' |
  --   'soul.analyze' | 'other'
  prompt_id           text not null,
  -- Bump prompt_version when the prompt template changes so we can
  -- compare slop rate across versions.
  prompt_version      integer not null default 1,

  -- ─── Full payload for replay / debugging ─────────────────────────
  -- request: { messages, system, temperature, max_tokens, ... }
  request_payload     jsonb,
  -- response: full Anthropic SDK return object
  response_payload    jsonb,
  -- The parsed string output (saves a jsonpath in dashboards)
  response_text       text,

  -- ─── Links to the rest of the world ──────────────────────────────
  -- If this call produced one or more items, link them. Many-to-one
  -- because a single extractor call typically yields multiple items.
  -- We don't FK-enforce so a deleted item doesn't cascade-delete the
  -- training trace.
  parent_run_id       uuid,            -- runs.id for the morning digest
  produced_item_ids   uuid[],          -- items this call created/updated
  source_ref          jsonb,           -- copy of items.source_ref for one-shot joins
  error               text,            -- if the call failed

  created_at          timestamptz not null default now()
);

-- Hot paths for the /observability page.
create index if not exists idx_llm_calls_user_created
  on public.llm_calls (user_id, created_at desc);
create index if not exists idx_llm_calls_prompt
  on public.llm_calls (prompt_id, prompt_version, created_at desc);
create index if not exists idx_llm_calls_finish_reason
  on public.llm_calls (finish_reason)
  where finish_reason is not null and finish_reason <> 'end_turn';

-- For slop-rate joins: link a feedback row back to the call that
-- produced the slopped item, so we can compute slop_rate per prompt_id +
-- prompt_version with one query.
alter table public.item_feedback
  add column if not exists llm_call_id uuid;

create index if not exists idx_item_feedback_llm_call
  on public.item_feedback (llm_call_id)
  where llm_call_id is not null;

-- ─── RLS ─────────────────────────────────────────────────────────────
-- Owner-only read; service-role bypasses for the extractor.
alter table public.llm_calls enable row level security;

drop policy if exists llm_calls_owner_select on public.llm_calls;
create policy llm_calls_owner_select on public.llm_calls
  for select using (
    user_id is null  -- system-wide rows (background jobs) — owner-less
    or auth.uid() = user_id
  );

-- Inserts only come from the service role (extractors), which bypasses
-- RLS by default — no explicit insert policy needed.

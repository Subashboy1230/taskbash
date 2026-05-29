-- Migration 011 — Structured input_content for true prompt regression evals.
--
-- The Phase B1 eval runner replays request_payload as-is. That tests
-- model behavior on a fixed prompt, but NOT a new prompt against old
-- cases — the prompt is baked into the saved request.
--
-- B2 adds input_content: the STRUCTURED input that produced the
-- request, separate from the full Anthropic payload. With it:
--
--   - lib/eval/replay.ts can dispatch by prompt_id to a per-extractor
--     replay function
--   - The replay function takes input_content + uses whatever prompt
--     template is in the codebase RIGHT NOW
--   - Pass rate drop from v1 → v2 of a prompt tells you exactly which
--     gold cases the v2 rewrite broke
--
-- Example shapes (per prompt_id):
--   extract.gmail:    {subject, userEmail, latestFrom, transcript}
--   extract.granola:  {meetingTitle, meetingDate, userEmail, sourceText, attendeeEmails}
--   extract.calendar: {userEmail, eventText}

alter table public.llm_calls
  add column if not exists input_content jsonb;

alter table public.eval_cases
  add column if not exists input_content jsonb;

-- For per-prompt queries that need both.
create index if not exists idx_llm_calls_prompt_input
  on public.llm_calls (prompt_id)
  where input_content is not null;

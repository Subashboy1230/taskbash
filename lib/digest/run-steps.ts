// Best-effort writer for run_steps — the ordered, user-facing progress
// events behind the Agent Activity panel. Every method swallows its own
// errors: surfacing progress must never break the digest.
//
// Steps are emitted sequentially within a run (sources extract one after
// another in runDigestForUser), so a plain in-memory counter gives stable
// ordering without a round-trip to read the current max seq.

import { supabase } from '../supabase'
import type {
  RunStepDetail,
  RunStepPhase,
  RunStepStatus,
  Source,
} from '../types'

export interface RunStepEmitter {
  /** Insert a 'running' step; returns its id (or null on failure / no run). */
  start(args: {
    phase: RunStepPhase
    label: string
    source?: Source | null
    detail?: RunStepDetail
  }): Promise<string | null>
  /** Transition a step started with start() to a terminal status. */
  finish(
    stepId: string | null,
    args: {
      status: RunStepStatus
      label?: string
      itemCount?: number | null
      detail?: RunStepDetail
    }
  ): Promise<void>
  /** Insert an already-terminal (or instant) step in one shot. */
  log(args: {
    phase: RunStepPhase
    label: string
    status?: RunStepStatus
    source?: Source | null
    detail?: RunStepDetail
    itemCount?: number | null
  }): Promise<void>
}

const NOOP: RunStepEmitter = {
  async start() {
    return null
  },
  async finish() {},
  async log() {},
}

export function createRunStepEmitter(
  runId: string | null,
  userId: string
): RunStepEmitter {
  if (!runId) return NOOP
  let seq = 0
  return {
    async start({ phase, label, source = null, detail }) {
      try {
        const { data } = await supabase
          .from('run_steps')
          .insert({
            run_id: runId,
            user_id: userId,
            seq: seq++,
            phase,
            source,
            label,
            status: 'running',
            detail: detail ?? null,
          })
          .select('id')
          .single()
        return (data?.id as string | undefined) ?? null
      } catch {
        return null
      }
    },
    async finish(stepId, { status, label, itemCount, detail }) {
      if (!stepId) return
      try {
        const update: Record<string, unknown> = {
          status,
          completed_at: new Date().toISOString(),
        }
        if (label !== undefined) update.label = label
        if (itemCount !== undefined) update.item_count = itemCount
        if (detail !== undefined) update.detail = detail
        await supabase.from('run_steps').update(update).eq('id', stepId)
      } catch {
        /* best-effort */
      }
    },
    async log({ phase, label, status = 'done', source = null, detail, itemCount }) {
      try {
        await supabase.from('run_steps').insert({
          run_id: runId,
          user_id: userId,
          seq: seq++,
          phase,
          source,
          label,
          status,
          detail: detail ?? null,
          item_count: itemCount ?? null,
          completed_at: status === 'running' ? null : new Date().toISOString(),
        })
      } catch {
        /* best-effort */
      }
    },
  }
}

// Friendly, non-technical copy for each source, plus the technical detail
// shown behind the Details toggle in the panel.
export const SOURCE_STEP: Record<
  Exclude<Source, 'manual'>,
  { running: string; tool: string; detail: RunStepDetail }
> = {
  granola: {
    running: 'Reading your meeting notes',
    tool: 'Granola',
    detail: { tool: 'Granola API + Claude Haiku', prompt_id: 'extract.granola' },
  },
  gmail: {
    running: 'Scanning your inbox',
    tool: 'Gmail',
    detail: { tool: 'Gmail (via Nango) + Claude Haiku', prompt_id: 'extract.gmail' },
  },
  calendar: {
    running: 'Checking your calendar',
    tool: 'Google Calendar',
    detail: { tool: 'Google Calendar (via Nango) + Claude', prompt_id: 'prep.meeting' },
  },
  linear: {
    running: 'Looking through your Linear issues',
    tool: 'Linear',
    detail: { tool: 'Linear GraphQL', note: 'Filtered directly, no AI step' },
  },
  slack: {
    running: 'Catching up on your Slack mentions',
    tool: 'Slack',
    detail: { tool: 'Slack (via Composio)', note: 'Searched mentions, no AI step' },
  },
}

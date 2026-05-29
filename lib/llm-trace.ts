// LLM call tracing — every Anthropic messages.create round-trip writes a
// row to public.llm_calls. Follows OpenTelemetry GenAI semantic
// conventions so the data is portable to Langfuse / OTel collectors
// later.
//
// Usage:
//
//   import { tracedMessage } from '@/lib/llm-trace'
//
//   const res = await tracedMessage(anthropic, {
//     prompt_id: 'extract.gmail',
//     prompt_version: 3,
//     user_id: userId,
//     parent_run_id: runId,
//     source_ref: { gmail_thread_id: '…' },
//     request: {
//       model: 'claude-haiku-4-5-20251001',
//       max_tokens: 1024,
//       system: '…',
//       messages: [{ role: 'user', content: '…' }],
//     },
//   })
//
// On success, the tracedMessage returns the Anthropic response untouched.
// Logging happens in the background — a logging failure never blocks the
// caller. The returned response also carries `_llmCallId` so the caller
// can link items / feedback back to the call.

import type Anthropic from '@anthropic-ai/sdk'
import type { Messages } from '@anthropic-ai/sdk/resources/messages'
import { supabase } from './supabase'

// Anthropic pricing (USD per 1M tokens). Keep in sync with
// https://www.anthropic.com/pricing.
// Used to compute cost_usd at log time so dashboards don't have to do
// the conversion. Unknown models fall back to 0 cost (logged, ignored).
const PRICING: Record<string, { input: number; output: number; cache_read?: number; cache_write?: number }> = {
  // Claude 4.5 / 4.6 family — May 2026 pricing
  'claude-opus-4-6':                  { input: 15,    output: 75,   cache_read: 1.5,  cache_write: 18.75 },
  'claude-sonnet-4-6':                { input: 3,     output: 15,   cache_read: 0.30, cache_write: 3.75 },
  'claude-haiku-4-5':                 { input: 0.80,  output: 4,    cache_read: 0.08, cache_write: 1.00 },
  'claude-haiku-4-5-20251001':        { input: 0.80,  output: 4,    cache_read: 0.08, cache_write: 1.00 },
}

function computeCost(model: string, input: number, output: number, cache_read = 0, cache_write = 0): number {
  const p = PRICING[model]
  if (!p) return 0
  const inputCost = (input / 1_000_000) * p.input
  const outputCost = (output / 1_000_000) * p.output
  const cacheReadCost = (cache_read / 1_000_000) * (p.cache_read ?? p.input)
  const cacheWriteCost = (cache_write / 1_000_000) * (p.cache_write ?? p.input)
  return Number((inputCost + outputCost + cacheReadCost + cacheWriteCost).toFixed(6))
}

export interface TraceContext {
  prompt_id: string
  prompt_version?: number
  user_id?: string | null
  parent_run_id?: string | null
  source_ref?: unknown
}

export type TracedResponse<T> = T & { _llmCallId: string }

/**
 * Drop-in wrapper for anthropic.messages.create that persists a trace
 * row. Returns the Anthropic response with a `_llmCallId` field added so
 * the caller can link items / feedback back to it.
 *
 * Logging never blocks: if the trace insert fails, we console.error and
 * still return the response.
 */
export async function tracedMessage(
  anthropic: Anthropic,
  ctx: TraceContext,
  request: Messages.MessageCreateParamsNonStreaming
): Promise<TracedResponse<Messages.Message>> {
  const startedAt = new Date()
  let response: Messages.Message | undefined
  let errorMessage: string | null = null
  try {
    response = await anthropic.messages.create(request)
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const endedAt = new Date()
    // Fire-and-forget the trace insert. Don't await — logging mustn't
    // add latency to the caller's response path.
    void logCall({
      ctx,
      request,
      response,
      startedAt,
      endedAt,
      errorMessage,
    })
  }
  // The finally block schedules logging; here we just attach the id we
  // know we'll have once the insert completes. The id is generated
  // client-side so it's available synchronously without a round-trip.
  const callId = (response as unknown as { _llmCallId?: string })?._llmCallId
  return { ...(response as Messages.Message), _llmCallId: callId ?? '' } as TracedResponse<Messages.Message>
}

async function logCall(args: {
  ctx: TraceContext
  request: Messages.MessageCreateParamsNonStreaming
  response?: Messages.Message
  startedAt: Date
  endedAt: Date
  errorMessage: string | null
}) {
  try {
    const { ctx, request, response, startedAt, endedAt, errorMessage } = args
    const usage = response?.usage
    const input = usage?.input_tokens ?? 0
    const output = usage?.output_tokens ?? 0
    const cacheRead = (usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0
    const cacheCreate = (usage as { cache_creation_input_tokens?: number } | undefined)?.cache_creation_input_tokens ?? 0
    const cost = computeCost(request.model, input, output, cacheRead, cacheCreate)

    // Extract the text part of the response for dashboards (saves a
    // jsonpath dig in queries).
    let responseText: string | null = null
    if (response?.content) {
      const textBlock = response.content.find(c => c.type === 'text') as { text?: string } | undefined
      responseText = textBlock?.text ?? null
    }

    const { data, error } = await supabase
      .from('llm_calls')
      .insert({
        user_id: ctx.user_id ?? null,
        system: 'anthropic',
        operation: 'chat',
        request_model: request.model,
        response_model: response?.model ?? null,
        response_id: response?.id ?? null,
        finish_reason: errorMessage ? 'error' : (response?.stop_reason ?? null),
        input_tokens: input || null,
        output_tokens: output || null,
        cache_read_tokens: cacheRead || null,
        cache_creation_tokens: cacheCreate || null,
        cost_usd: cost,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        prompt_id: ctx.prompt_id,
        prompt_version: ctx.prompt_version ?? 1,
        request_payload: request as unknown as object,
        response_payload: response as unknown as object,
        response_text: responseText,
        parent_run_id: ctx.parent_run_id ?? null,
        produced_item_ids: null,
        source_ref: ctx.source_ref ?? null,
        error: errorMessage,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[llm-trace] failed to log call:', error.message)
      return
    }
    // Tag the response object so the caller can grab the id sync. This
    // is a tiny hack — the response is already returned but JS objects
    // are passed by reference so the mutation is visible.
    if (response && data?.id) {
      ;(response as unknown as { _llmCallId?: string })._llmCallId = data.id
    }
  } catch (err) {
    // Logging failure is never fatal.
    console.error('[llm-trace] unexpected log error:', err instanceof Error ? err.message : err)
  }
}

/**
 * Attach a list of produced item ids to a previously-logged call.
 * Called by extractors after they've upserted the items they extracted.
 */
export async function tagCallWithItems(callId: string, itemIds: string[]) {
  if (!callId || itemIds.length === 0) return
  const { error } = await supabase
    .from('llm_calls')
    .update({ produced_item_ids: itemIds })
    .eq('id', callId)
  if (error) {
    console.error('[llm-trace] tagCallWithItems failed:', error.message)
  }
}

/**
 * Link a slop-feedback row back to the LLM call that produced the
 * slopped item. Called from markItemSlop so the feedback corpus joins
 * cleanly to llm_calls for per-prompt-version slop rate.
 */
export async function linkFeedbackToCall(feedbackId: string, callId: string) {
  if (!feedbackId || !callId) return
  const { error } = await supabase
    .from('item_feedback')
    .update({ llm_call_id: callId })
    .eq('id', feedbackId)
  if (error) {
    console.error('[llm-trace] linkFeedbackToCall failed:', error.message)
  }
}

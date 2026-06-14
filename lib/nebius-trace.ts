// Nebius Token Factory wrapper.
//
// Mirrors the surface of tracedMessage() so the classifier can swap
// providers via an env flag without restructuring its code.
//
// Nebius Token Factory exposes an OpenAI-compatible API at
// https://api.studio.nebius.ai/v1, so we use the `openai` SDK with a
// custom baseURL. The wrapper returns a "fake Anthropic" response
// shape (only `content` and `_llmCallId` populated) so downstream
// code that parses the Anthropic content array keeps working.
//
// Linkage invariant: the call id is client-generated up front (same
// pattern Cursor's tracedMessage fix uses) so items.extraction_meta.
// llm_call_id and produced_item_ids never come back empty.

import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { supabase } from './supabase'
import type { TraceContext } from './llm-trace'

const NEBIUS_BASE_URL =
  process.env.NEBIUS_BASE_URL || 'https://api.studio.nebius.ai/v1'

// Nebius retired Meta-Llama-3.1-70B-Instruct. Llama 3.3 70B is the
// current default Llama instruct model on Token Factory (verified via
// GET /models on 2026-06-11).
const NEBIUS_DEFAULT_MODEL =
  process.env.NEBIUS_DEFAULT_MODEL ||
  'meta-llama/Llama-3.3-70B-Instruct'

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.NEBIUS_API_KEY
  if (!apiKey) {
    throw new Error('NEBIUS_API_KEY missing. Set it in .env.local to use the Nebius path.')
  }
  _client = new OpenAI({ apiKey, baseURL: NEBIUS_BASE_URL })
  return _client
}

// Subset of Anthropic Messages.MessageCreateParamsNonStreaming we
// actually use in tracedMessage callers. Anything more exotic and
// the caller stays on Anthropic.
export interface NebiusMessageRequest {
  model?: string
  max_tokens: number
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

// What we return. Shape matches the slice of Anthropic Messages.Message
// the classifier reads (.content array of text blocks).
export interface NebiusTracedResponse {
  content: Array<{ type: 'text'; text: string }>
  model: string
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
  _llmCallId: string
}

/**
 * Drop-in Nebius alternative to tracedMessage. Same linkage guarantees,
 * same logging surface, different provider.
 *
 * Returns a "fake Anthropic" content array so callers that already parse
 * Anthropic responses (the classifier) keep working with no branching
 * beyond which wrapper they invoke.
 */
export async function nebiusTracedMessage(
  ctx: TraceContext,
  request: NebiusMessageRequest
): Promise<NebiusTracedResponse> {
  const startedAt = new Date()
  const callId = randomUUID()
  const model = request.model || NEBIUS_DEFAULT_MODEL

  let responseText = ''
  let promptTokens = 0
  let completionTokens = 0
  let errorMessage: string | null = null

  try {
    const client = getClient()
    const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    if (request.system) openaiMessages.push({ role: 'system', content: request.system })
    for (const m of request.messages) openaiMessages.push({ role: m.role, content: m.content })

    const completion = await client.chat.completions.create({
      model,
      max_tokens: request.max_tokens,
      messages: openaiMessages,
    })

    responseText = completion.choices[0]?.message?.content ?? ''
    promptTokens = completion.usage?.prompt_tokens ?? 0
    completionTokens = completion.usage?.completion_tokens ?? 0
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const endedAt = new Date()
    void logNebiusCall({
      callId,
      ctx,
      model,
      request,
      responseText,
      promptTokens,
      completionTokens,
      startedAt,
      endedAt,
      errorMessage,
    })
  }

  return {
    content: [{ type: 'text' as const, text: responseText }],
    model,
    stop_reason: errorMessage ? 'error' : 'end_turn',
    usage: { input_tokens: promptTokens, output_tokens: completionTokens },
    _llmCallId: callId,
  }
}

async function logNebiusCall(args: {
  callId: string
  ctx: TraceContext
  model: string
  request: NebiusMessageRequest
  responseText: string
  promptTokens: number
  completionTokens: number
  startedAt: Date
  endedAt: Date
  errorMessage: string | null
}) {
  try {
    const { callId, ctx, model, request, responseText, promptTokens, completionTokens,
      startedAt, endedAt, errorMessage } = args

    // Nebius cost depends on model. For Llama 3.1 70B Instruct on Token
    // Factory today: roughly $0.13 / M input, $0.40 / M output. Hard-code
    // a low rate so cost shows up in /observability; refresh if Nebius
    // changes pricing.
    const inputRate = 0.13 / 1_000_000
    const outputRate = 0.40 / 1_000_000
    const cost = promptTokens * inputRate + completionTokens * outputRate

    const { error } = await supabase
      .from('llm_calls')
      .insert({
        id: callId,
        user_id: ctx.user_id ?? null,
        system: 'nebius',
        operation: 'chat',
        request_model: model,
        response_model: model,
        response_id: null,
        finish_reason: errorMessage ? 'error' : 'end_turn',
        input_tokens: promptTokens || null,
        output_tokens: completionTokens || null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        cost_usd: Number(cost.toFixed(8)),
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        prompt_id: ctx.prompt_id,
        prompt_version: ctx.prompt_version ?? 1,
        request_payload: request as unknown as object,
        response_payload: { content: responseText } as unknown as object,
        response_text: responseText,
        parent_run_id: ctx.parent_run_id ?? null,
        produced_item_ids: null,
        source_ref: ctx.source_ref ?? null,
        input_content: ctx.input_content ?? null,
        error: errorMessage,
      })

    if (error) {
      console.error('[nebius-trace] failed to log call:', error.message)
    }
  } catch (err) {
    console.error('[nebius-trace] unexpected log error:',
      err instanceof Error ? err.message : err)
  }
}

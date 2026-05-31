'use server'

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { PROMPTS } from '@/lib/prompt-registry'
import { anthropic, MODELS } from '@/lib/anthropic'
import { tracedMessage } from '@/lib/llm-trace'
import { nangoProxy } from '@/lib/nango'
import { getActiveConnection, NANGO_PROVIDER_KEY } from '@/lib/connections'
import { extractJsonObject } from '@/lib/extract/parse'

async function resolveUserId(): Promise<string | null> {
  const sb = await createSupabaseServerClient()
  const { data: { user } } = await sb.auth.getUser()
  return user?.id ?? null
}

export async function regenerateVoice(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await resolveUserId()
    if (!userId) return { ok: false, error: 'Not authenticated.' }

    const conn = await getActiveConnection('gmail')
    if (!conn?.nango_connection_id) return { ok: false, error: 'Connect Gmail first.' }

    const providerConfigKey = NANGO_PROVIDER_KEY.gmail!
    const connectionId = conn.nango_connection_id

    const listData = await nangoProxy<{ messages?: Array<{ id: string }> }>({
      providerConfigKey,
      connectionId,
      method: 'GET',
      endpoint: '/gmail/v1/users/me/messages',
      params: { q: 'in:sent newer_than:30d', maxResults: 50 },
    })

    const messageIds = (listData.messages ?? []).slice(0, 30).map(m => m.id)
    if (messageIds.length < 3) {
      return { ok: false, error: 'Too few sent messages to build a voice profile.' }
    }

    const bodies: string[] = []
    for (const id of messageIds.slice(0, 20)) {
      try {
        const msg = await nangoProxy<{ snippet?: string }>({
          providerConfigKey,
          connectionId,
          method: 'GET',
          endpoint: `/gmail/v1/users/me/messages/${id}`,
          params: { format: 'metadata' },
        })
        const snippet = msg.snippet ?? ''
        if (snippet.length > 20) bodies.push(snippet)
      } catch {
        // skip individual message errors
      }
    }

    const transcript = bodies.join('\n\n---\n\n').slice(0, 40000)

    const voicePrompt = `You analyze a user's sent emails to generate a concise voice profile.

Output STRICT JSON only:
{
  "voice": "2-3 sentences describing how this person writes. Include: tone, greeting style, sign-off style, typical length, any distinctive phrases.",
  "openers": ["example opener 1", "example opener 2", "example opener 3", "example opener 4", "example opener 5"],
  "closers": ["example closer 1", "example closer 2", "example closer 3", "example closer 4", "example closer 5"]
}

RULES:
- openers: verbatim from the emails (just the first line/greeting)
- closers: verbatim sign-offs
- voice: descriptive, specific, not generic
- NEVER use em-dashes (\u2014). Use hyphens, colons, or rewrite.`

    const response = await tracedMessage(
      anthropic,
      { prompt_id: 'analyze.voice', prompt_version: 1, user_id: userId },
      {
        model: MODELS.classifier,
        max_tokens: 600,
        system: voicePrompt,
        messages: [{ role: 'user', content: `Sent emails:\n\n${transcript}\n\nGenerate the voice profile.` }],
      }
    )

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text).join('')

    const parsed = JSON.parse(extractJsonObject(text)) as { voice?: string; openers?: string[]; closers?: string[] }

    if (!parsed.voice) return { ok: false, error: 'Claude did not return a voice profile.' }

    await supabase.from('users').update({
      communication_style: parsed.voice,
      voice_examples: { openers: parsed.openers ?? [], closers: parsed.closers ?? [] },
      voice_updated_at: new Date().toISOString(),
    }).eq('id', userId)

    revalidatePath('/profile')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function suggestPromptEdit(args: {
  promptId: string
  currentVersion: number
  suggestion: string
  outcome?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!PROMPTS[args.promptId]) return { ok: false, error: 'Unknown prompt.' }
  if (!args.suggestion.trim()) return { ok: false, error: 'Suggestion cannot be empty.' }
  if (args.suggestion.length > 5000) return { ok: false, error: 'Suggestion too long (max 5000 chars).' }

  try {
    const userId = await resolveUserId()
    if (!userId) return { ok: false, error: 'Not authenticated.' }

    const { error } = await supabase.from('prompt_suggestions').insert({
      user_id: userId,
      prompt_id: args.promptId,
      prompt_version: args.currentVersion,
      suggestion: args.suggestion,
      outcome: args.outcome ?? null,
      status: 'open',
    })

    if (error) throw error
    revalidatePath('/profile')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

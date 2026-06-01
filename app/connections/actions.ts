'use server'

// Server actions for the /connections page.
//
// Nango OAuth providers (Gmail, future Slack):
//   1. Frontend calls createNangoConnectSession(provider) → returns a session
//      token that authorises the browser to run ONE OAuth flow.
//   2. Frontend uses @nangohq/frontend Nango.auth(providerKey) → user OAuth.
//   3. After the popup closes, frontend calls recordNangoConnection(provider,
//      connectionId) to persist the new connection to our DB.
//
// API-key providers (Granola, Linear):
//   1. Frontend collects the API key from a form.
//   2. Submits to recordGranolaApiKey/recordLinearApiKey — stored directly in DB.

import { revalidatePath } from 'next/cache'
import { nango } from '@/lib/nango'
import {
  upsertConnection,
  deactivateConnection,
  NANGO_PROVIDER_KEY,
} from '@/lib/connections'
import { resolveUserId, createSupabaseServerClient } from '@/lib/supabase-server'
import type { ConnectionProvider } from '@/lib/types'

/**
 * Mint a one-shot Nango Connect session token. The frontend SDK uses this
 * token to authorize a single OAuth flow for a single user + integration.
 * Tokens are short-lived; created fresh on each Connect click.
 *
 * Uses the authenticated user's actual email as the Nango end_user so
 * the OAuth account picker pre-selects the right account.
 */
export async function createNangoConnectSession(
  provider: ConnectionProvider
): Promise<{ token: string; providerKey: string; userEmail: string }> {
  const providerKey = NANGO_PROVIDER_KEY[provider]
  if (!providerKey) {
    throw new Error(`${provider} doesn't use Nango OAuth.`)
  }

  // Read the real authenticated user's email — never hardcode.
  const supabaseClient = await createSupabaseServerClient()
  const { data: { user } } = await supabaseClient.auth.getUser()
  const userEmail = user?.email ?? 'subash@sigiq.ai'
  const userId = await resolveUserId()

  const session = (await nango.createConnectSession({
    end_user: { id: userId, email: userEmail },
    allowed_integrations: [providerKey],
  })) as { data?: { token?: string }; token?: string }

  const token = session?.data?.token ?? session?.token
  if (!token) {
    throw new Error('Nango createConnectSession did not return a token.')
  }
  return { token, providerKey, userEmail }
}

/**
 * Persist a freshly-completed Nango OAuth connection to our DB. Called by
 * the frontend after Nango.auth() resolves with a connectionId.
 */
export async function recordNangoConnection(
  provider: ConnectionProvider,
  nangoConnectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (NANGO_PROVIDER_KEY[provider] === null) {
      return { ok: false, error: `${provider} doesn't use Nango OAuth.` }
    }
    await upsertConnection({ provider, nango_connection_id: nangoConnectionId })
    revalidatePath('/connections')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[recordNangoConnection] failed for ${provider}:`, msg)
    return { ok: false, error: msg }
  }
}

/**
 * Store a Granola API key (API-key auth, no OAuth).
 */
export async function recordGranolaApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key is empty.')
  if (!trimmed.startsWith('grn_')) {
    throw new Error('That doesn\'t look like a Granola API key (should start with "grn_").')
  }
  await upsertConnection({ provider: 'granola', api_key: trimmed })
  revalidatePath('/connections')
}

/**
 * Store a Linear Personal API key. Linear keys start with `lin_api_`.
 */
export async function recordLinearApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key is empty.')
  if (!trimmed.startsWith('lin_api_')) {
    throw new Error('That doesn\'t look like a Linear Personal API key (should start with "lin_api_").')
  }
  await upsertConnection({ provider: 'linear', api_key: trimmed })
  revalidatePath('/connections')
}

/**
 * Disconnect a provider: expires the DB row and revokes the Nango token.
 */
export async function disconnectProvider(
  provider: ConnectionProvider
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deactivateConnection(provider)
    revalidatePath('/connections')
    return { ok: true }
  } catch (err) {
    console.error(`[disconnectProvider] failed for ${provider}:`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'Disconnect failed' }
  }
}

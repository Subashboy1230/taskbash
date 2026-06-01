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
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ConnectionProvider } from '@/lib/types'

/** Read the current session user — always available on the /connections page. */
async function getSessionUser() {
  const client = await createSupabaseServerClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user?.id) throw new Error('Not authenticated.')
  return user
}

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

  const user = await getSessionUser()

  let session: { data?: { token?: string }; token?: string }
  try {
    session = (await nango.createConnectSession({
      end_user: { id: user.id, email: user.email ?? '' },
      allowed_integrations: [providerKey],
    })) as { data?: { token?: string }; token?: string }
  } catch (err: unknown) {
    const axErr = err as { response?: { data?: unknown }; message?: string }
    const data = axErr?.response?.data as { error?: { code?: string; message?: string } } | undefined
    const code = data?.error?.code
    if (code === 'resource_capped') {
      throw new Error('Connection limit reached on Nango free plan. Delete unused connections at app.nango.dev or upgrade your plan.')
    }
    const detail = data ? JSON.stringify(data) : axErr?.message
    throw new Error(`Nango createConnectSession failed (${providerKey}): ${detail}`)
  }

  const token = session?.data?.token ?? session?.token
  if (!token) {
    throw new Error('Nango createConnectSession did not return a token.')
  }
  return { token, providerKey, userEmail: user.email ?? '' }
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
    const user = await getSessionUser()
    await upsertConnection({ provider, nango_connection_id: nangoConnectionId, userId: user.id })
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
  const user = await getSessionUser()
  await upsertConnection({ provider: 'granola', api_key: trimmed, userId: user.id })
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
  const user = await getSessionUser()
  await upsertConnection({ provider: 'linear', api_key: trimmed, userId: user.id })
  revalidatePath('/connections')
}

/**
 * Disconnect a provider: expires the DB row and revokes the Nango token.
 */
export async function disconnectProvider(
  provider: ConnectionProvider
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await getSessionUser()
    await deactivateConnection(provider, user.id)
    revalidatePath('/connections')
    return { ok: true }
  } catch (err) {
    console.error(`[disconnectProvider] failed for ${provider}:`, err)
    return { ok: false, error: err instanceof Error ? err.message : 'Disconnect failed' }
  }
}

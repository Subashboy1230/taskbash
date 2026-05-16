// Connections — the single source of truth for OAuth tokens (via Nango) and
// API keys per user. Extractors call getActiveConnection() to read credentials
// from the DB instead of hardcoded env vars.
//
// Still single-user (uses APP_USER_ID env var). When auth lands in a future
// week, the user_id arg becomes the authenticated user's id.

import { supabase } from './supabase'
import { nango } from './nango'
import type { Connection, ConnectionProvider } from './types'

const USER_ID = process.env.APP_USER_ID!

// Reverse map: Nango provider config key → our internal provider name.
const PROVIDER_FROM_NANGO_KEY: Record<string, ConnectionProvider> = {
  'google-mail': 'gmail',
  'google-calendar': 'calendar',
  slack: 'slack',
  linear: 'linear',
}

// Maps our internal provider name → the Nango integration's provider config
// key. OAuth sources use Nango; Granola is API-key (no Nango).
export const NANGO_PROVIDER_KEY: Record<ConnectionProvider, string | null> = {
  gmail: 'google-mail',
  calendar: 'google-calendar',
  slack: 'slack',
  linear: 'linear',
  granola: null, // API key auth, not via Nango
}

/**
 * Look up the active connection for a given provider for the current user.
 * Returns null if no active connection exists — callers handle the missing
 * case (typically by skipping the source extraction).
 */
export async function getActiveConnection(
  provider: ConnectionProvider
): Promise<Connection | null> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('provider', provider)
    .eq('status', 'active')
    .maybeSingle()
  if (error) {
    throw new Error(`getActiveConnection(${provider}) failed: ${error.message}`)
  }
  return (data as Connection | null) ?? null
}

/**
 * Insert or update the connection for the current user + provider. Used by
 * the Connect flow when a user finishes OAuth or pastes an API key.
 */
export async function upsertConnection(args: {
  provider: ConnectionProvider
  nango_connection_id?: string | null
  api_key?: string | null
  scopes?: string[] | null
}): Promise<Connection> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')
  const { data, error } = await supabase
    .from('connections')
    .upsert(
      {
        user_id: USER_ID,
        provider: args.provider,
        nango_connection_id: args.nango_connection_id ?? null,
        api_key: args.api_key ?? null,
        scopes: args.scopes ?? null,
        status: 'active',
      },
      { onConflict: 'user_id,provider' }
    )
    .select('*')
    .single()
  if (error) throw new Error(`upsertConnection failed: ${error.message}`)
  return data as Connection
}

/**
 * Mark a connection as disconnected (soft delete — preserves history). The
 * Connect flow can re-activate it later by upserting with status='active'.
 */
export async function deactivateConnection(
  provider: ConnectionProvider
): Promise<void> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')
  const { error } = await supabase
    .from('connections')
    .update({ status: 'expired' })
    .eq('user_id', USER_ID)
    .eq('provider', provider)
  if (error) throw new Error(`deactivateConnection failed: ${error.message}`)
}

/**
 * List all of the current user's connections for the /connections UI.
 */
export async function listUserConnections(): Promise<Connection[]> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listUserConnections failed: ${error.message}`)
  return (data as Connection[]) ?? []
}

/**
 * Pull active OAuth connections from Nango and upsert them into our DB.
 * Run before showing the /connections page so freshly-completed OAuth flows
 * are picked up even when the frontend SDK's popup→postMessage path glitches.
 *
 * Best-effort: any Nango API error is swallowed (we still render whatever's
 * in our DB). Returns the list of providers that got updated, for debugging.
 */
export async function syncOAuthConnectionsFromNango(): Promise<{
  updated: ConnectionProvider[]
  error?: string
}> {
  if (!USER_ID) throw new Error('APP_USER_ID is not set')

  let raw: unknown
  try {
    raw = await nango.listConnections()
  } catch (err) {
    return { updated: [], error: err instanceof Error ? err.message : String(err) }
  }

  // Nango's response shape varies across SDK versions; normalise.
  const wrapper = raw as { connections?: unknown[]; data?: unknown[] } | unknown[]
  const list: unknown[] = Array.isArray(wrapper)
    ? wrapper
    : wrapper.connections ?? wrapper.data ?? []

  const updated: ConnectionProvider[] = []
  for (const entry of list) {
    const c = entry as {
      provider_config_key?: string
      providerConfigKey?: string
      connection_id?: string
      connectionId?: string
      end_user?: { id?: string }
      endUser?: { id?: string }
    }
    const nangoKey = c.provider_config_key ?? c.providerConfigKey
    const nangoConnectionId = c.connection_id ?? c.connectionId
    const endUserId = c.end_user?.id ?? c.endUser?.id ?? null

    if (!nangoKey || !nangoConnectionId) continue
    // If the response includes end-user info, filter to ours. Otherwise
    // accept everything (single-user mode — there's only this user).
    if (endUserId !== null && endUserId !== USER_ID) continue

    const internalProvider = PROVIDER_FROM_NANGO_KEY[nangoKey]
    if (!internalProvider) continue

    try {
      await upsertConnection({
        provider: internalProvider,
        nango_connection_id: nangoConnectionId,
      })
      updated.push(internalProvider)
    } catch {
      // Skip on per-provider failure — best-effort sync.
    }
  }

  return { updated }
}

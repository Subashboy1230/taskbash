// Connections — the single source of truth for OAuth tokens (via Nango) and
// API keys per user. Extractors call getActiveConnection() to read credentials
// from the DB instead of hardcoded env vars.

import { supabase } from './supabase'
import { nango } from './nango'
import { resolveUserId } from './supabase-server'
import type { Connection, ConnectionProvider } from './types'

// Reverse map: Nango provider config key → our internal provider name.
const PROVIDER_FROM_NANGO_KEY: Record<string, ConnectionProvider> = {
  'google-mail': 'gmail',
  'google-calendar': 'calendar',
  slack: 'slack',
}

// Maps our internal provider name → the Nango integration's provider config
// key. OAuth sources use Nango; Granola + Linear are API-key (no Nango —
// Linear OAuth requires workspace admin so we use Personal API keys instead).
export const NANGO_PROVIDER_KEY: Record<ConnectionProvider, string | null> = {
  gmail: 'google-mail',
  calendar: 'google-calendar',
  slack: 'slack',
  linear: null, // Personal API key auth
  granola: null, // API key auth
}

/**
 * Look up the active connection for a given provider for the current user.
 * Returns null if no active connection exists.
 */
export async function getActiveConnection(
  provider: ConnectionProvider,
  explicitUserId?: string
): Promise<Connection | null> {
  const userId = explicitUserId ?? await resolveUserId()
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'active')
    .maybeSingle()
  if (error) {
    throw new Error(`getActiveConnection(${provider}) failed: ${error.message}`)
  }
  return (data as Connection | null) ?? null
}

/**
 * Insert or update the connection for the current user + provider.
 */
export async function upsertConnection(args: {
  provider: ConnectionProvider
  nango_connection_id?: string | null
  api_key?: string | null
  scopes?: string[] | null
  userId?: string
}): Promise<Connection> {
  const userId = args.userId ?? await resolveUserId()
  const { data, error } = await supabase
    .from('connections')
    .upsert(
      {
        user_id: userId,
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
 * Mark a connection as disconnected and revoke the token from Nango.
 * Uses a single atomic UPDATE...RETURNING so we get the nango_connection_id
 * in one round-trip without a race between SELECT and UPDATE.
 */
export async function deactivateConnection(
  provider: ConnectionProvider,
  explicitUserId?: string
): Promise<void> {
  const userId = explicitUserId ?? await resolveUserId()

  // Atomically expire AND read back the nango_connection_id in one query.
  const { data: updated, error } = await supabase
    .from('connections')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .eq('provider', provider)
    .select('nango_connection_id')
  if (error) throw new Error(`deactivateConnection failed: ${error.message}`)

  // Revoke the token in Nango so it can't be resurrected by syncOAuth.
  const nangoKey = NANGO_PROVIDER_KEY[provider]
  const nangoConnectionId = (updated?.[0] as { nango_connection_id?: string | null } | undefined)?.nango_connection_id
  if (nangoKey && nangoConnectionId) {
    try {
      await nango.deleteConnection(nangoKey, nangoConnectionId)
    } catch (err) {
      // Non-fatal: DB row is already expired. Log for observability.
      console.error(`[deactivateConnection] Nango deleteConnection(${provider}) failed:`, err)
    }
  }
}

/**
 * List the current user's ACTIVE connections for the /connections UI.
 */
export async function listUserConnections(explicitUserId?: string): Promise<Connection[]> {
  const userId = explicitUserId ?? await resolveUserId()
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listUserConnections failed: ${error.message}`)
  return (data as Connection[]) ?? []
}

/**
 * Pull active OAuth connections from Nango and upsert them into our DB.
 * Run before showing the /connections page so freshly-completed OAuth flows
 * are picked up even when the frontend SDK's popup→postMessage path glitches.
 *
 * Skips any provider the user has explicitly disconnected (status=expired) so
 * a disconnect is never undone by the sync.
 */
export async function syncOAuthConnectionsFromNango(): Promise<{
  updated: ConnectionProvider[]
  error?: string
}> {
  const userId = await resolveUserId()

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
    : (wrapper as { connections?: unknown[]; data?: unknown[] }).connections
      ?? (wrapper as { connections?: unknown[]; data?: unknown[] }).data
      ?? []

  // Load providers the user has explicitly disconnected — never resurrect them.
  const { data: expiredRows } = await supabase
    .from('connections')
    .select('provider')
    .eq('user_id', userId)
    .eq('status', 'expired')
  const expiredProviders = new Set(
    (expiredRows ?? []).map((r: { provider: string }) => r.provider)
  )

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

    // Only accept connections belonging to this user. If Nango doesn't
    // return end_user info we skip rather than accept blindly.
    if (!endUserId || endUserId !== userId) continue

    const internalProvider = PROVIDER_FROM_NANGO_KEY[nangoKey]
    if (!internalProvider) continue

    // Never re-activate a provider the user explicitly disconnected.
    if (expiredProviders.has(internalProvider)) continue

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

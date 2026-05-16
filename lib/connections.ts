// Connections — the single source of truth for OAuth tokens (via Nango) and
// API keys per user. Extractors call getActiveConnection() to read credentials
// from the DB instead of hardcoded env vars.
//
// Still single-user (uses APP_USER_ID env var). When auth lands in a future
// week, the user_id arg becomes the authenticated user's id.

import { supabase } from './supabase'
import type { Connection, ConnectionProvider } from './types'

const USER_ID = process.env.APP_USER_ID!

// Maps our internal provider name → the Nango integration's provider config
// key. Slack and Gmail use Nango OAuth; Granola is API-key (no Nango).
export const NANGO_PROVIDER_KEY: Record<ConnectionProvider, string | null> = {
  gmail: 'google-mail',
  slack: 'slack',
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

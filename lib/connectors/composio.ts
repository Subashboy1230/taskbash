// Composio v3 SDK client.
//
// Composio retired the v1 /api/v1/* REST endpoints (HTTP 410 as of 2026).
// The v3 SDK ships as @composio/core and routes through the Auth Configs +
// Connected Accounts model:
//   - Auth Config (ac_xxx) is the OAuth blueprint per app per Composio
//     project. Created once via the dashboard.
//   - Connected Account (ca_xxx) is one user's authorized link to that
//     auth config. Created per-user by sending them through a Connect
//     Link (https://connect.composio.dev/link/ln_xxx).
//
// What we use Composio for: Slack source extraction. The user authorized
// Slack once through Composio's hosted OAuth (Connect Link generated from
// the dashboard), pasted the resulting Connected Account ID into env, and
// the digest pipeline pulls recent Slack messages through this client.
//
// Activation steps:
//   1. Sign up at dashboard.composio.dev, get an API key
//   2. Create an Auth Config for Slack (Composio Managed OAuth)
//   3. Create a Connected Account for your user (Connect Link → authorize)
//   4. Paste COMPOSIO_API_KEY, COMPOSIO_ENTITY_ID (your user handle), and
//      COMPOSIO_SLACK_CONNECTION_ID (ca_xxx) into .env.local
//   5. Trigger a digest; Slack items appear on /today

import { Composio } from '@composio/core'

// ─── SDK singleton ───────────────────────────────────────────────────
// Lazy because Composio's constructor throws if apiKey is missing at
// import time, and the digest may run on environments where the key
// is intentionally absent (composio.{configured,slackConfigured} return
// false and skip the source entirely).

let _client: Composio | null = null

function composio(): Composio {
  if (_client) return _client
  const apiKey = process.env.COMPOSIO_API_KEY
  if (!apiKey) throw new Error('COMPOSIO_API_KEY missing in env')
  _client = new Composio({ apiKey })
  return _client
}

export function composioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY)
}

export function composioSlackConfigured(): boolean {
  return (
    composioConfigured() &&
    Boolean(process.env.COMPOSIO_SLACK_CONNECTION_ID) &&
    Boolean(process.env.COMPOSIO_ENTITY_ID)
  )
}

// ─── Tool execution ──────────────────────────────────────────────────

export interface ComposioToolExecuteResponse {
  data?: unknown
  successful?: boolean
  error?: string | null
  logId?: string
}

/**
 * Execute a Composio tool by slug, on behalf of a connected account.
 *
 * v3 surface: `composio.tools.execute(slug, { userId, connectedAccountId,
 * arguments })`. The SDK resolves the right connected account for that
 * user + toolkit, but we pin connectedAccountId explicitly so the call
 * is deterministic when the user has multiple Slack workspaces.
 *
 * For Slack the relevant tool slugs include:
 *   - SLACK_FETCH_CONVERSATION_HISTORY
 *   - SLACK_LIST_ALL_USERS
 *   - SLACK_SEARCH_MESSAGES
 */
export async function composioExecuteTool(args: {
  tool: string
  params: Record<string, unknown>
  /** Composio Connected Account ID (ca_xxx). */
  connectedAccountId: string
  /** Composio entity / user handle. Defaults to COMPOSIO_ENTITY_ID. */
  userId?: string
}): Promise<ComposioToolExecuteResponse> {
  const userId = args.userId || process.env.COMPOSIO_ENTITY_ID || 'default'
  const c = composio()
  const res = await c.tools.execute(args.tool, {
    userId,
    connectedAccountId: args.connectedAccountId,
    arguments: args.params,
    // v3 requires either a pinned toolkit version per-call or this flag.
    // For a single-user app where we don't pin Slack tool revisions, use
    // "latest" and accept the small risk Composio renames a field on us.
    // Pin via { toolkitVersions: { slack: '20250909_00' } } in the
    // Composio constructor if reliability beats agility later.
    dangerouslySkipVersionCheck: true,
  } as Parameters<typeof c.tools.execute>[1])
  return {
    data: res.data,
    successful: res.successful,
    error: res.error,
    logId: res.logId,
  }
}

/**
 * Generate a Connect Link the user opens in their browser to authorize
 * Slack against an existing Composio Auth Config. Returns the redirect
 * URL plus the freshly-created Connected Account ID (paste into
 * COMPOSIO_SLACK_CONNECTION_ID once authorize completes).
 *
 * v3 surface: `composio.connectedAccounts.link(userId, authConfigId)`.
 * `authConfigId` is the ac_xxx your dashboard Auth Config exposes.
 */
export async function composioInitiateSlackConnection(args: {
  authConfigId?: string
  userId?: string
  callbackUrl?: string
}): Promise<{ redirectUrl: string; connectionId: string }> {
  const authConfigId = args.authConfigId || process.env.COMPOSIO_SLACK_AUTH_CONFIG_ID
  if (!authConfigId) {
    throw new Error(
      '[composio] initiate slack: COMPOSIO_SLACK_AUTH_CONFIG_ID missing (the ac_xxx from your dashboard Auth Config)'
    )
  }
  const userId = args.userId || process.env.COMPOSIO_ENTITY_ID || 'default'
  const c = composio()
  // v3 method name shifted across betas; the SDK exposes
  // `connectedAccounts.link` (hosted Connect Link). Cast lightly so
  // an SDK minor bump doesn't fail typecheck on us before runtime.
  const ca = c.connectedAccounts as unknown as {
    link: (
      userId: string,
      authConfigId: string,
      options?: { callbackUrl?: string }
    ) => Promise<{ redirectUrl?: string; connectionStatus?: { id?: string }; id?: string }>
  }
  const res = await ca.link(userId, authConfigId, {
    callbackUrl: args.callbackUrl,
  })
  const connectionId = res.connectionStatus?.id || res.id
  if (!res.redirectUrl || !connectionId) {
    throw new Error('[composio] initiate slack: missing redirectUrl or connection id in response')
  }
  return { redirectUrl: res.redirectUrl, connectionId }
}

// Composio REST client.
//
// Why a fetch wrapper instead of composio-core SDK: Composio rebranded
// and composio-core@0.5.x is marked deprecated upstream. The REST API
// at https://backend.composio.dev is stable and version-independent,
// so we hit it directly and keep our dependency surface flat.
//
// What we use Composio for right now: Slack source extraction. The
// user authorizes Slack once through Composio's hosted OAuth (out of
// band, via the Composio dashboard or our /connections initiate flow),
// stores the connection id in env, and the digest pipeline pulls
// recent Slack messages via this client.
//
// Activation steps:
//   1. Sign up at app.composio.dev, get an API key
//   2. Add Slack as an enabled tool for your project
//   3. Initiate a Slack connection for your entity (Composio dashboard
//      provides an OAuth link, or use composioInitiateSlackConnection
//      below in a one-off script)
//   4. Paste COMPOSIO_API_KEY and COMPOSIO_SLACK_CONNECTION_ID into
//      .env.local
//   5. Trigger a digest; Slack items appear on /today

const BASE = process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev'

function apiKey(): string {
  const k = process.env.COMPOSIO_API_KEY
  if (!k) throw new Error('COMPOSIO_API_KEY missing in env')
  return k
}

export function composioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY)
}

export function composioSlackConfigured(): boolean {
  return composioConfigured() && Boolean(process.env.COMPOSIO_SLACK_CONNECTION_ID)
}

interface ComposioToolExecuteResponse {
  data?: unknown
  successful?: boolean
  error?: string | null
}

/**
 * Execute a Composio tool by slug, on behalf of a connected account.
 *
 * Composio normalizes provider APIs into a single `execute` surface.
 * For Slack the relevant tool slugs include:
 *   - SLACK_FETCH_CONVERSATION_HISTORY
 *   - SLACK_LIST_ALL_USERS
 *   - SLACK_SEARCH_MESSAGES
 *
 * params is the tool's input arguments (shape per Composio's tool
 * registry). connectedAccountId is the Slack connection the call runs
 * against (per-user, persisted server-side at Composio).
 */
export async function composioExecuteTool(args: {
  tool: string
  params: Record<string, unknown>
  connectedAccountId: string
}): Promise<ComposioToolExecuteResponse> {
  const url = `${BASE}/api/v1/actions/${args.tool}/execute`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
    },
    body: JSON.stringify({
      connectedAccountId: args.connectedAccountId,
      input: args.params,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[composio] ${args.tool} failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as ComposioToolExecuteResponse
}

/**
 * Initiate a Slack OAuth connection for the configured entity. Returns
 * a redirect URL the user opens in their browser to authorize Slack.
 *
 * Use this from a one-off setup script (or wire into /connections later).
 */
export async function composioInitiateSlackConnection(args: {
  entityId?: string
  callbackUrl?: string
}): Promise<{ redirectUrl: string; connectionId: string }> {
  const entityId = args.entityId || process.env.COMPOSIO_ENTITY_ID || 'default'
  const url = `${BASE}/api/v1/connections/initiate`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(),
    },
    body: JSON.stringify({
      integrationId: 'slack',
      entityId,
      redirectUri: args.callbackUrl,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[composio] initiate slack failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as { redirectUrl?: string; connectionId?: string }
  if (!body.redirectUrl || !body.connectionId) {
    throw new Error('[composio] initiate slack: missing redirectUrl or connectionId in response')
  }
  return { redirectUrl: body.redirectUrl, connectionId: body.connectionId }
}

// Nango client wrapper. Used by extractors to call provider APIs without
// touching OAuth tokens directly — Nango handles refresh + token storage.

import { Nango } from '@nangohq/node'

if (!process.env.NANGO_SECRET_KEY) {
  throw new Error('Missing env: NANGO_SECRET_KEY')
}

export const nango = new Nango({
  secretKey: process.env.NANGO_SECRET_KEY,
})

/**
 * Proxy a request through Nango to a provider's API.
 * Nango injects the OAuth bearer token automatically.
 *
 * Docs: https://docs.nango.dev/integration-builder/use-the-proxy
 */
export async function nangoProxy<T = unknown>(opts: {
  providerConfigKey: string
  connectionId: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  endpoint: string
  params?: Record<string, string | number>
  data?: unknown
  headers?: Record<string, string>
}): Promise<T> {
  const res = await nango.proxy({
    providerConfigKey: opts.providerConfigKey,
    connectionId: opts.connectionId,
    method: opts.method,
    endpoint: opts.endpoint,
    params: opts.params,
    data: opts.data,
    headers: opts.headers,
  })
  return res.data as T
}

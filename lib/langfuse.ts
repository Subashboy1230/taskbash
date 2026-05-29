// Langfuse client singleton — secondary destination for LLM traces.
//
// Supabase llm_calls remains the source of truth. Langfuse gets a
// fire-and-forget copy so you can use their polished trace viewer +
// drill-down UI when debugging weird calls.
//
// Setup:
//   1. Sign up at https://cloud.langfuse.com (free tier: 100k spans/mo)
//   2. Create a project → Settings → API Keys → "Create new"
//   3. Add to .env.local:
//        LANGFUSE_PUBLIC_KEY=pk-lf-...
//        LANGFUSE_SECRET_KEY=sk-lf-...
//        LANGFUSE_HOST=https://cloud.langfuse.com   (optional; default OK)
//
// When env vars are missing, this module returns null and all writes
// are silently no-op'd — perfectly fine to deploy without Langfuse set
// up; nothing breaks.

import { Langfuse } from 'langfuse'

let _client: Langfuse | null | undefined
let _initialised = false

/**
 * Lazy-initialised singleton. First call constructs the client (or
 * marks it as unconfigured); subsequent calls return the cached value.
 */
export function getLangfuse(): Langfuse | null {
  if (_initialised) return _client ?? null
  _initialised = true

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) {
    _client = null
    return null
  }
  try {
    _client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
      // Flush every 10s. Default is fine for our volume; we mostly
      // rely on per-process shutdown to flush.
      flushAt: 15,
      flushInterval: 10_000,
    })
    return _client
  } catch (err) {
    console.error('[langfuse] init failed:', err instanceof Error ? err.message : err)
    _client = null
    return null
  }
}

/**
 * Flush pending events. Call before letting a serverless function exit
 * if you want best-effort delivery. The morning-digest cron / Inngest
 * pipeline benefits from this; one-off server actions can skip it.
 */
export async function flushLangfuse(): Promise<void> {
  const client = getLangfuse()
  if (!client) return
  try {
    await client.shutdownAsync()
  } catch (err) {
    console.error('[langfuse] flush failed:', err instanceof Error ? err.message : err)
  }
  // Allow re-init on next call (serverless re-use).
  _client = undefined
  _initialised = false
}

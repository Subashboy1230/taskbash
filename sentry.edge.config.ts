// Sentry edge runtime init. Imported from instrumentation.ts when the
// runtime is "edge". Covers middleware.ts, which runs on every gated request.
// Error-only tier: no performance tracing.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
})

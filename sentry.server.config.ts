// Sentry Node server-side init. Imported from instrumentation.ts when the
// runtime is "nodejs". Covers server components, server actions, route
// handlers, and the Inngest functions served at /api/inngest.
// Error-only tier: no performance tracing.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
})

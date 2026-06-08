// Sentry browser-side init. Loaded automatically by the Sentry build plugin.
// Error-only tier: no performance tracing, no session replay.
// Driven by NEXT_PUBLIC_SENTRY_DSN — if unset, the SDK no-ops, so local dev
// stays quiet until you opt in by setting the DSN.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Performance monitoring off.
  tracesSampleRate: 0,
  // Session replay off.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  debug: false,
})

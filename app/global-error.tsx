'use client'

// Root-level error boundary. App Router renders this (replacing the root
// layout) when an error is thrown during render of the root layout/template
// itself. It reports to Sentry so React render errors are captured in prod,
// and renders a self-contained dark fallback with a "Try again" reset.
//
// Because this replaces the root layout, it must render its own <html>/<body>
// and can't rely on globals.css being applied — styles are inline with the
// brand dark palette (hex literals are intentional here).

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          color: '#fafafa',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#a1a1a1', margin: '0 0 20px' }}>
            An unexpected error interrupted the page. It has been reported. You can
            try again, or head back to your tasks.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{
                cursor: 'pointer',
                borderRadius: 8,
                border: 'none',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: '#fafafa',
                color: '#0a0a0a',
              }}
            >
              Try again
            </button>
            <a
              href="/today"
              style={{
                borderRadius: 8,
                border: '1px solid #2a2a2a',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                color: '#fafafa',
                textDecoration: 'none',
              }}
            >
              Back to today
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}

/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Inngest webhook needs to receive arbitrary JSON; allow it.
  async headers() {
    return [
      {
        source: '/api/inngest',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ]
  },
}

const { withSentryConfig } = require('@sentry/nextjs')

module.exports = withSentryConfig(config, {
  // Source-map upload target. Reads SENTRY_AUTH_TOKEN from the env at build
  // time; without it, builds still succeed (maps just are not uploaded).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Quiet during local builds, verbose in CI.
  silent: !process.env.CI,
  // Upload a wider set of client bundles for readable stack traces.
  widenClientFileUpload: true,
  // Strip Sentry SDK logger statements from the client bundle.
  disableLogger: true,
})

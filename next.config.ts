import type { NextConfig } from 'next'

const config: NextConfig = {
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

export default config

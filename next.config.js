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

module.exports = config

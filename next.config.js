/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the runtime image
  // needs no node_modules install. Required by the Dockerfile's runner stage.
  output: 'standalone',
  async headers() {
    return [
      {
        // Every page and API response is personal health context: never stored by
        // a shared or public cache (SPEC §11). Static assets are excluded so they
        // keep normal browser caching.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

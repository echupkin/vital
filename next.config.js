/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) so the runtime image
  // needs no node_modules install. Required by the Dockerfile's runner stage.
  output: 'standalone',
  // pdfjs-dist ships an ESM build that must NOT be bundled: it is imported
  // dynamically by src/lib/lab/extract/pdf-items.ts, which only ever runs on the
  // server. Keeping it external leaves the resolution to Node at runtime and
  // keeps it out of every client bundle.
  serverExternalPackages: ['pdfjs-dist'],
  // …and external means the tracer does not follow it into the standalone output
  // on its own: without this, `.next/standalone/node_modules/pdfjs-dist` is
  // absent (verified) and the first lab upload throws MODULE_NOT_FOUND in the
  // container. Include the package explicitly so both `next start` on the
  // standalone build and the runtime image can resolve it.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/pdfjs-dist/**'],
  },
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

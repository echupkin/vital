// ── Web app manifest ────────────────────────────────────
//
// What a phone needs to install Vital as an app from the browser: its name, its
// icons (drawn by scripts/make-icons.mjs) and a window of its own with no browser
// toolbar. iOS reads this alongside the layout's `appleWebApp` metadata and
// apple-icon.png.

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vital — Health Intelligence',
    short_name: 'Vital',
    description: 'Your health. Your data. Your intelligence.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F7F7F9',
    theme_color: '#F7F7F9',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

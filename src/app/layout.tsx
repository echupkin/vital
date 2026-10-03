// ── Root Layout ───────────────────────────────────────
//
// Includes a blocking inline script that applies the cached theme before paint.
// Wraps all pages with AppShell (sidebar, topbar, mobile nav).
//
// The layout is where the data mode is resolved, server-side and once per
// request: demo fixtures, or the live Health Auto Export history fetched,
// normalized and cached by the server. The browser never receives the API token
// and never calls the health API itself.
//
// `force-dynamic` is required: the live dataset must be read per request, not
// baked into a prerendered page at build time.

import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { DatasetProvider } from '@/components/data/DatasetProvider';
import { ConnectionErrorState } from '@/components/data/ConnectionErrorState';
import { FALLBACK_CLIENT_META } from '@/components/data/fallback-meta';
import { LiveDataUnavailableError, resolveDataset, type ResolvedDataset } from '@/lib/adapters/runtime';
import { readProfileState } from '@/lib/profile/store';
import { LEGACY_STORAGE_KEY, preferencesCacheKey } from '@/lib/prefs/types';
import { DEFAULT_THEME_ID, themesFor } from '@/lib/prefs/themes';
import PrefsSync from '@/components/prefs/PrefsSync';

// The icons are files beside this layout (icon.svg, favicon.ico, apple-icon.png,
// drawn by scripts/make-icons.mjs) and the web app manifest is manifest.ts.
// `appleWebApp` lets iOS's "Add to Home Screen" open Vital as an app: its own
// window, no Safari toolbar, named "Vital" under the icon.
export const metadata: Metadata = {
  title: 'Vital — Health Intelligence',
  description: 'Your health. Your data. Your intelligence.',
  applicationName: 'Vital',
  appleWebApp: { capable: true, title: 'Vital', statusBarStyle: 'default' },
  // Next writes only the standard `mobile-web-app-capable`; iOS before 17.4
  // opens the home-screen app in its own window only for Apple's own name.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// The Default palettes' page colours, until the reader's own palette is applied
// (applyTheme in @/lib/prefs keeps the theme colour in step with it).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F7F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0C0D11' },
  ],
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The pre-paint theme, read from this device's CACHE only.
 *
 * The server owns the preferences (they follow the reader between browsers), so
 * this script deliberately does not fetch anything: it reads the namespaced
 * cache the sync engine keeps, which exists purely to stop a flash of the wrong
 * theme before the first paint. The legacy `vital-prefs` key is read once as a
 * fallback, because a browser that has not synced since the upgrade still has
 * only that.
 *
 * It resolves the theme the way `resolveTheme` in `@/lib/prefs` does: the mode
 * picks the side, that side's pick names the palette, and a pick this build
 * does not know (or a cache from before picks existed) is the default theme.
 * It sets `data-theme` for the palette and the `dark` class for Tailwind.
 */
const KNOWN_THEMES = JSON.stringify({
  light: themesFor('light').map(t => t.id),
  dark: themesFor('dark').map(t => t.id),
});

const themeScript = `
  (function() {
    try {
      var raw = localStorage.getItem('${preferencesCacheKey()}') || localStorage.getItem('${LEGACY_STORAGE_KEY}');
      var prefs = JSON.parse(raw || '{}') || {};
      var theme = prefs.theme || 'system';
      var scheme = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      var known = ${KNOWN_THEMES};
      var id = prefs[scheme + 'Theme'];
      if (known[scheme].indexOf(id) < 0) id = '${DEFAULT_THEME_ID}';
      var root = document.documentElement;
      if (scheme === 'dark') root.classList.add('dark');
      root.setAttribute('data-theme', scheme + '-' + id);
    } catch(e) {}
  })();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let resolved: ResolvedDataset | null = null;
  let failure: { title: string; message: string; host: string | null; hint?: string } | null = null;

  try {
    resolved = await resolveDataset();
  } catch (error) {
    if (error instanceof LiveDataUnavailableError) {
      failure = {
        title: error.message,
        message: error.detail,
        host: error.host,
        hint:
          'Vital is running in live mode (VITAL_DATA_MODE=live), so no demo data is shown in its place. ' +
          'Check the data connection in Settings and that the server is reachable from this host, then retry.',
      };
    } else {
      throw error;
    }
  }

  const mode = resolved?.mode ?? 'live';
  const meta = resolved?.meta ?? FALLBACK_CLIENT_META;
  const dataset = resolved?.dataset ?? null;
  // Read server-side, per request: the greeting, the avatar and the briefing all
  // read one profile, and the browser never needs to fetch it to render. The
  // read is awaitable because the record may live in Postgres.
  const { profile, stored: profileStored } = await readProfileState();

  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <DatasetProvider mode={mode} dataset={dataset} meta={meta}>
          {/* Starts the server-backed settings sync (theme/units) and re-applies
              the theme when the server's value differs from this device's cache. */}
          <PrefsSync />
          <AppShell profile={profile} profileStored={profileStored}>
            {failure ? (
              <ConnectionErrorState
                title={failure.title}
                message={failure.message}
                host={failure.host}
                hint={failure.hint}
              />
            ) : (
              children
            )}
          </AppShell>
        </DatasetProvider>
      </body>
    </html>
  );
}

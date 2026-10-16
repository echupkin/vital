// ── Root Layout ───────────────────────────────────────
//
// Includes a blocking inline script that applies the cached theme before paint.
// Wraps all pages with AppShell (sidebar, topbar, mobile nav). In live mode with no
// readable source the shell is in setup mode instead: no navigation, Settings only.
//
// The layout is where the data mode is resolved, server-side and once per
// request: demo fixtures, or the live Health Auto Export history fetched,
// normalized and cached by the server. The browser never receives the API token
// and never calls the health API itself.
//
// The layout does not wait for that load: a cold one takes seconds. It hands
// it to `DatasetStream` as a promise, so the shell paints at once and each page
// streams in when its data is here (Settings renders straight away).
//
// `force-dynamic` is required: the live dataset must be read per request, not
// baked into a prerendered page at build time.

import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { DatasetStream, type LayoutData } from '@/components/data/DatasetStream';
import { LiveDataUnavailableError, knownSetupMode, resolveDataset } from '@/lib/adapters/runtime';
import { readProfileState } from '@/lib/profile/store';
import { readPreferencesState } from '@/lib/prefs/store';
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
  // Not awaited: the shell renders now, and the page streams in when this settles.
  const data: Promise<LayoutData> = loadLayoutData();
  // Read server-side, per request: the greeting, the avatar and the briefing all
  // read one profile, and the browser never needs to fetch it to render. The
  // read is awaitable because the record may live in Postgres.
  const { profile, stored: profileStored } = await readProfileState();
  // The display preferences too, so the first render already uses the reader's
  // units: starting on the default and switching after the device's cache is read
  // made every page that fetches by unit system fetch twice. Null when the store
  // could not be read; the browser's cache then decides, as before.
  const prefsState = await readPreferencesState().catch(() => null);
  const initialPrefs =
    prefsState && !prefsState.error ? { units: prefsState.preferences.units, theme: prefsState.preferences.theme } : null;

  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Starts the server-backed settings sync (theme/units) and re-applies
            the theme when the server's value differs from this device's cache. */}
        <PrefsSync />
        <DatasetStream
          data={data}
          initialSetupMode={await knownSetupMode()}
          profile={profile}
          profileStored={profileStored}
          initialPrefs={initialPrefs}
        >
          {children}
        </DatasetStream>
      </body>
    </html>
  );
}

/**
 * The dataset for this request, or the reason live mode has none (setup mode).
 * Any other failure rejects, and reaches the error page as before.
 */
async function loadLayoutData(): Promise<LayoutData> {
  try {
    const resolved = await resolveDataset();
    return { mode: resolved.mode, dataset: resolved.dataset, meta: resolved.meta, failure: null };
  } catch (error) {
    if (!(error instanceof LiveDataUnavailableError)) throw error;
    return {
      mode: 'live',
      dataset: null,
      meta: null,
      failure: {
        title: error.message,
        message: error.detail,
        host: error.host,
        hint:
          'Vital is running in live mode (VITAL_DATA_MODE=live), so no demo data is shown in its place. ' +
          'Check the data connection in Settings and that the server is reachable from this host, then retry.',
      },
    };
  }
}

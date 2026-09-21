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

import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { DatasetProvider } from '@/components/data/DatasetProvider';
import { ConnectionErrorState } from '@/components/data/ConnectionErrorState';
import { FALLBACK_CLIENT_META } from '@/components/data/fallback-meta';
import { LiveDataUnavailableError, resolveDataset, type ResolvedDataset } from '@/lib/adapters/runtime';
import { readProfile } from '@/lib/profile/store';
import { LEGACY_STORAGE_KEY, preferencesCacheKey } from '@/lib/prefs/types';
import PrefsSync from '@/components/prefs/PrefsSync';

export const metadata: Metadata = {
  title: 'Vital — Health Intelligence',
  description: 'Your health. Your data. Your intelligence.',
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
 */
const themeScript = `
  (function() {
    try {
      var raw = localStorage.getItem('${preferencesCacheKey()}') || localStorage.getItem('${LEGACY_STORAGE_KEY}');
      var theme = (JSON.parse(raw || '{}') || {}).theme || 'system';
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
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
          'Check that the Health Auto Export server is reachable from this host and that HAE_API_URL and ' +
          'HAE_API_KEY are set, then retry.',
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
  const profile = await readProfile();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <DatasetProvider mode={mode} dataset={dataset} meta={meta}>
          {/* Starts the server-backed settings sync (theme/units) and re-applies
              the theme when the server's value differs from this device's cache. */}
          <PrefsSync />
          <AppShell profile={profile}>
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

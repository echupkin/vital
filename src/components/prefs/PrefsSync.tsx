'use client';

// ── Preferences sync (client) ─────────────────────────────────────────────────
//
// Mounted once in the root layout. Its only job is to start the preferences
// engine: read the server record on mount, import a legacy localStorage value
// once, re-read when the window regains focus, and re-apply the theme whenever
// the settings change.
//
// It renders nothing. The theme is applied here rather than at first paint
// because the server's value can differ from this device's cache — the cache
// exists only to avoid a flash, and the server always wins.

import { useEffect } from 'react';
import { applyTheme, loadPreferences, startPreferencesSync, subscribePreferences } from '@/lib/prefs';

export default function PrefsSync() {
  useEffect(() => {
    const apply = () => {
      try {
        applyTheme(loadPreferences().theme);
      } catch {
        // A theme that cannot be applied is cosmetic: never break the page.
      }
    };

    // Applies the cached value immediately, then the engine's server read
    // replaces it if the two disagree.
    apply();
    startPreferencesSync();
    return subscribePreferences(apply);
  }, []);

  return null;
}

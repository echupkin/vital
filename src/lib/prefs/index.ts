// ── Preferences system (browser adapter) ──────────────────────────────────────
//
// The SERVER owns these settings. This module is the browser half: it builds one
// shared instance of the preferences engine (`./engine`), points it at
// `/api/preferences`, and re-exports the small API the rest of the app has always
// used (loadPreferences, savePreferences, applyTheme, PREFERENCES_EVENT).
//
// What changed and why: these values used to live in this browser's localStorage
// only, so a second browser or another device started from defaults. The server
// is now authoritative — the record lives in the Vital Postgres database when one
// is configured, and in a JSON file on the server when it is not.
//
// The local cache is still here, with one job: it lets the pre-paint script in
// `src/app/layout.tsx` apply the right theme before first paint instead of
// flashing the wrong one. It is namespaced by schema version, it is written from
// the server's record, and it can never override what the server says.
//
// The timezone is NOT here. It lives in the server-owned profile
// (`@/lib/profile`) so the client's window labelling and the server's day
// boundaries come from one value.
//
// SERVER-SIDE SAFETY: server routes import this module for its TYPES only. Every
// function below tolerates `window` being absent (SSR, tests) and degrades to
// defaults rather than throwing.

import {
  createPrefsEngine,
  type PreferencesState,
  type PrefsEngine,
  type SaveOutcome,
  type SyncStatus,
} from './engine';
import {
  DEFAULT_PREFERENCES,
  preferencesCacheKey,
  PREFS_SCHEMA_VERSION,
  type ThemeMode,
  type UnitSystem,
  type VitalPreferences,
} from './types';

export type { ThemeMode, UnitSystem } from './types';
export type {
  NotificationPreferences,
  PreferencesRecord,
  VitalPreferences,
} from './types';
export type { PreferencesState, SaveOutcome, SyncStatus };
export { DEFAULT_NOTIFICATIONS, DEFAULT_PREFERENCES } from './types';

/** Fired on window whenever the settings change, so live views re-render. */
export const PREFERENCES_EVENT = 'vital:preferences';

/** The namespaced cache key this browser keeps as a first-paint hint. */
export const STORAGE_KEY_NAME = preferencesCacheKey(PREFS_SCHEMA_VERSION);

/** The path the engine talks to. One place, so tests and code agree. */
export const PREFERENCES_ENDPOINT = '/api/preferences';

let engine: PrefsEngine | null = null;

/** The shared engine, created once per browser. Safe to call on the server. */
export function getPrefsEngine(): PrefsEngine {
  if (engine) return engine;
  engine = createPrefsEngine({
    getStorage: () => {
      try {
        if (typeof window === 'undefined') return null;
        return window.localStorage;
      } catch {
        // Private mode, disabled storage, or a sandboxed frame.
        return null;
      }
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => Date.now(),
    // Every state change is announced on the window so the existing consumers
    // (UnitsProvider, ThemeToggle, MetricChart, the Settings form) re-render
    // through the same event they have always listened for.
    onChange: () => {
      if (typeof window === 'undefined') return;
      try {
        window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT));
      } catch {
        // ignore
      }
    },
    onFocus: (cb) => {
      if (typeof window === 'undefined') return;
      window.addEventListener('focus', cb);
    },
  });
  return engine;
}

/**
 * Read the server once and pick changes up whenever the window regains focus, so
 * a second tab or a second device converges without a reload. Idempotent.
 */
export function startPreferencesSync(): void {
  getPrefsEngine().start();
}

/** The cached-or-default view, synchronously. For first paint and SSR. */
export function loadPreferences(): VitalPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFERENCES };
  return getPrefsEngine().loadPreferences();
}

/** The full state, for UI that shows sync status or a conflict. */
export function getPreferencesState(): PreferencesState {
  return getPrefsEngine().getState();
}

export function subscribePreferences(listener: () => void): () => void {
  return getPrefsEngine().subscribe(listener);
}

/** Read the server now (used by a "retry" control). Never throws. */
export function syncPreferences(): Promise<void> {
  return getPrefsEngine().sync();
}

/**
 * Save, reporting the outcome so the caller can be honest about it: a conflict
 * (the settings changed elsewhere), an unreachable server, or a rejected body.
 */
export function savePreferencesResult(prefs: VitalPreferences): Promise<SaveOutcome> {
  return getPrefsEngine().save(prefs);
}

/**
 * Fire-and-forget save, kept for callers that only need to send a change (the
 * theme toggle). The outcome is reported through the shared state.
 */
export function savePreferences(prefs: VitalPreferences): void {
  void savePreferencesResult(prefs);
}

/** Forget the local cache only. The server's record is untouched. */
export function clearPreferences(): void {
  getPrefsEngine().clearLocalCache();
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT));
    } catch {
      // ignore
    }
  }
}

/**
 * What this device keeps, described for the reader.
 *
 * It is now one cache entry, not five loose values: the server's record is the
 * real store, and this is the first-paint copy of it.
 */
export function describeStoredPreferences(prefs: VitalPreferences): { key: string; value: string }[] {
  return [{ key: STORAGE_KEY_NAME, value: JSON.stringify(prefs) }];
}

/** Apply a theme to the document. Unchanged behaviour; kept for callers. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
}

export { preferencesCacheKey, PREFS_SCHEMA_VERSION };
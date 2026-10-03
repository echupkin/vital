// ── Preferences system (browser adapter) ──────────────────────────────────────
//
// The SERVER owns these settings. This module is the browser half: it builds one
// shared instance of the preferences engine (`./engine`), points it at
// `/api/preferences`, and re-exports the small API the rest of the app has always
// used (loadPreferences, savePreferences, applyTheme, PREFERENCES_EVENT).
//
// What changed and why: these values used to live in this browser's localStorage
// only, so a second browser or another device started from defaults. The server
// is now authoritative — the record lives in the Vital Postgres database.
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
  type PrefsEngineDeps,
  type SaveOutcome,
  type SyncStatus,
} from './engine';
import {
  DEFAULT_PREFERENCES,
  preferencesCacheKey,
  PREFS_SCHEMA_VERSION,
  type UnitSystem,
  type VitalPreferences,
} from './types';
import { themeAttr, type ColorScheme } from './themes';

export type { ThemeMode, UnitSystem } from './types';
export type { ColorScheme, ThemeDef } from './themes';
export { DEFAULT_THEME_ID, THEMES, themeAttr, themesFor } from './themes';
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

/** The BroadcastChannel the tabs of one browser share preference saves on. */
export const PREFERENCES_TABS_CHANNEL = 'vital:preferences';

/** Other tabs of this browser, or undefined where BroadcastChannel is missing. */
function tabsChannel(): NonNullable<PrefsEngineDeps['tabs']> | undefined {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return undefined;
  try {
    const channel = new BroadcastChannel(PREFERENCES_TABS_CHANNEL);
    return {
      post: record => {
        try {
          channel.postMessage(record);
        } catch {
          // A tab that cannot post still saved; the others catch up on focus.
        }
      },
      listen: cb => channel.addEventListener('message', event => cb(event.data)),
    };
  } catch {
    return undefined;
  }
}

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
    // (UnitsProvider, the Themes page, MetricChart, the Settings form) re-render
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
    tabs: tabsChannel(),
  });
  return engine;
}

/**
 * Read the server once, follow saves made in this browser's other tabs as they
 * happen, and pick changes up whenever the window regains focus, so a second
 * device converges without a reload. Idempotent.
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

type ThemeChoice = Pick<VitalPreferences, 'theme' | 'lightTheme' | 'darkTheme'>;

/** True when the operating system asks for dark. False wherever it cannot be read. */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * The theme on show: the mode picks the side (the OS decides under `system`),
 * and that side's pick names the palette. `attr` is the `data-theme` value.
 */
export function resolveTheme(
  prefs: ThemeChoice,
  systemDark: boolean = systemPrefersDark()
): { scheme: ColorScheme; id: string; attr: string } {
  const scheme: ColorScheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  const id = scheme === 'dark' ? prefs.darkTheme : prefs.lightTheme;
  return { scheme, id, attr: themeAttr(scheme, id) };
}

/**
 * Apply the theme to the document: `data-theme` selects the palette in
 * globals.css, and the `dark` class keeps Tailwind's `dark:` variants working.
 * The browser's own chrome (the iOS status bar of the home-screen app, a mobile
 * browser's toolbar) is given the palette's page colour to match the top bar.
 */
export function applyTheme(prefs: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { scheme, attr } = resolveTheme(prefs);
  root.classList.toggle('dark', scheme === 'dark');
  root.dataset.theme = attr;
  syncThemeColor();
}

/**
 * The page colour of the palette on show, as the document's theme colour. The
 * layout's light and dark defaults cover the first paint; this tag comes first
 * in <head>, so it wins over them once a palette is applied.
 */
function syncThemeColor(): void {
  const page = getComputedStyle(document.documentElement).getPropertyValue('--color-page').trim();
  if (!page) return;
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-palette]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.dataset.palette = '';
    document.head.prepend(meta);
  }
  meta.content = page;
}

export { preferencesCacheKey, PREFS_SCHEMA_VERSION };
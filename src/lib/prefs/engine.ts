// ── Preferences sync engine (client) ────────────────────
//
// The server owns the preferences; this engine is the browser's read and write
// of them. It is written against injected dependencies (`storage`, `fetchImpl`,
// a clock) rather than globals, so the whole "server is authoritative" contract
// is testable offline with a fake server and a fake localStorage.
//
// Rules this engine exists to enforce:
//   * the SERVER is authoritative whenever a record exists (revision >= 1); the
//     local cache is only a display shortcut for the pre-paint theme and for
//     when the server cannot be reached. It never overrides a server value.
//   * a legacy `vital-prefs` value is imported exactly once, into an empty
//     server record, and the legacy key is then removed.
//   * a stale write is refused by the server (409); the conflict is surfaced,
//     never silently swallowed.
//   * an unreachable server is reported honestly, never faked as a save.
//
// Nothing here ever stores a health value, a token or a credential: the only
// thing written to storage is the namespaced display cache.

import {
  DEFAULT_PREFERENCES,
  LEGACY_STORAGE_KEY,
  PREFS_SCHEMA_VERSION,
  defaultPreferences,
  parseLegacyPreferences,
  preferencesCacheKey,
  validatePreferencesRecord,
  type PreferencesRecord,
  type VitalPreferences,
} from './types';

/** The minimum of the Storage API this engine needs. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SyncStatus = 'idle' | 'loading' | 'synced' | 'unsynced' | 'conflict';

export interface PreferencesConflict {
  /** What this device tried to save. */
  attempted: VitalPreferences;
  /** What the server holds instead. */
  current: VitalPreferences;
}

export interface PreferencesState {
  /** The current view. The server's value whenever the server has one. */
  preferences: VitalPreferences;
  /** The last server revision seen, or -1 when nothing has been read yet. */
  revision: number;
  status: SyncStatus;
  /** An honest, reader-facing sentence about a failure, or null. */
  message: string | null;
  conflict: PreferencesConflict | null;
  /** When the server last answered, for "Synced …" copy. Null before then. */
  lastSyncedAt: number | null;
}

export type SaveOutcome =
  | { ok: true }
  | { ok: false; reason: 'conflict' | 'unsynced' | 'rejected'; message: string };

export interface PrefsEngineDeps {
  /** The device store, resolved lazily. Null when there is none (SSR, node). */
  getStorage: () => PrefsStorage | null;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  /** Called after every state change, so live views can re-render. */
  onChange?: () => void;
  /** Register a callback for when the window regains focus. */
  onFocus?: (cb: () => void) => void;
}

export interface PrefsEngine {
  getState(): PreferencesState;
  subscribe(listener: () => void): () => void;
  /** The cached-or-default view, synchronously: for first paint and SSR. */
  loadPreferences(): VitalPreferences;
  /** Read the server, import a legacy value once, reconcile. Never throws. */
  sync(): Promise<void>;
  /** Apply a change locally and send it, revision-checked. Never throws. */
  save(next: VitalPreferences): Promise<SaveOutcome>;
  /** Forget the local cache only. The server's record is untouched. */
  clearLocalCache(): void;
  /** Read the server once and pick up changes when the window regains focus. */
  start(): void;
}

export const UNREACHABLE_MESSAGE =
  'The server could not be reached, so these settings are shown from the cache on this device and may be out of date. Nothing else was changed.';

export function createPrefsEngine(deps: PrefsEngineDeps): PrefsEngine {
  const listeners = new Set<() => void>();
  let started = false;

  function decodeCache(raw: string | null): VitalPreferences | null {
    if (raw === null) return null;
    // The cache carries the same five display fields; the tolerant legacy
    // reader validates each one and ignores anything else (no schema plumbing
    // can ever be mistaken for data here).
    return parseLegacyPreferences(raw);
  }

  function readCache(): VitalPreferences | null {
    try {
      return decodeCache(deps.getStorage()?.getItem(preferencesCacheKey()) ?? null);
    } catch {
      return null;
    }
  }

  function writeCache(prefs: VitalPreferences): void {
    try {
      deps.getStorage()?.setItem(
        preferencesCacheKey(),
        JSON.stringify({ ...prefs, schemaVersion: PREFS_SCHEMA_VERSION })
      );
    } catch {
      // A full or disabled store must never break the app.
    }
  }

  function emit(): void {
    for (const listener of listeners) listener();
    deps.onChange?.();
  }

  let state: PreferencesState = {
    preferences: readCache() ?? defaultPreferences(),
    revision: -1,
    status: 'idle',
    message: null,
    conflict: null,
    lastSyncedAt: null,
  };

  function setState(patch: Partial<PreferencesState>): void {
    state = { ...state, ...patch };
    emit();
  }

  function readRecord(payload: unknown): PreferencesRecord | null {
    const validated = validatePreferencesRecord(payload);
    return validated.ok ? validated.value : null;
  }

  async function request(input: string, init?: RequestInit): Promise<Response> {
    return deps.fetchImpl(input, init);
  }

  type PutResult =
    | { kind: 'ok'; record: PreferencesRecord }
    | { kind: 'conflict'; current: VitalPreferences; message: string }
    | { kind: 'rejected'; message: string };

  async function put(prefs: VitalPreferences, revision: number): Promise<PutResult> {
    let res: Response;
    try {
      res = await request('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prefs, revision }),
        cache: 'no-store',
      });
    } catch (error) {
      return {
        kind: 'rejected',
        message: error instanceof Error ? error.message : UNREACHABLE_MESSAGE,
      };
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const body = (payload ?? {}) as Record<string, unknown>;

    if (res.status === 409) {
      const currentRecord = readRecord(body.preferences);
      return {
        kind: 'conflict',
        current: currentRecord ? stripRecord(currentRecord) : defaultPreferences(),
        message:
          typeof body.error === 'string' ? body.error : 'These settings were changed somewhere else.',
      };
    }

    if (!res.ok) {
      return {
        kind: 'rejected',
        message:
          typeof body.error === 'string'
            ? body.error
            : `The preferences endpoint answered HTTP ${res.status}.`,
      };
    }

    const record = readRecord(payload);
    if (!record) {
      return { kind: 'rejected', message: 'The server returned an unrecognised preferences record.' };
    }
    return { kind: 'ok', record };
  }

  function stripRecord(record: PreferencesRecord): VitalPreferences {
    return {
      theme: record.theme,
      units: record.units,
      notifications: { ...record.notifications },
    };
  }

  /** Adopt a stored record wholesale: the server's value is what is shown. */
  function adopt(record: PreferencesRecord): void {
    writeCache(stripRecord(record));
    setState({
      preferences: stripRecord(record),
      revision: record.revision,
      status: 'synced',
      message: null,
      conflict: null,
      lastSyncedAt: deps.now(),
    });
  }

  /**
   * Import a legacy `vital-prefs` value once. Returns true when the server now
   * holds an imported record. The legacy key is removed only after a successful
   * write, so a failed import is retried rather than silently lost.
   */
  async function importLegacy(): Promise<boolean> {
    let raw: string | null;
    try {
      raw = deps.getStorage()?.getItem(LEGACY_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (raw === null) return false;

    const legacy = parseLegacyPreferences(raw);
    if (!legacy) {
      // Unreadable: it can never import, so it must not be re-read forever.
      try {
        deps.getStorage()?.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // ignore
      }
      return false;
    }

    const result = await put(legacy, 0);
    if (result.kind !== 'ok') return false;

    try {
      deps.getStorage()?.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    adopt(result.record);
    return true;
  }

  async function sync(): Promise<void> {
    if (state.lastSyncedAt === null && state.status !== 'conflict') {
      setState({ status: 'loading' });
    }

    let record: PreferencesRecord | null = null;
    try {
      const res = await request('/api/preferences', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The preferences endpoint answered HTTP ${res.status}.`);
      record = readRecord(await res.json());
      if (!record) throw new Error('The server returned an unrecognised preferences record.');
    } catch (error) {
      setState({
        status: 'unsynced',
        message: `${UNREACHABLE_MESSAGE} ${
          error instanceof Error ? error.message : ''
        }`.trim(),
        conflict: null,
      });
      return;
    }

    if (record.revision === 0) {
      // The server holds no record yet: a legacy browser value, if any, is
      // imported once. With no legacy value the cached display stands in until
      // the reader changes something, and the first write creates the record.
      if (await importLegacy()) return;
      setState({ revision: 0, status: 'synced', message: null, conflict: null, lastSyncedAt: deps.now() });
      return;
    }

    adopt(record);
  }

  async function save(next: VitalPreferences): Promise<SaveOutcome> {
    const target: VitalPreferences = {
      theme: next.theme,
      units: next.units,
      notifications: { ...next.notifications },
    };

    // Apply locally first so the UI (and the theme) respond immediately, and
    // keep the cache honest about what is displayed on this device.
    writeCache(target);
    setState({ preferences: target, conflict: null });

    // An edit before the first read: learn the server revision first.
    if (state.revision < 0) await sync();
    if (state.revision < 0) {
      setState({ status: 'unsynced', message: UNREACHABLE_MESSAGE });
      return { ok: false, reason: 'unsynced', message: UNREACHABLE_MESSAGE };
    }

    const result = await put(target, state.revision);
    if (result.kind === 'ok') {
      adopt(result.record);
      return { ok: true };
    }
    if (result.kind === 'conflict') {
      // Show what the server actually holds and ask the reader to re-apply;
      // the rejected attempt is kept so the UI can offer it back.
      writeCache(result.current);
      setState({
        preferences: result.current,
        status: 'conflict',
        message: result.message,
        conflict: { attempted: target, current: result.current },
      });
      return { ok: false, reason: 'conflict', message: result.message };
    }

    setState({
      status: 'unsynced',
      message: `${UNREACHABLE_MESSAGE} ${result.message}`.trim(),
    });
    return { ok: false, reason: 'unsynced', message: result.message };
  }

  function clearLocalCache(): void {
    try {
      deps.getStorage()?.removeItem(preferencesCacheKey());
    } catch {
      // ignore
    }
    emit();
  }

  function start(): void {
    if (started) return;
    started = true;
    void sync();
    deps.onFocus?.(() => {
      void sync();
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadPreferences: () => state.preferences,
    sync,
    save,
    clearLocalCache,
    start,
  };
}

/** A fresh, engine-shaped default for tests and for the SSR fallback. */
export const DEFAULT_STATE_PREFERENCES = DEFAULT_PREFERENCES;

// ── Preferences store (SERVER-ONLY) ─────────────────────
//
// WHERE the display preferences live depends on the deployment, and this module
// is the one place that decides:
//
//   * a Postgres database is configured → the `preferences` row (see
//     `@/lib/db/preferences-store`). This is the deployment docker-compose ships.
//   * nothing configured                → a JSON file the SERVER owns, on the
//     same writable volume as the profile:
//         host        ./data/preferences.json
//         container   /app/data/preferences.json     (docker-compose mounts ./data)
//
// Both backends serve the same `PreferencesRecord`, so `/api/preferences` and
// the browser sync engine do not know which one is active.
//
// Read paths (either backend)
//   * no record at all    → the documented defaults at revision 0, never a
//                           crash. Revision 0 means "no record has been written
//                           yet", which is also what tells the client it may
//                           import a legacy browser value once.
//   * unreadable/corrupt  → the same defaults, with the problem reported to the
//                           caller (`readPreferencesState`) so Settings can say
//                           so rather than pretend the record was fine — and so
//                           a broken database is reported as an error instead of
//                           being shown to the reader as "your settings reset".
//   * valid record        → the stored record, re-validated on the way in, so a
//                           hand-edited file or row cannot inject an unknown
//                           field, a wrong type or an unknown schema version.
//
// The file is tiny (<1 kB), so file writes are synchronous and atomic — a temp
// file is renamed over the target — so a crash mid-write can never leave a
// truncated preferences.json behind. A database write is a single upsert at the
// revision the caller supplies.
//
// Nothing here logs or returns a secret; the record has no secret field.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  PREFS_SCHEMA_VERSION,
  defaultPreferencesRecord,
  validatePreferencesInput,
  validatePreferencesRecord,
  type PreferencesRecord,
  type VitalPreferences,
} from './types';
import { resolveBackend } from '@/lib/db/backend';
import { readPreferencesRow, writePreferencesRow } from '@/lib/db/preferences-store';

/** Which backend answered. */
export type PreferencesBackend = 'postgres' | 'files';

/** Where the preferences are read from and written to (file backend only). */
export function preferencesFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VITAL_PREFERENCES_PATH?.trim();
  if (override) return override;
  return join(process.cwd(), 'data', 'preferences.json');
}

export interface PreferencesState {
  preferences: PreferencesRecord;
  /** True when the record exists, parsed and validated. */
  stored: boolean;
  /** Which backend the record came from. */
  backend: PreferencesBackend;
  /** Where the record lives: the file path, or the redacted database target. */
  path: string;
  /** A problem reading the record, when there was one. Never thrown. */
  error: string | null;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The JSON-file backend. Synchronous: the file is under a kilobyte. */
export function readPreferencesFileState(env: NodeJS.ProcessEnv = process.env): PreferencesState {
  const path = preferencesFilePath(env);
  const defaults = defaultPreferencesRecord();
  const base = { backend: 'files' as const, path };

  let raw: string;
  try {
    if (!existsSync(path)) {
      return { preferences: defaults, stored: false, ...base, error: null };
    }
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      preferences: defaults,
      stored: false,
      ...base,
      error: messageOf(error, 'The preferences file could not be read.'),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { preferences: defaults, stored: false, ...base, error: 'The preferences file is not valid JSON.' };
  }

  const validated = validatePreferencesRecord(parsed);
  if (!validated.ok) {
    return {
      preferences: defaults,
      stored: false,
      ...base,
      error: `The preferences file is not a valid record: ${validated.errors.join(' ')}`,
    };
  }
  return { preferences: validated.value, stored: true, ...base, error: null };
}

/**
 * Read the preferences from whichever backend is configured, reporting how they
 * were obtained. Never throws for a backend problem; the route turns a reported
 * error into a 500 rather than serving defaults as if they were stored.
 */
export async function readPreferencesState(
  env: NodeJS.ProcessEnv = process.env
): Promise<PreferencesState> {
  let backend;
  try {
    backend = resolveBackend(env);
  } catch (error) {
    return {
      preferences: defaultPreferencesRecord(),
      stored: false,
      backend: 'files',
      path: preferencesFilePath(env),
      error: messageOf(error, 'The Postgres configuration could not be resolved.'),
    };
  }

  if (backend.kind === 'files') return readPreferencesFileState(env);

  const path = backend.target ?? 'postgres';
  try {
    const record = await readPreferencesRow(env);
    if (!record) {
      // ── One-time import ────────────────────────────────────────────────────
      // The database is authoritative and empty. Adopt the JSON file this
      // deployment used before the database existed rather than answering with
      // defaults, which would read to the owner as "my settings were reset".
      // Idempotent: the row written here is found on every later read.
      const adopted = await adoptPreferencesFile(env);
      if (adopted) return adopted;
      return { preferences: defaultPreferencesRecord(), stored: false, backend: 'postgres', path, error: null };
    }
    return { preferences: record, stored: true, backend: 'postgres', path, error: null };
  } catch (error) {
    return {
      preferences: defaultPreferencesRecord(),
      stored: false,
      backend: 'postgres',
      path,
      error: messageOf(error, 'The preferences could not be read from the database.'),
    };
  }
}

/**
 * Adopt the JSON preferences file into an empty database, exactly once.
 *
 * Failures are swallowed: this runs on the read path, where defaults plus the
 * file still on disk is a better answer than a 500 that takes the page down.
 */
async function adoptPreferencesFile(env: NodeJS.ProcessEnv): Promise<PreferencesState | null> {
  try {
    const fileState = readPreferencesFileState(env);
    if (!fileState.stored || fileState.error) return null;
    const record = await writePreferences(fileState.preferences, fileState.preferences.revision + 1, env);
    return { preferences: record, stored: true, backend: 'postgres', path: 'postgres', error: null };
  } catch {
    return null;
  }
}

/** The stored record, or the documented defaults. Never throws. */
export async function readPreferences(env: NodeJS.ProcessEnv = process.env): Promise<PreferencesRecord> {
  return (await readPreferencesState(env)).preferences;
}

/**
 * Write a record. The caller supplies the display choices and the next revision;
 * the schema version is owned by `./types`, and the timestamp by the database
 * (or by this process for the file backend).
 *
 * Throws with a safe, actionable message when the record cannot be written.
 */
export async function writePreferences(
  preferences: VitalPreferences,
  revision: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<PreferencesRecord> {
  const backend = resolveBackend(env);

  if (backend.kind === 'postgres') {
    return writePreferencesRow(preferences, revision, env);
  }

  const record: PreferencesRecord = {
    theme: preferences.theme,
    units: preferences.units,
    notifications: { ...preferences.notifications },
    schemaVersion: PREFS_SCHEMA_VERSION,
    revision,
    updatedAt: new Date().toISOString(),
  };

  // Round-trip through the same validator a read uses, so a record can never be
  // written in a shape this build would later refuse to read.
  const validated = validatePreferencesRecord(record);
  if (!validated.ok) {
    throw new Error(`Refusing to write an invalid preferences record: ${validated.errors.join(' ')}`);
  }

  const path = preferencesFilePath(env);
  const dir = dirname(path);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(validated.value, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    throw new Error(
      `The preferences could not be written to ${path}: ${messageOf(
        error,
        'unknown error'
      )}. The directory must be writable by the server process.`
    );
  }
  return validated.value;
}

/**
 * Validate an incoming PUT body and, when it is valid, describe the write it
 * asks for. Pure: it touches no store, so the route can decide what to do with a
 * stale revision before anything is changed anywhere.
 */
export function planPreferencesWrite(
  raw: unknown
): { ok: true; preferences: VitalPreferences; clientRevision: number } | { ok: false; errors: string[] } {
  const validated = validatePreferencesInput(raw);
  if (!validated.ok) return validated;
  return {
    ok: true,
    preferences: validated.value.preferences,
    clientRevision: validated.value.revision,
  };
}

// ── Preferences store (SERVER-ONLY) ─────────────────────
//
// The display preferences live in Postgres, and Postgres is the ONLY backend:
//
//   * a Postgres database is configured → the `preferences` row (see
//     `@/lib/db/preferences-store`). This is the deployment docker-compose ships.
//   * nothing configured                → `readPreferencesState` reports the
//     reason (`error`), and `writePreferences` throws it. There is deliberately
//     no JSON-file substitute.
//
// Both backends serve the same `PreferencesRecord`, so `/api/preferences` and
// the browser sync engine do not care how it is stored.
//
// Read paths
//   * no row at all      → the documented defaults at revision 0, never a crash.
//                          Revision 0 means "no record has been written yet",
//                          which is also what tells the client it may import a
//                          legacy browser value once.
//   * unreadable/invalid → the same defaults, with the problem reported to the
//                          caller (`readPreferencesState`) so a broken database
//                          is reported as an error instead of being shown to the
//                          reader as "your settings reset".
//   * valid row          → the stored record, re-validated on the way in, so a
//                          hand-edited row cannot inject an unknown field, a
//                          wrong type or an unknown schema version.
//
// A database write is a single upsert at the revision the caller supplies. The
// record is round-tripped through the same validator a read uses before it is
// written, so a record can never be stored in a shape this build would later
// refuse to read.
//
// Nothing here logs or returns a secret; the record has no secret field.

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

/** Which backend answered. Postgres is the only one. */
export type PreferencesBackend = 'postgres';

export interface PreferencesState {
  preferences: PreferencesRecord;
  /** True when the record exists, parsed and validated. */
  stored: boolean;
  /** Which backend the record came from. Always `postgres`. */
  backend: PreferencesBackend;
  /** Where the record lives: the redacted database target. */
  path: string;
  /** A problem reading the record, when there was one. Never thrown. */
  error: string | null;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Read the preferences from Postgres, reporting how they were obtained. Never
 * throws for a backend problem; the route turns a reported error into a 500
 * rather than serving defaults as if they were stored.
 */
export async function readPreferencesState(
  env: NodeJS.ProcessEnv = process.env
): Promise<PreferencesState> {
  let target: string;
  try {
    target = resolveBackend(env).target;
  } catch (error) {
    return {
      preferences: defaultPreferencesRecord(),
      stored: false,
      backend: 'postgres',
      path: 'postgres',
      error: messageOf(error, 'The Postgres configuration could not be resolved.'),
    };
  }

  try {
    const record = await readPreferencesRow(env);
    if (!record) {
      return {
        preferences: defaultPreferencesRecord(),
        stored: false,
        backend: 'postgres',
        path: target,
        error: null,
      };
    }
    return { preferences: record, stored: true, backend: 'postgres', path: target, error: null };
  } catch (error) {
    return {
      preferences: defaultPreferencesRecord(),
      stored: false,
      backend: 'postgres',
      path: target,
      error: messageOf(error, 'The preferences could not be read from the database.'),
    };
  }
}

/** The stored record, or the documented defaults. Never throws. */
export async function readPreferences(env: NodeJS.ProcessEnv = process.env): Promise<PreferencesRecord> {
  return (await readPreferencesState(env)).preferences;
}

/**
 * Write a record. The caller supplies the display choices and the next revision;
 * the schema version is owned by `./types`, and the timestamp by the database.
 *
 * Throws with a safe, actionable message when there is no database configured,
 * the configuration is invalid, or the write fails. There is no file to fall
 * back to.
 */
export async function writePreferences(
  preferences: VitalPreferences,
  revision: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<PreferencesRecord> {
  // Round-trip through the same validator a read uses, so a record can never be
  // written in a shape this build would later refuse to read.
  const validated = validatePreferencesRecord({
    theme: preferences.theme,
    units: preferences.units,
    notifications: { ...preferences.notifications },
    schemaVersion: PREFS_SCHEMA_VERSION,
    revision,
    updatedAt: new Date().toISOString(),
  });
  if (!validated.ok) {
    throw new Error(`Refusing to write an invalid preferences record: ${validated.errors.join(' ')}`);
  }

  return writePreferencesRow(preferences, revision, env);
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

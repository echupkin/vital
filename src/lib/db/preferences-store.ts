// ── Preferences store: Postgres (SERVER ONLY) ────────────
//
// The database half of the preferences store. It serves and replaces the same
// record `@/lib/prefs/store` serves from JSON, so `/api/preferences` does not
// know which backend is active:
//
//   database configured → this module
//   nothing configured  → ./data/preferences.json
//
// One row, pinned to `id = 1` by the schema's CHECK constraint. Every write
// carries the revision the client last read; the caller compares it with the
// stored revision before calling in, and a stale write is refused upstream (409).
//
// DISPLAY CONFIGURATION ONLY: a unit system, a theme and three booleans. There
// is no column for a health record, a token or a credential, and no query here
// can read one.
//
// The record is validated with the same `validatePreferencesRecord` the client
// uses, so a hand-edited row cannot inject an unknown field or a schema version
// this build does not understand. Nothing logs or returns a secret.

import {
  PREFS_SCHEMA_VERSION,
  validatePreferencesRecord,
  type PreferencesRecord,
  type VitalPreferences,
} from '@/lib/prefs/types';
import { getPool } from './pool';

const SELECT_PREFERENCES = `
  SELECT units,
         theme,
         notifications,
         schema_version,
         revision,
         updated_at
    FROM preferences
   WHERE id = 1
`;

const UPSERT_PREFERENCES = `
  INSERT INTO preferences (id, units, theme, notifications, schema_version, revision, updated_at)
  VALUES (1, $1, $2, $3::jsonb, $4, $5, now())
  ON CONFLICT (id) DO UPDATE
     SET units          = EXCLUDED.units,
         theme          = EXCLUDED.theme,
         notifications  = EXCLUDED.notifications,
         schema_version = EXCLUDED.schema_version,
         revision       = EXCLUDED.revision,
         updated_at     = now()
  RETURNING units, theme, notifications, schema_version, revision, updated_at
`;

function poolOrThrow(env: NodeJS.ProcessEnv) {
  const pool = getPool(env);
  if (!pool) {
    throw new Error(
      'No Postgres database is configured, so the preferences are not in a database. ' +
        'Configure DATABASE_URL or the VITAL_PG_* variables, or use the file store.'
    );
  }
  return pool;
}

/** Turn a database row (or a hand-edited one) into a validated record. */
function toRecord(row: Record<string, unknown>): PreferencesRecord {
  const validated = validatePreferencesRecord({
    theme: row.theme,
    units: row.units,
    notifications: row.notifications ?? {},
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  });
  if (!validated.ok) {
    throw new Error(`The stored preferences row is not a valid record: ${validated.errors.join(' ')}`);
  }
  return validated.value;
}

/** The stored record, or `null` when no record has ever been written. */
export async function readPreferencesRow(env: NodeJS.ProcessEnv = process.env): Promise<PreferencesRecord | null> {
  const pool = poolOrThrow(env);
  const result = await pool.query(SELECT_PREFERENCES);
  const row = result.rows[0];
  if (!row) return null;
  return toRecord(row);
}

/** Replace the whole record at the given revision. */
export async function writePreferencesRow(
  preferences: VitalPreferences,
  revision: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<PreferencesRecord> {
  const pool = poolOrThrow(env);
  const result = await pool.query(UPSERT_PREFERENCES, [
    preferences.units,
    preferences.theme,
    JSON.stringify(preferences.notifications),
    PREFS_SCHEMA_VERSION,
    revision,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('The preferences write returned no row.');
  return toRecord(row);
}

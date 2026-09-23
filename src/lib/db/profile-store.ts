// ── Profile store: Postgres (SERVER ONLY) ────────────────
//
// The database half of the profile store. It implements the same record the
// JSON file store does (`./data/profile.json`, see `@/lib/profile/store`), so
// the caller cannot tell which backend is active:
//
//   database configured → this module
//   nothing configured  → the JSON file
//
// One row, pinned to `id = 1` by the schema's CHECK constraint. The row carries
// the same six fields plus the bookkeeping the file never had: `revision`,
// bumped by the database on every write, and `updated_at`.
//
// CONFIGURATION ONLY. The profile holds a display name, a birth date, the
// person's sex, a short note, the IANA timezone and the briefing hour. There is
// no column for a health observation and no query here can read one.
//
// Reads and writes are still validated on the way in and out with the same
// `validateProfileInput` the route uses, so a hand-typed `INSERT` cannot smuggle
// in an unknown shape. Nothing logs or returns a secret: the profile has none.

import { validateProfileInput, type VitalProfile } from '@/lib/profile/types';
import { getPool } from './pool';

/** The record shape the application record has; mirrors the file store's version. */
export const PROFILE_SCHEMA_VERSION = 1;

export interface StoredProfileRow {
  profile: VitalProfile;
  /** Bumped by the database on every write. Starts at 1 on the first write. */
  revision: number;
  updatedAt: string;
}

// `to_char` rather than the raw DATE: node-postgres parses a DATE into a JS
// Date at LOCAL midnight, which shifts the calendar day by one near midnight in
// a negative-offset zone. The ISO string the API serves is what the app means.
const SELECT_PROFILE = `
  SELECT name,
         to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         sex,
         notes,
         timezone,
         briefing_hour,
         revision,
         updated_at
    FROM profile
   WHERE id = 1
`;

const UPSERT_PROFILE = `
  INSERT INTO profile (id, name, date_of_birth, sex, notes, timezone, briefing_hour, schema_version, revision, updated_at)
  VALUES (1, $1, $2, $3, $4, $5, $6, ${PROFILE_SCHEMA_VERSION}, 1, now())
  ON CONFLICT (id) DO UPDATE
     SET name           = EXCLUDED.name,
         date_of_birth  = EXCLUDED.date_of_birth,
         sex            = EXCLUDED.sex,
         notes          = EXCLUDED.notes,
         timezone       = EXCLUDED.timezone,
         briefing_hour  = EXCLUDED.briefing_hour,
         schema_version = EXCLUDED.schema_version,
         revision       = profile.revision + 1,
         updated_at     = now()
  RETURNING revision, updated_at
`;

function poolOrThrow(env: NodeJS.ProcessEnv) {
  const pool = getPool(env);
  if (!pool) {
    throw new Error(
      'No Postgres database is configured, so the profile is not in a database. ' +
        'Configure DATABASE_URL or the VITAL_PG_* variables, or use the file store.'
    );
  }
  return pool;
}

/** The stored row, or `null` when no row has ever been written. Throws when the
 *  database is not configured, unreachable, or the row is not a valid profile. */
export async function readProfileRow(env: NodeJS.ProcessEnv = process.env): Promise<StoredProfileRow | null> {
  const pool = poolOrThrow(env);
  const result = await pool.query(SELECT_PROFILE);
  const row = result.rows[0];
  if (!row) return null;

  const validated = validateProfileInput({
    name: row.name ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    sex: row.sex ?? null,
    notes: row.notes ?? null,
    timezone: row.timezone,
    briefingHour: row.briefing_hour,
  });
  if (!validated.ok) {
    throw new Error(`The stored profile row is not a valid profile: ${validated.errors.join(' ')}`);
  }
  return {
    profile: validated.profile,
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** Replace the whole row. `revision` is bumped and `updated_at` set by Postgres. */
export async function writeProfileRow(
  profile: VitalProfile,
  env: NodeJS.ProcessEnv = process.env
): Promise<StoredProfileRow> {
  const validated = validateProfileInput(profile);
  if (!validated.ok) {
    throw new Error(`Refusing to write an invalid profile: ${validated.errors.join(' ')}`);
  }
  const p = validated.profile;
  const pool = poolOrThrow(env);
  const result = await pool.query(UPSERT_PROFILE, [
    p.name,
    p.dateOfBirth,
    p.sex,
    p.notes,
    p.timezone,
    p.briefingHour,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('The profile write returned no row.');
  return {
    profile: p,
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

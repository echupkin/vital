// ── Profile store (SERVER-ONLY) ─────────────────────────
//
// The profile lives in Postgres, and Postgres is the ONLY backend:
//
//   * a Postgres database is configured → the `profile` row (see
//     `@/lib/db/profile-store`). This is the deployment docker-compose ships.
//   * nothing configured                → `readProfileState` reports the reason
//     (`error`), and `writeProfile` throws it. Settings turns the reported
//     error into a 500 rather than pretending a write happened, and there is
//     deliberately no JSON-file substitute.
//
// Read paths
//   * no row at all      → the documented defaults, never a crash. This is
//                          first-run behaviour and it is deliberate: the API can
//                          still answer before the owner has saved anything.
//   * unreadable/invalid → the same defaults, with the problem reported to the
//                          caller (`readProfileState`) so Settings can say so
//                          rather than pretend the record was fine, and so the
//                          API route turns it into a 500 instead of serving
//                          defaults as "your profile".
//   * valid row          → the stored profile, re-validated on the way in, so a
//                          hand-edited row cannot inject an unknown field or an
//                          out-of-range hour.
//
// Writes: one upsert that bumps `revision` and `updated_at` in the database.
//
// Nothing here logs or returns a secret; the profile has no secret field.

import {
  DEFAULT_BRIEFING_HOUR,
  DEFAULT_PROFILE_TIMEZONE,
  isTimezone,
  type VitalProfile,
} from './types';
import { resolveBackend } from '@/lib/db/backend';
import { readProfileRow, writeProfileRow } from '@/lib/db/profile-store';

/** Which backend answered. Postgres is the only one. */
export type ProfileBackend = 'postgres';

export interface ProfileState {
  profile: VitalProfile;
  /** True when the record exists, parsed and validated. */
  stored: boolean;
  /** Which backend the record came from. Always `postgres`. */
  backend: ProfileBackend;
  /** Where the record lives: the redacted database target. */
  path: string;
  /** Bumped on every database write; 0 when no row has been written. */
  revision: number;
  /** When the database row was last written, or null when there is none. */
  updatedAt: string | null;
  /** A problem reading the record, when there was one. Never thrown. */
  error: string | null;
}

function defaultsFor(env: NodeJS.ProcessEnv): VitalProfile {
  const tz = env.VITAL_TIMEZONE?.trim();
  return {
    name: null,
    dateOfBirth: null,
    sex: null,
    notes: null,
    timezone: tz && isTimezone(tz) ? tz : DEFAULT_PROFILE_TIMEZONE,
    briefingHour: DEFAULT_BRIEFING_HOUR,
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Read the profile from Postgres and report how it was obtained.
 *
 * Never throws for a backend problem: an unconfigured database, an unreadable
 * row or an invalid row yields the defaults with `stored: false` and a (safe)
 * reason, which the API route turns into a 500 rather than serving a wrong
 * answer quietly.
 */
export async function readProfileState(env: NodeJS.ProcessEnv = process.env): Promise<ProfileState> {
  let target: string;
  try {
    target = resolveBackend(env).target;
  } catch (error) {
    return {
      profile: defaultsFor(env),
      stored: false,
      backend: 'postgres',
      path: 'postgres',
      revision: 0,
      updatedAt: null,
      error: messageOf(error, 'The Postgres configuration could not be resolved.'),
    };
  }

  try {
    const row = await readProfileRow(env);
    if (!row) {
      return {
        profile: defaultsFor(env),
        stored: false,
        backend: 'postgres',
        path: target,
        revision: 0,
        updatedAt: null,
        error: null,
      };
    }
    return {
      profile: row.profile,
      stored: true,
      backend: 'postgres',
      path: target,
      revision: row.revision,
      updatedAt: row.updatedAt,
      error: null,
    };
  } catch (error) {
    return {
      profile: defaultsFor(env),
      stored: false,
      backend: 'postgres',
      path: target,
      revision: 0,
      updatedAt: null,
      error: messageOf(error, 'The profile could not be read from the database.'),
    };
  }
}

/** The profile, or the documented defaults. Never throws. */
export async function readProfile(env: NodeJS.ProcessEnv = process.env): Promise<VitalProfile> {
  return (await readProfileState(env)).profile;
}

/**
 * Write the profile to Postgres.
 *
 * A failure throws with the reason — no database configured, an invalid
 * configuration, or a database error — the route reports it as a 500 and the
 * reader is told, rather than being shown a save that did not happen. There is
 * no file to fall back to.
 */
export async function writeProfile(
  profile: VitalProfile,
  env: NodeJS.ProcessEnv = process.env
): Promise<ProfileState> {
  const backend = resolveBackend(env);
  const row = await writeProfileRow(profile, env);
  return {
    profile: row.profile,
    stored: true,
    backend: 'postgres',
    path: backend.target,
    revision: row.revision,
    updatedAt: row.updatedAt,
    error: null,
  };
}

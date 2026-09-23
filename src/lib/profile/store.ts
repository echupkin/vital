// ── Profile store (SERVER-ONLY) ─────────────────────────
//
// WHERE the profile lives depends on the deployment, and this module is the one
// place that decides:
//
//   * a Postgres database is configured → the `profile` row (see
//     `@/lib/db/profile-store`). This is the deployment docker-compose ships.
//   * nothing configured                → a JSON file the SERVER owns, on a
//     writable volume:
//         host        ./data/profile.json
//         container   /app/data/profile.json      (docker-compose mounts ./data)
//
// Both backends serve the same `VitalProfile`, so no caller cares which one is
// active — they only have to await, because a database read is I/O.
//
// Read paths (either backend)
//   * no record at all    → the documented defaults, never a crash. This is
//                           first-run behaviour and it is deliberate: an
//                           unconfigured app must still start and serve.
//   * unreadable/corrupt  → the same defaults, with the problem reported to the
//                           caller (`readProfileState`) so Settings can say so
//                           rather than pretend the record was fine. A
//                           configured database that cannot be read is reported
//                           the same way, and the API route turns it into a 500
//                           instead of serving defaults as "your profile".
//   * valid record        → the stored profile, re-validated on the way in, so a
//                           hand-edited file or row cannot inject an unknown
//                           field or an out-of-range hour.
//
// Writes: the file is tiny (<1 kB) so file writes are synchronous and atomic (a
// temp file renamed over the target — a crash mid-write can never leave a
// truncated profile.json behind). A database write is one upsert that bumps
// `revision` and `updated_at` in the database.
//
// Nothing here logs or returns a secret; the profile has no secret field.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  DEFAULT_BRIEFING_HOUR,
  DEFAULT_PROFILE_TIMEZONE,
  isTimezone,
  validateProfileInput,
  type VitalProfile,
} from './types';
import { resolveBackend } from '@/lib/db/backend';
import { readProfileRow, writeProfileRow } from '@/lib/db/profile-store';

/** Which backend answered. */
export type ProfileBackend = 'postgres' | 'files';

export interface ProfileState {
  profile: VitalProfile;
  /** True when the record exists, parsed and validated. */
  stored: boolean;
  /** Which backend the record came from. */
  backend: ProfileBackend;
  /** Where the record lives: the file path, or the redacted database target. */
  path: string;
  /** Bumped on every database write; 0 when no row has been written. The file
   *  store keeps no revisions, so it always reports 0. */
  revision: number;
  /** When the database row was last written. Null for the file store. */
  updatedAt: string | null;
  /** A problem reading the record, when there was one. Never thrown. */
  error: string | null;
}

/** Where the profile is read from and written to (file backend only). */
export function profileFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VITAL_PROFILE_PATH?.trim();
  if (override) return override;
  return join(process.cwd(), 'data', 'profile.json');
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
 * The JSON-file backend. Synchronous: the file is under a kilobyte, and the
 * briefing read path is deliberately synchronous (it never awaits a model).
 */
export function readProfileFileState(env: NodeJS.ProcessEnv = process.env): ProfileState {
  const path = profileFilePath(env);
  const defaults = defaultsFor(env);
  const base = { backend: 'files' as const, path, revision: 0, updatedAt: null };

  let raw: string;
  try {
    if (!existsSync(path)) {
      return { profile: defaults, stored: false, ...base, error: null };
    }
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return { profile: defaults, stored: false, ...base, error: messageOf(error, 'The profile file could not be read.') };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { profile: defaults, stored: false, ...base, error: 'The profile file is not valid JSON.' };
  }

  // Re-validate on the way in: the same rules the route enforces on write, so a
  // hand-edited file cannot smuggle in an unknown field or an out-of-range hour.
  const validated = validateProfileInput(parsed);
  if (!validated.ok) {
    return {
      profile: defaults,
      stored: false,
      ...base,
      error: `The profile file is not a valid profile: ${validated.errors.join(' ')}`,
    };
  }
  return { profile: validated.profile, stored: true, ...base, error: null };
}

/**
 * Adopt the JSON profile file into an empty database, exactly once.
 *
 * The deployment ran on `data/profile.json` before the database existed. Once a
 * database is configured it becomes authoritative, so without this step the first
 * read would answer with defaults and the reader would see their own real
 * profile appear to have been wiped. The file is the only copy in that moment, so
 * it is imported rather than ignored — and the original file is left in place.
 *
 * Returns the state as stored, or null when there is nothing to import or the
 * import failed. A failure is deliberately swallowed here: this runs on the read
 * path, where the honest fallback is the defaults plus the file still on disk,
 * never a 500 that would take the whole page down. The next write from Settings
 * (or the next read) retries it.
 */
async function adoptProfileFile(env: NodeJS.ProcessEnv): Promise<ProfileState | null> {
  try {
    const fileState = readProfileFileState(env);
    if (!fileState.stored) return null;
    const row = await writeProfileRow(fileState.profile, env);
    return {
      profile: row.profile,
      stored: true,
      backend: 'postgres',
      path: 'postgres',
      revision: row.revision,
      updatedAt: row.updatedAt,
      error: null,
    };
  } catch {
    return null;
  }
}

/**
 * Read the profile from whichever backend is configured and report how it was
 * obtained.
 *
 * Never throws for a backend problem: an unconfigured, unreadable or invalid
 * record yields the defaults with `stored: false` and a (safe) reason, which the
 * API route turns into a 500 rather than serving a wrong answer quietly.
 */
export async function readProfileState(env: NodeJS.ProcessEnv = process.env): Promise<ProfileState> {
  let backend;
  try {
    backend = resolveBackend(env);
  } catch (error) {
    return {
      profile: defaultsFor(env),
      stored: false,
      backend: 'files',
      path: profileFilePath(env),
      revision: 0,
      updatedAt: null,
      error: messageOf(error, 'The Postgres configuration could not be resolved.'),
    };
  }

  if (backend.kind === 'files') return readProfileFileState(env);

  const path = backend.target ?? 'postgres';
  try {
    const row = await readProfileRow(env);
    if (!row) {
      // ── One-time import ────────────────────────────────────────────────────
      // The database is authoritative and has no profile yet. Before answering
      // with defaults, adopt the JSON file this deployment used before the
      // database existed, so switching backends never silently blanks a real
      // profile. Idempotent by construction: the row written here is found on
      // every later read, so the file is read at most once.
      const adopted = await adoptProfileFile(env);
      if (adopted) return adopted;
      return {
        profile: defaultsFor(env),
        stored: false,
        backend: 'postgres',
        path,
        revision: 0,
        updatedAt: null,
        error: null,
      };
    }
    return {
      profile: row.profile,
      stored: true,
      backend: 'postgres',
      path,
      revision: row.revision,
      updatedAt: row.updatedAt,
      error: null,
    };
  } catch (error) {
    return {
      profile: defaultsFor(env),
      stored: false,
      backend: 'postgres',
      path,
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
 * Write the profile to whichever backend is configured.
 *
 * A database failure throws with the driver's reason — the route reports it as a
 * 500 and the reader is told, rather than being shown a save that did not
 * happen. A file failure throws with an actionable message (a read-only mount).
 */
export async function writeProfile(
  profile: VitalProfile,
  env: NodeJS.ProcessEnv = process.env
): Promise<ProfileState> {
  const backend = resolveBackend(env);

  if (backend.kind === 'postgres') {
    const row = await writeProfileRow(profile, env);
    return {
      profile: row.profile,
      stored: true,
      backend: 'postgres',
      path: backend.target ?? 'postgres',
      revision: row.revision,
      updatedAt: row.updatedAt,
      error: null,
    };
  }

  const path = profileFilePath(env);
  const validated = validateProfileInput(profile);
  if (!validated.ok) {
    throw new Error(`Refusing to write an invalid profile: ${validated.errors.join(' ')}`);
  }
  const dir = dirname(path);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(validated.profile, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    throw new Error(
      `The profile could not be written to ${path}: ${messageOf(
        error,
        'unknown error'
      )}. The directory must be writable by the server process.`
    );
  }
  return readProfileFileState(env);
}

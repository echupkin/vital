// ── Configuration backend (SERVER ONLY) ──────────────────────────────────────
//
// ONE place answers "where does the configuration live?" so the profile store,
// the preferences store and the API routes cannot disagree about it.
//
//   * a Postgres database is configured → every configuration read and write
//     goes to Postgres. This is the deployment docker-compose ships;
//   * nothing is configured             → a thrown error carrying the reason;
//   * configured but invalid            → a thrown error carrying the reason.
//
// Both failure cases throw rather than returning "no database": this deployment
// stores its settings in Postgres and has NO JSON-file fallback. Silently
// treating an absent or broken configuration as "no database" is exactly how a
// reader's settings end up written to a file they believe is in Postgres.
//
// Nothing here reads a health value, a token or a credential: it resolves WHERE
// configuration is stored, and nothing else.

import { databaseTarget, resolveDatabaseConfig } from './config';

export type BackendKind = 'postgres';

export interface Backend {
  kind: BackendKind;
  /** The redacted target (`postgres://user@host:port/db`). Safe to log, show
   *  and report — it never carries the password. */
  target: string;
}

/** The reason thrown when no database is configured. Actionable and secret-free. */
export const NO_DATABASE_CONFIGURED_REASON =
  'No Postgres database is configured; set DATABASE_URL or the VITAL_PG_* variables — ' +
  'this deployment stores its settings in Postgres and has no file fallback.';

/**
 * Resolve the active configuration backend.
 *
 * Throws with the clear reason when nothing is configured (there is no file
 * fallback) and when a database is configured but the settings are unusable —
 * the caller decides how to report it (the API routes turn it into a 500; the
 * container entrypoint refuses to start).
 */
export function resolveBackend(env: NodeJS.ProcessEnv = process.env): Backend {
  const config = resolveDatabaseConfig(env);
  if (config.configured) return { kind: 'postgres', target: databaseTarget(config) ?? 'postgres' };
  if (config.invalid) {
    throw new Error(`The Postgres configuration is invalid: ${config.reason}`);
  }
  throw new Error(NO_DATABASE_CONFIGURED_REASON);
}

/**
 * True when a database is configured, whether or not its settings are valid.
 *
 * Used for reporting ("is this deployment database-backed?"), never for
 * choosing a write path — that is the store, which throws when no database is
 * configured instead of quietly writing to a file.
 */
export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = resolveDatabaseConfig(env);
  return config.configured || config.invalid;
}

/** A one-line, secret-free description of where configuration is stored. */
export function describeBackend(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return `Postgres (${resolveBackend(env).target})`;
  } catch (error) {
    return `unavailable — ${error instanceof Error ? error.message : String(error)}`;
  }
}

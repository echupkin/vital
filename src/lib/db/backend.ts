// ── Configuration backend selection (SERVER ONLY) ────────────────────────────
//
// ONE place answers "where does the configuration live?" so the profile store,
// the preferences store and the API routes cannot disagree about it.
//
//   * a Postgres database is configured  → every configuration read and write
//     goes to Postgres;
//   * nothing is configured              → today's JSON files under ./data;
//   * configured but invalid             → a thrown error carrying the reason.
//
// The invalid case throws rather than returning "no database" on purpose:
// silently treating a broken configuration as "no database" would start writing
// the reader's settings into JSON files they believe are in Postgres.
//
// Nothing here reads a health value, a token or a credential: it resolves WHERE
// configuration is stored, and nothing else.

import { databaseTarget, resolveDatabaseConfig } from './config';

export type BackendKind = 'postgres' | 'files';

export interface Backend {
  kind: BackendKind;
  /** The redacted target (`postgres://user@host:port/db`) when Postgres is
   *  active, or `null` for the file backend. Safe to log, show and report. */
  target: string | null;
}

/**
 * Resolve the active configuration backend.
 *
 * Throws with the clear reason when a database is configured but the settings
 * are unusable — the caller decides how to report it (the API routes turn it
 * into a 500; the container entrypoint refuses to start).
 */
export function resolveBackend(env: NodeJS.ProcessEnv = process.env): Backend {
  const config = resolveDatabaseConfig(env);
  if (config.configured) return { kind: 'postgres', target: databaseTarget(config) };
  if (config.invalid) {
    throw new Error(`The Postgres configuration is invalid: ${config.reason}`);
  }
  return { kind: 'files', target: null };
}

/**
 * True when a database is configured, whether or not its settings are valid.
 *
 * Used for reporting ("is this deployment database-backed?"), never for
 * choosing a write path — that is `resolveBackend`, which throws on an invalid
 * configuration instead of quietly picking the files.
 */
export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return resolveBackend(env).kind === 'postgres';
  } catch {
    return true;
  }
}

/** A one-line, secret-free description of where configuration is stored. */
export function describeBackend(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const backend = resolveBackend(env);
    return backend.kind === 'postgres'
      ? `Postgres (${backend.target})`
      : 'JSON files under ./data';
  } catch (error) {
    return `unavailable — ${error instanceof Error ? error.message : String(error)}`;
  }
}

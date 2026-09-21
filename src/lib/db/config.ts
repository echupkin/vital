// ── Database configuration (typed view of ./pg-config.mjs) ────────────────────
//
// The parsing rules live in `pg-config.mjs`, which the standalone migration CLI
// also imports; this module only adds the TypeScript types and the app-side
// helpers. Nothing else in the app reads a `VITAL_PG_*` variable directly, so
// there is exactly one answer to "is a database configured?".
//
// SERVER ONLY. `resolveDatabaseConfig` takes the environment as a PARAMETER so
// tests never touch `process.env`.

import {
  resolveDatabaseConfig as resolveRaw,
  databaseTarget as targetRaw,
  PG_ENV,
  DEFAULT_VITAL_PG_PORT,
} from './pg-config.mjs';

export { PG_ENV, DEFAULT_VITAL_PG_PORT };

export interface DatabaseConfig {
  configured: true;
  invalid: false;
  reason: null;
  /** Which input the settings came from. */
  source: string;
  /** Full connection string. Carries the password: never log, never return. */
  url: string;
  host: string;
  port: number;
  database: string;
  user: string | null;
  password: string | null;
  ssl: boolean;
}

export type DatabaseConfigResult =
  | DatabaseConfig
  | { configured: false; invalid: false; reason: null }
  | { configured: false; invalid: true; reason: string };

/** The resolved configuration, or a reason it is unusable. Never throws. */
export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfigResult {
  return resolveRaw(env) as DatabaseConfigResult;
}

/**
 * The configuration, or a thrown error carrying the clear reason.
 *
 * Used by the startup path, where refusing to serve is the honest answer to a
 * database that is configured but wrong — silently falling back to the files
 * would pretend settings were saved that were not.
 */
export function requireDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const resolved = resolveDatabaseConfig(env);
  if (resolved.configured) return resolved;
  if (resolved.invalid) {
    throw new Error(`The Postgres configuration is invalid: ${resolved.reason}`);
  }
  throw new Error('No Postgres database is configured (DATABASE_URL and the VITAL_PG_* variables are all unset).');
}

/** `postgres://user@host:port/db` — no password. Safe to log, show or report. */
export function databaseTarget(config: DatabaseConfigResult): string | null {
  return targetRaw(config as never) as string | null;
}

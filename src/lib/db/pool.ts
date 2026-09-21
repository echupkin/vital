// ── Postgres pool (SERVER ONLY) ───────────────────────────────────────────────
//
// ONE pool for the whole process, created lazily on first use and closed on
// shutdown. Nothing here is reachable from the browser: this module imports
// `pg`, which only ever runs in server code (an API route, a server component or
// the instrumentation hook).
//
// The pool is keyed by connection string, so a process that is tested against a
// different database (or a second one is configured) never reuses the wrong
// client. `getPool()` returns null when no database is configured — the callers
// that need a database check the configuration first and report the reason,
// rather than being handed a pool that cannot connect.

import pg from 'pg';
import { resolveDatabaseConfig, type DatabaseConfig } from './config';

export interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

let pool: pg.Pool | null = null;
let poolKey: string | null = null;

/**
 * The configured pool, or null when no database is configured.
 * Throws when a database is configured but the settings are invalid — the
 * caller is expected to have shown the reason already, and guessing here would
 * hide a real misconfiguration.
 */
export function getPool(env: NodeJS.ProcessEnv = process.env): pg.Pool | null {
  const config = resolveDatabaseConfig(env);
  if (!config.configured) {
    if (config.invalid) throw new Error(`The Postgres configuration is invalid: ${config.reason}`);
    return null;
  }
  return poolFor(config);
}

function poolFor(config: DatabaseConfig): pg.Pool {
  const key = config.url;
  if (pool && poolKey === key) return pool;
  if (pool) void pool.end().catch(() => {});
  pool = new pg.Pool({
    connectionString: config.url,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    // Small and bounded: this database stores a handful of configuration rows.
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'vital',
  });
  // A pool-level error (the server going away between requests) must be logged
  // and must not kill the process: the next request reports the failure.
  pool.on('error', error => {
    console.error(`[vital] postgres pool error: ${error instanceof Error ? error.message : String(error)}`);
  });
  poolKey = key;
  return pool;
}

/** Close the pool. Called from the instrumentation shutdown hook. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  poolKey = null;
  try {
    await closing.end();
  } catch {
    // Already closed or the server is gone: nothing useful to do at shutdown.
  }
}

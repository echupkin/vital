#!/usr/bin/env node
// ── Migrations CLI ───────────────────────────────────────────────────────────
//
//   npm run db:migrate                    # against the database in .env
//   node scripts/migrate.mjs              # the same thing
//   docker compose run --rm vital node scripts/migrate.mjs
//
// Applied automatically by the container entrypoint (scripts/docker-entrypoint.sh)
// BEFORE the server starts, so a deploy can never serve a half-migrated app.
//
//   * a database that is not configured is not an error: this prints a line and
//     exits 0, because a file-backed deployment is a supported deployment;
//   * a database that IS configured but unreachable (or invalid) is a hard
//     failure: exit 1 with the reason, so nothing starts on top of a broken
//     database;
//   * re-running is a no-op.
//
// The password is never printed. The target line is user@host:port/db.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { resolveDatabaseConfig, databaseTarget } from '../src/lib/db/pg-config.mjs';
import { buildMigrations, runMigrations } from '../src/lib/db/migrate-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = process.env.VITAL_MIGRATIONS_DIR || join(HERE, '..', 'db', 'migrations');

/** Every `NNNN-name.sql` in the migrations directory, in filename order. */
export function loadMigrationFiles(dir = DEFAULT_MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(filename => ({ filename, sql: readFileSync(join(dir, filename), 'utf8') }));
}

/**
 * Run pending migrations against an already-connected client.
 * Exported so the offline tests can drive the same code with a fake client.
 */
export async function migrateWithClient(client, { dir = DEFAULT_MIGRATIONS_DIR, log = console.log } = {}) {
  const migrations = buildMigrations(loadMigrationFiles(dir));
  if (migrations.length === 0) {
    log('[vital-migrate] no migration files found — nothing to do.');
    return { applied: [], skipped: [], total: 0 };
  }
  const result = await runMigrations(client, migrations, { log: message => log(`[vital-migrate] ${message}`) });
  if (result.applied.length === 0) {
    log(
      `[vital-migrate] up to date: 0 pending, ${result.skipped.length} already applied ` +
        `(${result.skipped.join(', ')}).`
    );
  } else {
    log(`[vital-migrate] applied ${result.applied.length}: ${result.applied.join(', ')}.`);
  }
  return result;
}

/** Resolve config, connect, migrate, disconnect. Returns a process exit code. */
export async function migrate({ env = process.env, dir, log = console.log } = {}) {
  const config = resolveDatabaseConfig(env);
  if (!config.configured && !config.invalid) {
    log(
      '[vital-migrate] no Postgres database is configured (DATABASE_URL and the VITAL_PG_* variables are ' +
        'unset) — skipping migrations; this deployment stores configuration in files under ./data.'
    );
    return 0;
  }
  if (config.invalid) {
    log(`[vital-migrate] FATAL: the Postgres configuration is invalid: ${config.reason}`);
    return 1;
  }

  const target = databaseTarget(config);
  log(`[vital-migrate] migrating ${target} (migrations: ${dir ?? DEFAULT_MIGRATIONS_DIR})`);
  const client = new pg.Client({
    connectionString: config.url,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    application_name: 'vital-migrate',
  });
  try {
    await client.connect();
  } catch (error) {
    log(
      `[vital-migrate] FATAL: could not connect to ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return 1;
  }
  try {
    await migrateWithClient(client, { dir, log });
    return 0;
  } catch (error) {
    log(`[vital-migrate] FATAL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

// Only run when executed directly, so the tests can import the functions above.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  migrate({ dir: DEFAULT_MIGRATIONS_DIR }).then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(`[vital-migrate] FATAL: ${error instanceof Error ? error.stack : String(error)}`);
      process.exitCode = 1;
    }
  );
}

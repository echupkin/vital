// ── Migration runner core (shared, plain ESM) ─────────────────────────────────
//
// Plain ESM with only node built-ins, so it can be driven by the standalone CLI
// (`scripts/migrate.mjs`, run by the container entrypoint before the server
// starts) AND by the offline unit tests, which pass a recording fake in place of
// a Postgres connection.
//
// Guarantees:
//   * migrations are applied in filename order, ONE transaction each, and are
//     recorded in `schema_migrations` inside that same transaction — so a failed
//     migration leaves nothing recorded and can be re-run;
//   * the whole run happens under a Postgres SESSION advisory lock, so two app
//     replicas starting at the same moment cannot both apply the same migration;
//   * a second run is a no-op: applied versions are skipped;
//   * an applied migration whose SQL changed is a hard error (they are immutable
//     once shipped — editing one would silently diverge two databases);
//   * plain SQL files only. No ORM, no migration framework, no dependencies.
//
// `client` is anything with a `query(text, params)` method backed by ONE
// connection (a `pg.Client`, or a fake in a test). A pool would not do: BEGIN /
// COMMIT and a session advisory lock must land on the same connection.

import { createHash } from 'node:crypto';

/**
 * Fixed advisory-lock key. Any Vital migration runner on the same database uses
 * this number, so replicas serialise against each other. It is a constant on
 * purpose: a value derived from the environment would let two differently
 * configured runners race.
 */
export const MIGRATIONS_LOCK_KEY = 0x56495441; // 'VITA'

/** `NNNN-name.sql` → `{ version, name }`, or null when the file is not a migration. */
export function parseMigrationFilename(filename) {
  const match = /^(\d{4})[-_]([A-Za-z0-9._-]+)\.sql$/.exec(filename);
  if (!match) return null;
  return { version: match[1], name: match[2] };
}

/** Sort migrations by version, refusing two files that claim the same version. */
export function orderMigrations(entries) {
  const sorted = [...entries].sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  const seen = new Set();
  for (const entry of sorted) {
    if (seen.has(entry.version)) {
      throw new Error(
        `Two migration files claim version ${entry.version} (${entry.filename} and another). Versions must be unique.`
      );
    }
    seen.add(entry.version);
  }
  return sorted;
}

export function checksumOf(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Turn file entries into runnable migrations.
 *
 * @param {{filename: string, sql: string}[]} files
 * @param {(filename: string) => string} [checksum]
 */
export function buildMigrations(files, checksum = checksumOf) {
  const parsed = [];
  for (const file of files) {
    const meta = parseMigrationFilename(file.filename);
    if (!meta) continue; // README.md and friends are simply not migrations
    parsed.push({
      version: meta.version,
      name: meta.name,
      filename: file.filename,
      sql: file.sql,
      checksum: checksum(file.sql),
    });
  }
  return orderMigrations(parsed);
}

/** The migrations that have not been applied yet, in order. */
export function pendingMigrations(applied, migrations) {
  const done = new Set((applied ?? []).map(row => row.version));
  return migrations.filter(migration => !done.has(migration.version));
}

/** Fail loudly when a shipped migration's SQL no longer matches what ran. */
export function assertImmutable(applied, migrations) {
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  for (const row of applied ?? []) {
    const migration = byVersion.get(row.version);
    if (!migration) continue; // applied out of the tree: reported, not fatal
    if (row.checksum && row.checksum !== migration.checksum) {
      throw new Error(
        `Migration ${row.version} (${migration.filename}) has changed since it was applied. ` +
          'Migrations are immutable once shipped: add a new file instead of editing an old one.'
      );
    }
  }
}

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/**
 * Apply every pending migration.
 *
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }} client
 * @param {ReturnType<typeof buildMigrations>} migrations
 * @param {{ log?: (message: string) => void }} [options]
 */
export async function runMigrations(client, migrations, options = {}) {
  const log = options.log ?? (() => {});
  await client.query(CREATE_MIGRATIONS_TABLE);

  const appliedRows = await client.query('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
  const applied = (appliedRows.rows ?? []).map(row => ({
    version: String(row.version),
    name: String(row.name),
    checksum: row.checksum === null || row.checksum === undefined ? null : String(row.checksum),
  }));
  assertImmutable(applied, migrations);

  const pending = pendingMigrations(applied, migrations);
  const skipped = migrations.filter(m => !pending.includes(m)).map(m => m.version);

  // One advisory lock for the whole run. Session-scoped (not transaction-scoped)
  // because it has to outlive each migration's own transaction; released in the
  // finally so a failure still unlocks.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATIONS_LOCK_KEY]);
  const done = [];
  try {
    // Re-read under the lock: another replica may have applied something between
    // the read above and the lock being granted.
    const lockedRows = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const lockedApplied = (lockedRows.rows ?? []).map(row => ({ version: String(row.version) }));
    const stillPending = pendingMigrations(lockedApplied, migrations);

    for (const migration of stillPending) {
      log(`applying ${migration.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.filename} failed and was rolled back: ${reason}`);
      }
      done.push(migration.version);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATIONS_LOCK_KEY]);
  }

  return { applied: done, skipped, total: migrations.length, lockedWith: MIGRATIONS_LOCK_KEY };
}

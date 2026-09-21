// ── Postgres connection configuration (shared, plain ESM) ─────────────────────
//
// ONE source of truth for how the database settings are read from the
// environment, deliberately written as plain ESM with no dependencies so that
// both consumers can use it:
//
//   * the Next.js server bundle, through `./config.ts` (which adds the types)
//   * the standalone migration CLI (`scripts/migrate.mjs`), which runs OUTSIDE
//     the app bundle in the container entrypoint
//
// Two ways to configure a database, in precedence order:
//
//   1. `DATABASE_URL`                 — a full postgres:// connection string. Wins.
//   2. the discrete parts:
//        VITAL_PG_HOST, VITAL_PG_PORT, VITAL_PG_DATABASE, VITAL_PG_USER,
//        VITAL_PG_PASSWORD, VITAL_PG_SSL
//
// WHY the parts exist at all: the same database is reached from two places with
// two different addresses — `127.0.0.1:5433` from the host (the published port)
// and `vital-postgres:5432` from inside the compose network. Discrete parts let
// docker-compose override the host/port for the container without touching the
// password, while a URL stays available for an external/managed database.
//
// Nothing here logs, returns or throws with the password. `databaseTarget()`
// renders a redacted target safe for a log line, an API response or a report.
//
// No database health data is reachable through this module: it only resolves
// connection settings.

/** Environment variable names, so nothing has to hard-code a string twice. */
export const PG_ENV = {
  URL: 'DATABASE_URL',
  HOST: 'VITAL_PG_HOST',
  PORT: 'VITAL_PG_PORT',
  DATABASE: 'VITAL_PG_DATABASE',
  USER: 'VITAL_PG_USER',
  PASSWORD: 'VITAL_PG_PASSWORD',
  SSL: 'VITAL_PG_SSL',
};

/** The port Vital publishes its own Postgres on by default (5432 is taken). */
export const DEFAULT_VITAL_PG_PORT = '5433';

/** Empty and whitespace-only values count as "not set", so an explicit
 *  `VITAL_PG_HOST=` in a shell can turn the database off for one command. */
function clean(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseBoolean(value) {
  if (value === null) return null;
  const v = value.toLowerCase();
  if (['1', 'true', 'yes', 'on', 'require'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(v)) return false;
  return undefined; // unparseable
}

function parsePort(value) {
  if (value === null) return null;
  if (!/^\d{1,5}$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** Split a postgres:// URL without trusting the URL parser with the password. */
function fromUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid(`DATABASE_URL is not a valid URL.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return invalid(`DATABASE_URL must start with postgres:// or postgresql://.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname) return invalid('DATABASE_URL has no host.');
  if (!database) return invalid('DATABASE_URL has no database name.');
  return {
    configured: true,
    invalid: false,
    reason: null,
    source: PG_ENV.URL,
    url: raw,
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
    user: parsed.username ? decodeURIComponent(parsed.username) : null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    ssl: parseBoolean(clean(parsed.searchParams.get('sslmode'))) === true,
  };
}

function invalid(reason) {
  return { configured: false, invalid: true, reason };
}

/**
 * Resolve the database configuration from an environment object.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{
 *   configured: boolean, invalid: boolean, reason: string | null,
 *   source?: string, url?: string, host?: string, port?: number,
 *   database?: string, user?: string | null, password?: string | null, ssl?: boolean,
 * }}
 *
 * Three outcomes:
 *   configured: true                      — usable settings (the password may be
 *                                           absent only when it came from a URL,
 *                                           where a trust/md5 setup may not need one)
 *   configured: false, invalid: false     — nothing is set: use the file store
 *   configured: false, invalid: true      — set, but wrong: report `reason`
 */
export function resolveDatabaseConfig(env = process.env) {
  const url = clean(env[PG_ENV.URL]);
  if (url) return fromUrl(url);

  const host = clean(env[PG_ENV.HOST]);
  const port = parsePort(clean(env[PG_ENV.PORT]));
  const database = clean(env[PG_ENV.DATABASE]);
  const user = clean(env[PG_ENV.USER]);
  const password = clean(env[PG_ENV.PASSWORD]);
  const ssl = parseBoolean(clean(env[PG_ENV.SSL]));

  const anythingSet = [host, clean(env[PG_ENV.PORT]), database, user, password, clean(env[PG_ENV.SSL])].some(
    value => value !== null
  );
  if (!anythingSet) {
    // Not configured at all: this is the documented file-backed deployment.
    return { configured: false, invalid: false, reason: null };
  }

  if (clean(env[PG_ENV.PORT]) !== null && port === undefined) {
    return invalid('VITAL_PG_PORT must be a whole number between 1 and 65535.');
  }
  if (clean(env[PG_ENV.SSL]) !== null && ssl === undefined) {
    return invalid('VITAL_PG_SSL must be true or false.');
  }
  const missing = [
    [host === null, PG_ENV.HOST],
    [database === null, PG_ENV.DATABASE],
    [user === null, PG_ENV.USER],
    [password === null, PG_ENV.PASSWORD],
  ]
    .filter(([isMissing]) => isMissing)
    .map(([, name]) => name);
  if (missing.length > 0) {
    return invalid(
      `Incomplete Postgres configuration: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } required for database mode. Set ${missing.join(', ')}, or unset every ${PG_ENV.HOST}/VITAL_PG_* variable to run without a database.`
    );
  }

  return {
    configured: true,
    invalid: false,
    reason: null,
    source: 'parts',
    url: connectionString({ host, port: port ?? 5432, database, user, password, ssl }),
    host,
    port: port ?? 5432,
    database,
    user,
    password,
    ssl,
  };
}

/** Build a connection string. NEVER log the result: it carries the password. */
export function connectionString({ host, port, database, user, password, ssl }) {
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  const query = ssl ? '?sslmode=require' : '';
  return `postgres://${credentials}@${host}:${port}/${encodeURIComponent(database)}${query}`;
}

/** A redacted rendering of the target, safe for a log line or an API response. */
export function databaseTarget(config) {
  if (!config || !config.configured) return null;
  return `postgres://${config.user ?? 'unknown'}@${config.host}:${config.port}/${config.database}`;
}

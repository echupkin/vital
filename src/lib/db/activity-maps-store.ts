// ── Activity maps store: Postgres (SERVER ONLY) ──────────
//
// The maps on Activity → Maps (db/migrations/0009). Every function takes its
// client, so the SQL and row mapping run against an injected stand-in in the
// offline tests; the API routes pass the process pool.
//
// CONFIGURATION ONLY: a box, a name and display choices. There is no column for
// a route or any other observation, and no query here can read one. Rows are
// re-read through the shared validators, so a hand-edited row cannot put an
// unknown shape in front of the page.
//
// An update or delete names the revision it was based on; a stale one is refused
// rather than silently overwriting a change made in another tab.

import { randomUUID } from 'crypto';
import {
  readStoredSettings,
  validateBBox,
  type ActivityMap,
  type ActivityMapInput,
} from '@/lib/activity-maps/types';
import { NO_DATABASE_CONFIGURED_REASON } from './backend';
import { getPool, type PoolLike } from './pool';

export class MapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapConflictError';
  }
}

export class MapNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapNotFoundError';
  }
}

/** At most this many maps; each one renders a map and reads every route. */
export const MAX_MAPS = 24;

const COLUMNS = 'id, position, name, bbox, settings, revision, updated_at';

export function poolOrThrow(env: NodeJS.ProcessEnv = process.env): PoolLike {
  const pool = getPool(env);
  if (!pool) throw new Error(NO_DATABASE_CONFIGURED_REASON);
  return pool;
}

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export function toActivityMap(row: Record<string, unknown>): ActivityMap {
  const bbox = validateBBox(json(row.bbox));
  if (!bbox.ok) throw new Error(`Stored map ${String(row.id)} has an invalid area: ${bbox.errors.join(' ')}`);
  return {
    id: String(row.id),
    name: String(row.name),
    bbox: bbox.value,
    settings: readStoredSettings(json(row.settings)),
    position: Number(row.position),
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listMaps(client: PoolLike): Promise<ActivityMap[]> {
  const result = await client.query(`SELECT ${COLUMNS} FROM activity_maps ORDER BY position, created_at`);
  return result.rows.map(toActivityMap);
}

export async function createMap(client: PoolLike, input: ActivityMapInput): Promise<ActivityMap> {
  const count = await client.query('SELECT count(*)::int AS n, coalesce(max(position), -1)::int AS last FROM activity_maps');
  const { n, last } = count.rows[0] as { n: number; last: number };
  if (Number(n) >= MAX_MAPS) throw new MapConflictError(`At most ${MAX_MAPS} maps can be kept.`);
  const result = await client.query(
    `INSERT INTO activity_maps (id, position, name, bbox, settings)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING ${COLUMNS}`,
    [`map-${randomUUID().slice(0, 8)}`, Number(last) + 1, input.name, JSON.stringify(input.bbox), JSON.stringify(input.settings)]
  );
  return toActivityMap(result.rows[0]);
}

async function revisionOf(client: PoolLike, id: string): Promise<number | null> {
  const result = await client.query('SELECT revision FROM activity_maps WHERE id = $1', [id]);
  return result.rows[0] ? Number(result.rows[0].revision) : null;
}

export async function updateMap(
  client: PoolLike,
  id: string,
  input: ActivityMapInput,
  revision: number
): Promise<ActivityMap> {
  const result = await client.query(
    `UPDATE activity_maps
        SET name = $3, bbox = $4::jsonb, settings = $5::jsonb, revision = revision + 1, updated_at = now()
      WHERE id = $1 AND revision = $2
      RETURNING ${COLUMNS}`,
    [id, revision, input.name, JSON.stringify(input.bbox), JSON.stringify(input.settings)]
  );
  if (result.rows[0]) return toActivityMap(result.rows[0]);
  const current = await revisionOf(client, id);
  if (current === null) throw new MapNotFoundError(`No map ${id}.`);
  throw new MapConflictError(`Map ${id} was changed elsewhere (revision ${current}, not ${revision}).`);
}

export async function deleteMap(client: PoolLike, id: string, revision: number): Promise<void> {
  const result = await client.query('DELETE FROM activity_maps WHERE id = $1 AND revision = $2 RETURNING id', [id, revision]);
  if (result.rows[0]) return;
  const current = await revisionOf(client, id);
  if (current === null) throw new MapNotFoundError(`No map ${id}.`);
  throw new MapConflictError(`Map ${id} was changed elsewhere (revision ${current}, not ${revision}).`);
}

/**
 * Put the maps in this order. The list must name every map exactly once, so a
 * tab holding an out-of-date list cannot drop or duplicate one.
 */
export async function reorderMaps(client: PoolLike, ids: string[]): Promise<ActivityMap[]> {
  const current = await listMaps(client);
  const known = new Set(current.map(m => m.id));
  if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every(id => known.has(id))) {
    throw new MapConflictError('The order must name every map exactly once; reload and try again.');
  }
  await client.query(
    `UPDATE activity_maps AS m SET position = o.position
       FROM unnest($1::text[]) WITH ORDINALITY AS o(id, position)
      WHERE m.id = o.id`,
    [ids]
  );
  return listMaps(client);
}

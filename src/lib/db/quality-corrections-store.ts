// ── Data-quality corrections turned off: Postgres (SERVER ONLY) ──────────────
//
// The `quality_correction_off` table (db/migrations/0016). CONFIGURATION ONLY:
// a check id. A row means the reader turned that correction off; no row means
// the default, on. Every pg* function takes its client, so the SQL runs against
// an injected stand-in in the offline tests.
//
// Turning off and on are idempotent.

import { CORRECTABLE_CHECKS, type CorrectableCheck } from '@/lib/adapters/quality-correct';
import { getPool, type PoolLike } from './pool';

/** The checks turned off. A row whose check id is not correctable (any more) is dropped. */
export async function pgReadCorrectionsOff(client: PoolLike): Promise<CorrectableCheck[]> {
  const result = await client.query('SELECT check_id FROM quality_correction_off ORDER BY check_id');
  const known = new Set<string>(CORRECTABLE_CHECKS);
  return result.rows.map(r => String(r.check_id)).filter((id): id is CorrectableCheck => known.has(id));
}

export async function pgCorrectionOff(client: PoolLike, checkId: CorrectableCheck): Promise<void> {
  await client.query('INSERT INTO quality_correction_off (check_id) VALUES ($1) ON CONFLICT (check_id) DO NOTHING', [checkId]);
}

export async function pgCorrectionOn(client: PoolLike, checkId: CorrectableCheck): Promise<void> {
  await client.query('DELETE FROM quality_correction_off WHERE check_id = $1', [checkId]);
}

/** Null when no database is configured (the caller decides what that means). */
export function correctionsClient(env: NodeJS.ProcessEnv = process.env): PoolLike | null {
  return getPool(env) as unknown as PoolLike | null;
}

export interface CorrectionsDeps {
  env?: NodeJS.ProcessEnv;
  /** Replaces the process Postgres pool (tests). `null` means no database. */
  client?: PoolLike | null;
}

/**
 * The corrections that are on: every correctable check the reader has not
 * turned off. Without a database, or when the list cannot be read, that is
 * all of them — the default, and what a reader who never chose sees.
 */
export async function resolveCorrections(deps: CorrectionsDeps = {}): Promise<ReadonlySet<CorrectableCheck>> {
  const all = new Set<CorrectableCheck>(CORRECTABLE_CHECKS);
  try {
    const client = deps.client !== undefined ? deps.client : correctionsClient(deps.env);
    if (!client) return all;
    for (const id of await pgReadCorrectionsOff(client)) all.delete(id);
  } catch {
    // Keep the default.
  }
  return all;
}

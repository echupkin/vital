// ── Coverage service (SERVER ONLY) ──────────────────────
//
// What GET /api/activity-coverage answers: install the dataset, read the routes
// of its workouts, aggregate them for the box and cache the result. A Next.js
// route file may export only its handlers, so the request parsing lives here
// where it can be tested.
//
// The cache key is the query plus everything that can change the answer without
// changing the query: the data mode, the dataset's generation time, the route
// store's generation and the reference day.

import { liveCacheTtlMs } from '@/lib/adapters/cache';
import { HaeError } from '@/lib/adapters/hae';
import { LiveDataUnavailableError, installDataset } from '@/lib/adapters/runtime';
import { REFERENCE_KEY, workoutList } from '@/lib/adapters/dataset';
import { addDays } from '@/lib/analytics/windows';
import { computeCoverage, type CoverageQuery, type CoverageResult } from './coverage';
import { isPathMetricId } from './metrics';
import { MAX_RANGE_DAYS, validateBBox, type BBox, type MapRange } from './types';
import { loadRoutes } from './routes';

/** "New ground" with no date range selected means the last this-many days. */
export const DEFAULT_NEW_DAYS = 30;

export interface CoverageRequest {
  bbox: BBox;
  types: string[] | null;
  range: MapRange;
  metric: CoverageQuery['metric'];
}

/** Parse the query string; a string return is the 400 message. */
export function parseCoverageRequest(params: URLSearchParams): CoverageRequest | string {
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : NaN);
  const bbox = validateBBox({ south: num('south'), west: num('west'), north: num('north'), east: num('east') });
  if (!bbox.ok) return bbox.errors.join(' ');
  const types = params.getAll('type').map(t => t.trim()).filter(Boolean);
  const rangeRaw = params.get('range') ?? 'all';
  let range: MapRange;
  if (rangeRaw === 'all') range = 'all';
  else {
    const days = Number(rangeRaw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) {
      return `range must be "all" or a whole number of days, 1-${MAX_RANGE_DAYS}.`;
    }
    range = days;
  }
  const metric = params.get('metric') ?? 'frequency';
  if (!isPathMetricId(metric)) return 'metric is not a known path metric.';
  return { bbox: bbox.value, types: types.length > 0 ? [...new Set(types)].sort() : null, range, metric };
}

/** The aggregation query for a request, resolved against the reference day. */
export function coverageQuery(req: CoverageRequest, referenceKey: string): CoverageQuery {
  const range =
    req.range === 'all' ? null : { fromKey: addDays(referenceKey, -(req.range - 1)), toKey: referenceKey };
  return {
    bbox: req.bbox,
    types: req.types,
    range,
    metric: req.metric,
    newSinceKey: range ? range.fromKey : addDays(referenceKey, -(DEFAULT_NEW_DAYS - 1)),
  };
}

export interface CoverageResponse extends Partial<CoverageResult> {
  available: boolean;
  reason: string | null;
  /** Workouts whose route could not be read this time; the map is drawn without them. */
  unreadWorkouts: number;
  referenceKey: string | null;
  range: { fromKey: string; toKey: string } | null;
  mode: 'demo' | 'live' | null;
}

// A small LRU rather than the dataset's TtlCache: every box × filter × range is
// its own entry, a result can run to a megabyte, and the TtlCache never evicts.
// Expired entries are recomputed (the routes are already in memory, so that is
// cheap); identical concurrent requests share one computation.
export const COVERAGE_CACHE_ENTRIES = 24;
const coverageCache = new Map<string, { at: number; value: Promise<CoverageResult> }>();

function cachedCoverage(key: string, compute: () => CoverageResult): Promise<CoverageResult> {
  const hit = coverageCache.get(key);
  if (hit && Date.now() - hit.at < liveCacheTtlMs()) {
    coverageCache.delete(key);
    coverageCache.set(key, hit);
    return hit.value;
  }
  const value = Promise.resolve().then(compute);
  coverageCache.set(key, { at: Date.now(), value });
  value.catch(() => coverageCache.delete(key));
  while (coverageCache.size > COVERAGE_CACHE_ENTRIES) {
    coverageCache.delete(coverageCache.keys().next().value!);
  }
  return value;
}

export async function readCoverage(req: CoverageRequest): Promise<CoverageResponse> {
  let mode: 'demo' | 'live';
  let generatedAt: string;
  try {
    const resolved = await installDataset();
    mode = resolved.mode;
    generatedAt = resolved.meta.generatedAt;
  } catch (error) {
    const reason = error instanceof LiveDataUnavailableError ? `${error.message} ${error.detail}` : 'The dataset could not be loaded.';
    return { available: false, reason, unreadWorkouts: 0, referenceKey: null, range: null, mode: null };
  }

  const referenceKey = REFERENCE_KEY;
  const query = coverageQuery(req, referenceKey);
  try {
    const load = await loadRoutes(workoutList(), mode);
    const key = JSON.stringify([mode, generatedAt, load.generation, referenceKey, query]);
    const result = await cachedCoverage(key, () => computeCoverage(load.routes, query));
    return {
      available: true,
      reason: null,
      unreadWorkouts: load.failed,
      referenceKey,
      range: query.range,
      mode,
      ...result,
    };
  } catch (error) {
    // A real failure is reported, never replaced with an empty map that reads as
    // "you went nowhere". The adapter's message names no credential and no host.
    const reason = error instanceof HaeError ? error.message : 'The workout routes could not be read from the source.';
    return { available: false, reason, unreadWorkouts: 0, referenceKey, range: query.range, mode };
  }
}

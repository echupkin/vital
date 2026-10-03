// ── Route store (SERVER ONLY) ───────────────────────────
//
// The routes behind the activity maps. Health Auto Export's workout list carries
// no GPS, so each workout's route and heart rate is read once from
// GET /api/workouts/:id and held here as a compact route (`./route-data`).
//
//   * Read once per workout. The key is id + end time, so a session that is
//     re-exported with a different end is read again; one that is unchanged
//     never is. A workout with no route (a strength session, an indoor walk) is
//     remembered as having none.
//   * Bounded. At most ROUTE_FETCH_CONCURRENCY reads run at once across the
//     whole process, however many maps ask; and the store holds at most
//     ROUTE_CACHE_MAX_POINTS points, dropping the least recently used route
//     beyond that.
//   * In memory only. Routes are location data: they are never written to the
//     database or to disk, and never logged. A failed read is not cached; it is
//     counted, reported and retried on the next request.
//
// Demo mode reads nothing: it serves the synthetic routes in `./demo-routes`.

import type { WorkoutRecord } from '@/lib/metrics/types';
import { HaeError, fetchWorkoutDetail, type RequestDeps } from '@/lib/adapters/hae';
import { workoutDayKey } from '@/lib/analytics/workouts';
import { compactRoute, routeBytes, type CompactRoute } from './route-data';
import { demoRoute } from './demo-routes';

export const ROUTE_FETCH_CONCURRENCY = 4;
export const DEFAULT_ROUTE_CACHE_MAX_POINTS = 3_000_000;

export function routeCacheMaxPoints(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ROUTE_CACHE_MAX_POINTS);
  return Number.isFinite(raw) && raw >= 10_000 ? Math.round(raw) : DEFAULT_ROUTE_CACHE_MAX_POINTS;
}

interface Entry {
  route: CompactRoute | null;
  points: number;
  lastUsed: number;
}

export interface RouteLoad {
  routes: CompactRoute[];
  /** Workouts whose route could not be read this time. */
  failed: number;
  /** Bumped whenever the set of held routes changes; part of every coverage cache key. */
  generation: number;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry | null>>();
let heldPoints = 0;
let generation = 0;
let useCounter = 0;

// ── A process-wide limit on concurrent upstream reads ───

let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= ROUTE_FETCH_CONCURRENCY) await new Promise<void>(resolve => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function keyOf(w: WorkoutRecord): string {
  return `${w.id}|${w.end_time}`;
}

function store(key: string, route: CompactRoute | null, env: NodeJS.ProcessEnv): Entry {
  const points = route ? route.lat.length : 0;
  const entry: Entry = { route, points, lastUsed: ++useCounter };
  entries.set(key, entry);
  heldPoints += points;
  generation += 1;
  const cap = routeCacheMaxPoints(env);
  if (heldPoints > cap) {
    // Least recently used first; negatives cost nothing and are kept.
    const victims = [...entries.entries()].filter(([, e]) => e.points > 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k, e] of victims) {
      if (heldPoints <= cap || k === key) break;
      entries.delete(k);
      heldPoints -= e.points;
    }
  }
  return entry;
}

async function readOne(w: WorkoutRecord, deps: RequestDeps): Promise<CompactRoute | null> {
  try {
    const detail = await fetchWorkoutDetail(w.id, deps);
    const points = (detail.route ?? []).map(p => ({
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      time: String(p.time ?? ''),
    }));
    const heartRate = (detail.heartRateData ?? []).map(h => ({
      timestamp: String(h.timestamp ?? ''),
      value: Number(h.value),
    }));
    return compactRoute(
      { workoutId: w.id, workoutType: w.workout_type, start: w.start_time, dayKey: workoutDayKey(w) },
      points,
      heartRate
    );
  } catch (error) {
    // A workout the source no longer has is a workout without a route.
    if (error instanceof HaeError && error.httpStatus === 404) return null;
    throw error;
  }
}

/**
 * The routes of these workouts: held ones at once, the rest read from the
 * source. Throws only when every read failed and nothing at all is held, which
 * means the source is down rather than one workout being unreadable.
 */
export async function loadRoutes(
  workouts: WorkoutRecord[],
  mode: 'demo' | 'live',
  deps: RequestDeps = {}
): Promise<RouteLoad> {
  if (mode === 'demo') {
    const routes = workouts.map(demoRoute).filter((r): r is CompactRoute => r !== null);
    return { routes, failed: 0, generation: 0 };
  }

  const env = deps.env ?? process.env;
  const routes: CompactRoute[] = [];
  let failed = 0;
  let firstError: unknown = null;

  await Promise.all(
    workouts.map(async w => {
      const key = keyOf(w);
      const held = entries.get(key);
      if (held) {
        held.lastUsed = ++useCounter;
        if (held.route) routes.push(held.route);
        return;
      }
      let pending = inFlight.get(key);
      if (!pending) {
        pending = limited(() => readOne(w, deps))
          .then(route => store(key, route, env))
          .catch(error => {
            firstError ??= error;
            return null;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      const entry = await pending;
      if (entry === null) failed += 1;
      else if (entry.route) routes.push(entry.route);
    })
  );

  if (failed > 0 && failed === workouts.length && firstError) throw firstError;
  routes.sort((a, b) => a.start.localeCompare(b.start));
  return { routes, failed, generation };
}

/** What the store holds, for diagnostics. Never a coordinate. */
export function routeStoreStats(): { workouts: number; withRoute: number; points: number; bytes: number } {
  let withRoute = 0;
  let bytes = 0;
  for (const e of entries.values()) {
    if (e.route) {
      withRoute += 1;
      bytes += routeBytes(e.route);
    }
  }
  return { workouts: entries.size, withRoute, points: heldPoints, bytes };
}

/** Tests only. */
export function clearRouteStore(): void {
  entries.clear();
  inFlight.clear();
  heldPoints = 0;
  generation = 0;
}

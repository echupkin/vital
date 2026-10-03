// ── Demo routes: synthetic GPS for the demo dataset ─────
//
// Demo mode connects to nothing, so the maps need routes from somewhere. Each
// outdoor demo workout gets a deterministic loop on a street lattice around one
// fixed public place (seeded by its id, so a page reload draws the same map),
// with heart rate that rises over the session. No real person's route is
// involved, and none of this is reachable in live mode.

import type { WorkoutRecord } from '@/lib/metrics/types';
import { workoutDayKey } from '@/lib/analytics/workouts';
import { compactRoute, type CompactRoute, type HeartRateSample, type RoutePoint } from './route-data';
import { M_PER_DEG_LAT } from './types';
import { DEMO_CENTER } from './demo-area';

const BLOCK_M = 110;

/** Metres a minute, and resting/peak heart rate, per outdoor demo activity. */
const PROFILES: Record<string, { speed: number; rest: number; peak: number }> = {
  Walking: { speed: 85, rest: 92, peak: 118 },
  Running: { speed: 170, rest: 135, peak: 168 },
  Cycling: { speed: 330, rest: 112, peak: 150 },
};

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast and deterministic. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An L-shaped leg between two lattice nodes, taking either axis first. */
function leg(from: [number, number], to: [number, number], xFirst: boolean): [number, number][] {
  const corner: [number, number] = xFirst ? [to[0], from[1]] : [from[0], to[1]];
  return [corner, to];
}

export function demoRoute(w: WorkoutRecord): CompactRoute | null {
  const profile = PROFILES[w.workout_type];
  if (!profile) return null;
  const random = rng(seedOf(w.id));
  const totalM = profile.speed * Math.max(5, w.duration_minutes);
  // Two waypoints around home, reached and left by L-shaped legs, make a loop
  // whose streets overlap other sessions' loops near home, as real ones do.
  const reach = Math.max(2, Math.round(totalM / BLOCK_M / 5));
  const pick = (): [number, number] => [
    Math.round((random() * 2 - 1) * reach),
    Math.round((random() * 2 - 1) * reach),
  ];
  const home: [number, number] = [0, 0];
  const a = pick();
  const b = pick();
  const nodes: [number, number][] = [home, ...leg(home, a, random() < 0.5), ...leg(a, b, random() < 0.5), ...leg(b, home, random() < 0.5)];

  const cosLat = Math.cos((DEMO_CENTER.lat * Math.PI) / 180);
  const toLatLon = (x: number, y: number): [number, number] => [
    DEMO_CENTER.lat + y / M_PER_DEG_LAT,
    DEMO_CENTER.lon + x / (M_PER_DEG_LAT * cosLat),
  ];

  const start = Date.parse(w.start_time);
  const durationMs = w.duration_minutes * 60_000;
  const stepS = 3;
  const stepM = (profile.speed / 60) * stepS;
  const points: RoutePoint[] = [];
  let elapsedS = 0;
  for (let i = 1; i < nodes.length && elapsedS * 1000 < durationMs; i++) {
    const [x0, y0] = nodes[i - 1].map(v => v * BLOCK_M);
    const [x1, y1] = nodes[i].map(v => v * BLOCK_M);
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < len && elapsedS * 1000 < durationMs; d += stepM) {
      const f = d / len;
      // A few metres of GPS scatter, so sessions do not lie exactly on top of each other.
      const jitter = () => (random() - 0.5) * 8;
      const [lat, lon] = toLatLon(x0 + (x1 - x0) * f + jitter(), y0 + (y1 - y0) * f + jitter());
      points.push({ latitude: lat, longitude: lon, time: new Date(start + elapsedS * 1000).toISOString() });
      elapsedS += stepS;
    }
  }

  const heartRate: HeartRateSample[] = [];
  const minutes = Math.max(1, Math.round(w.duration_minutes));
  for (let m = 0; m <= minutes; m++) {
    const warm = Math.min(1, m / 8);
    const value = profile.rest + (profile.peak - profile.rest) * warm + (random() - 0.5) * 10;
    heartRate.push({ timestamp: new Date(start + m * 60_000).toISOString(), value: Math.round(value) });
  }

  return compactRoute(
    { workoutId: w.id, workoutType: w.workout_type, start: w.start_time, dayKey: workoutDayKey(w) },
    points,
    heartRate
  );
}

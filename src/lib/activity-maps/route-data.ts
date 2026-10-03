// ── Compact routes and heart-rate interpolation (pure) ──
//
// A workout's GPS track held in typed arrays rather than objects: about 13 bytes
// a point instead of a few hundred, which is what lets every route in the
// history sit in memory (~1M points ≈ 13 MB) and be re-aggregated per request.
//
//   lat, lon  Int32 microdegrees (0.11 m; finer than GPS)
//   t         Uint32 seconds since the workout started
//   hr        Uint8 bpm interpolated onto the point, 0 where nothing was measured

export interface RoutePoint {
  latitude: number;
  longitude: number;
  /** ISO instant. */
  time: string;
}

export interface HeartRateSample {
  /** ISO instant. */
  timestamp: string;
  value: number;
}

export interface CompactRoute {
  workoutId: string;
  workoutType: string;
  /** ISO start of the workout. */
  start: string;
  /** Calendar day of the start in the dataset timezone. */
  dayKey: string;
  lat: Int32Array;
  lon: Int32Array;
  t: Uint32Array;
  hr: Uint8Array;
  /** Bounds in microdegrees, for rejecting a route that never enters a box. */
  bounds: { south: number; west: number; north: number; east: number };
}

export const MICRO = 1e6;

/**
 * Heart rate at each instant, interpolated linearly in time between the two
 * bracketing samples.
 *
 * HR arrives about once a minute against a route point a second; reading the
 * nearest sample instead would draw the map in minute-long bands. Outside the
 * sampled span the edge value is HELD rather than extrapolated: a route commonly
 * runs a little past the last sample. With no samples at all every point is null,
 * because "not measured" is not "resting".
 */
export function interpolateHeartRate(timesMs: number[], samples: HeartRateSample[]): (number | null)[] {
  const pts = samples
    .map(s => ({ t: Date.parse(s.timestamp), v: s.value }))
    .filter(s => Number.isFinite(s.t) && Number.isFinite(s.v) && s.v > 0)
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return timesMs.map(() => null);
  let j = 0;
  return timesMs.map(t => {
    if (!Number.isFinite(t)) return null;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    while (j > 0 && pts[j].t > t) j--;
    const a = pts[j];
    const b = pts[j + 1];
    if (b.t === a.t) return b.v;
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  });
}

/**
 * Pack a workout's points into a compact route, or null when it has no usable
 * point. Malformed points are skipped; points are kept in time order.
 */
export function compactRoute(
  meta: { workoutId: string; workoutType: string; start: string; dayKey: string },
  points: RoutePoint[],
  heartRate: HeartRateSample[]
): CompactRoute | null {
  const clean = points
    .map(p => ({ lat: p.latitude, lon: p.longitude, t: Date.parse(p.time) }))
    .filter(
      p =>
        typeof p.lat === 'number' && typeof p.lon === 'number' &&
        Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
        Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 &&
        !(p.lat === 0 && p.lon === 0) && Number.isFinite(p.t)
    )
    .sort((a, b) => a.t - b.t);
  if (clean.length === 0) return null;

  const startMs = Math.min(Date.parse(meta.start) || clean[0].t, clean[0].t);
  const bpm = interpolateHeartRate(clean.map(p => p.t), heartRate);
  const n = clean.length;
  const lat = new Int32Array(n);
  const lon = new Int32Array(n);
  const t = new Uint32Array(n);
  const hr = new Uint8Array(n);
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = clean[i];
    lat[i] = Math.round(p.lat * MICRO);
    lon[i] = Math.round(p.lon * MICRO);
    t[i] = Math.max(0, Math.round((p.t - startMs) / 1000));
    const v = bpm[i];
    hr[i] = v == null ? 0 : Math.min(255, Math.max(1, Math.round(v)));
    if (lat[i] < south) south = lat[i];
    if (lat[i] > north) north = lat[i];
    if (lon[i] < west) west = lon[i];
    if (lon[i] > east) east = lon[i];
  }
  return { ...meta, lat, lon, t, hr, bounds: { south, west, north, east } };
}

export function routeBytes(route: CompactRoute): number {
  return route.lat.byteLength + route.lon.byteLength + route.t.byteLength + route.hr.byteLength;
}

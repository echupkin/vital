import { describe, expect, it } from 'vitest';
import { autoTolerance, computeCoverage, haversineM, smoothOverGraph, strongestStretch, type CoverageQuery } from './coverage';
import { compactRoute, type CompactRoute, type HeartRateSample } from './route-data';
import { M_PER_DEG_LAT, bboxAround } from './types';

const LAT = 40;
const LON = -80;
const M_LON = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);

/** A point `x` metres east and `y` metres north of the origin. */
function at(x: number, y: number): [number, number] {
  return [LAT + y / M_PER_DEG_LAT, LON + x / M_LON];
}

let seq = 0;
function route(
  xy: [number, number][],
  opts: { type?: string; day?: string; stepS?: number; hr?: HeartRateSample[] } = {}
): CompactRoute {
  const start = Date.parse(`${opts.day ?? '2026-09-01'}T12:00:00Z`);
  const step = opts.stepS ?? 2;
  const points = xy.map(([x, y], i) => {
    const [lat, lon] = at(x, y);
    return { latitude: lat, longitude: lon, time: new Date(start + i * step * 1000).toISOString() };
  });
  return compactRoute(
    { workoutId: `w${++seq}`, workoutType: opts.type ?? 'Walk', start: new Date(start).toISOString(), dayKey: opts.day ?? '2026-09-01' },
    points,
    opts.hr ?? []
  )!;
}

/** A straight line from (x0, y) to (x1, y), a point every `every` metres. */
function line(x0: number, x1: number, y = 0, every = 5): [number, number][] {
  const out: [number, number][] = [];
  const dir = x1 >= x0 ? 1 : -1;
  for (let x = x0; dir > 0 ? x <= x1 : x >= x1; x += dir * every) out.push([x, y]);
  return out;
}

const BOX = bboxAround(LAT, LON, 3000);

function query(extra: Partial<CoverageQuery> = {}): CoverageQuery {
  return { bbox: BOX, types: null, range: null, metric: 'frequency', newSinceKey: '2026-08-01', toleranceM: 10, ...extra };
}

describe('computeCoverage', () => {
  it('collapses both sides of a street and both directions into one path counted twice', () => {
    const out = computeCoverage([route(line(0, 500, 0)), route(line(500, 0, 3))], query());
    expect(out.paths).toHaveLength(1);
    expect(out.paths[0].count).toBe(2);
    expect(out.highlights.totals.workouts).toBe(2);
  });

  it('counts pacing back and forth in one workout as one pass', () => {
    const out = computeCoverage([route([...line(0, 300), ...line(300, 0), ...line(0, 300)])], query());
    expect(Math.max(...out.paths.map(p => p.count))).toBe(1);
  });

  it('does not join a route that leaves the box and re-enters with a straight line', () => {
    const small = bboxAround(LAT, LON, 400);
    // East along y=0 inside, out north well past the box, back down further east.
    const xy: [number, number][] = [...line(-150, -20), [-20, 500], [100, 500], ...line(100, 150)];
    const out = computeCoverage([route(xy)], query({ bbox: small }));
    for (const p of out.paths) {
      for (let i = 2; i < p.coords.length; i += 2) {
        expect(haversineM(p.coords[i - 2], p.coords[i - 1], p.coords[i], p.coords[i + 1])).toBeLessThan(40);
      }
    }
    expect(out.paths.length).toBeGreaterThanOrEqual(2);
  });

  it('draws only the range but remembers when each stretch was first travelled', () => {
    const old = route(line(0, 500), { day: '2026-01-10' });
    const repeat = route(line(0, 500), { day: '2026-09-02' });
    const fresh = route(line(0, 500, 400), { day: '2026-09-03' });
    const out = computeCoverage(
      [old, repeat, fresh],
      query({ range: { fromKey: '2026-09-01', toKey: '2026-09-30' }, newSinceKey: '2026-09-01' })
    );
    expect(out.paths.every(p => p.count === 1)).toBe(true);
    expect(out.highlights.totals.workouts).toBe(2);
    // Only the y=400 street is new; the y=0 one was first walked in January.
    expect(out.highlights.coverage.newDistanceM).toBeGreaterThan(400);
    expect(out.highlights.coverage.newDistanceM).toBeLessThan(600);
    expect(out.highlights.coverage.uniqueDistanceM).toBeGreaterThan(900);
    expect(out.highlights.visits).toEqual({ first: '2026-09-02', last: '2026-09-03' });
  });

  it('leaves filtered-out activities off the map but keeps them as choices', () => {
    const out = computeCoverage(
      [route(line(0, 500), { type: 'Walk' }), route(line(0, 500, 300), { type: 'Ride' })],
      query({ types: ['Walk'] })
    );
    expect(out.paths.every(p => p.types.join() === 'Walk')).toBe(true);
    expect(out.types.map(t => t.type).sort()).toEqual(['Ride', 'Walk']);
  });

  it('measures distance and time in the box, skipping gaps longer than a minute', () => {
    const out = computeCoverage([route(line(0, 500), { stepS: 2 })], query());
    expect(out.highlights.totals.distanceM).toBeGreaterThan(490);
    expect(out.highlights.totals.distanceM).toBeLessThan(510);
    expect(out.highlights.totals.seconds).toBe(200);

    const paused = computeCoverage([route(line(0, 500), { stepS: 120 })], query());
    expect(paused.highlights.totals.seconds).toBe(0);
  });

  it('shades heart rate per vertex, null where nothing was measured', () => {
    const start = Date.parse('2026-09-01T12:00:00Z');
    const hr = [
      { timestamp: new Date(start).toISOString(), value: 100 },
      { timestamp: new Date(start + 200_000).toISOString(), value: 160 },
    ];
    const measured = computeCoverage([route(line(0, 500), { hr })], query({ metric: 'heart_rate' }));
    const values = measured.paths.flatMap(p => p.values ?? []);
    expect(values.length).toBeGreaterThan(10);
    expect(values.every(v => v != null && v >= 100 && v <= 160)).toBe(true);
    expect(measured.scale!.min).toBeGreaterThan(100);
    expect(measured.scale!.max).toBeLessThan(160);
    expect(measured.highlights.effort.meanHeartRate).toBeGreaterThan(120);
    expect(measured.highlights.effort.hardest?.meanHeartRate).toBeGreaterThan(120);

    const unmeasured = computeCoverage([route(line(0, 500))], query({ metric: 'heart_rate' }));
    expect(unmeasured.paths.flatMap(p => p.values ?? []).every(v => v === null)).toBe(true);
    expect(unmeasured.scale).toBeNull();
    expect(unmeasured.highlights.effort.meanHeartRate).toBeNull();
  });

  it('smooths frequency along the street, so a short busier strand does not stripe it', () => {
    // Four passes along the street; a fifth covers only 20 m in the middle.
    const four = [0, 1, 2, 3].map(() => route(line(0, 500)));
    const out = computeCoverage([...four, route(line(240, 260))], query());
    expect(out.smoothingM).not.toBeNull();
    const values = out.paths.flatMap(p => p.values ?? []).filter((v): v is number => v != null);
    expect(values.length).toBeGreaterThan(0);
    // The blip is softened rather than drawn as a block of 5x, and the
    // street around it stays at its own 4x.
    expect(Math.max(...values)).toBeLessThan(5);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(4);
    // Highlights keep the raw counts.
    expect(Math.max(...out.paths.map(p => p.count))).toBe(5);
  });

  it('picks the session that went farthest inside the area, not the longest overall', () => {
    // A 4 km route that only clips the area (about 500 m inside it) against an
    // 800 m walk wholly inside.
    const clipping = route(line(1000, 5000, 100), { day: '2026-09-02' });
    const inside = route(line(0, 800), { day: '2026-09-01' });
    const out = computeCoverage([clipping, inside], query());
    const longest = out.highlights.longest!;
    expect(longest.workoutId).toBe(inside.workoutId);
    expect(longest.distanceM).toBeGreaterThan(780);
    expect(longest.distanceM).toBeLessThan(820);
    expect(longest.seconds).toBeGreaterThan(0);
    expect(longest.lines.length).toBe(1);
  });

  it('breaks a tie towards the more recent session', () => {
    const older = route(line(0, 500), { day: '2026-09-01' });
    const newer = route(line(0, 500), { day: '2026-09-05' });
    expect(computeCoverage([older, newer], query()).highlights.longest?.workoutId).toBe(newer.workoutId);
    expect(computeCoverage([newer, older], query()).highlights.longest?.workoutId).toBe(newer.workoutId);
  });

  it('counts only the selected activities and the date range', () => {
    const walk = route(line(0, 1000), { type: 'Walk', day: '2026-09-02' });
    const run = route(line(0, 300), { type: 'Run', day: '2026-09-02' });
    const old = route(line(0, 1200), { type: 'Run', day: '2026-08-01' });
    const out = computeCoverage([walk, run, old], query({ types: ['Run'], range: { fromKey: '2026-09-01', toKey: '2026-09-30' } }));
    expect(out.highlights.longest?.workoutId).toBe(run.workoutId);
  });

  it('draws the session\'s track in pieces where it leaves the area and comes back', () => {
    // Out past the east edge (1500 m) and back, along the same street.
    const outAndBack = route([...line(0, 2000), ...line(2000, 0, 0)]);
    const longest = computeCoverage([outAndBack], query()).highlights.longest!;
    expect(longest.lines.length).toBe(2);
    const edge = at(1500, 0)[1];
    for (const l of longest.lines) for (let i = 1; i < l.length; i += 2) expect(l[i]).toBeLessThanOrEqual(edge + 1e-6);
    // Thinned: far fewer vertices than the 5 m GPS points.
    expect(longest.lines.flat().length / 2).toBeLessThan(600);
  });

  it('drops the least-travelled paths when the vertex budget is pinned', () => {
    const out = computeCoverage(
      [route(line(0, 500)), route(line(0, 500)), route(line(0, 500, 300))],
      query({ maxVertices: 60 })
    );
    expect(out.truncated).toBe(true);
    expect(out.paths.every(p => p.count === 2)).toBe(true);
  });

  it('coarsens the grid instead of exceeding the cell budget', () => {
    const out = computeCoverage([route(line(-1000, 1000, 0, 2))], query({ toleranceM: undefined, maxCells: 50 }));
    expect(out.toleranceM).toBeGreaterThan(autoTolerance(BOX));
    expect(out.paths.length).toBeGreaterThan(0);
  });

  it('closes a ring of uniform properties into one path', () => {
    const ring: [number, number][] = line(0, 195, 0);
    for (let y = 0; y <= 200; y += 5) ring.push([200, y]);
    for (let x = 200; x >= 0; x -= 5) ring.push([x, 200]);
    for (let y = 200; y >= 0; y -= 5) ring.push([0, y]);
    const out = computeCoverage([route(ring)], query());
    expect(out.paths).toHaveLength(1);
    const c = out.paths[0].coords;
    expect(haversineM(c[0], c[1], c[c.length - 2], c[c.length - 1])).toBeLessThan(1);
  });
});

describe('autoTolerance', () => {
  it('scales with the box and stays within 5-50 m', () => {
    expect(autoTolerance(bboxAround(LAT, LON, 500))).toBe(5);
    expect(autoTolerance(bboxAround(LAT, LON, 10_000))).toBe(14);
    expect(autoTolerance(bboxAround(LAT, LON, 200_000))).toBe(50);
  });
});

describe('strongestStretch', () => {
  // Cells 10 m apart. A 300 m street (cells 0..30) walked often, but GPS scatter
  // splits its counts into short runs of 5, 3 and 4; a separate 1 km path
  // (cells 100..200) walked once.
  const edge = (a: number, count: number) => ({
    a, b: a + 1, count, types: new Set<string>(), firstEver: '', firstInRange: '', lastInRange: '',
  });
  const busy = Array.from({ length: 30 }, (_, i) => edge(i, [5, 3, 4][Math.floor(i / 2) % 3]));
  const once = Array.from({ length: 100 }, (_, i) => edge(100 + i, 1));

  it('finds the busiest connected stretch even when scatter breaks it into short runs', () => {
    const stretch = strongestStretch([...busy, ...once], e => e.count, () => 10)!;
    const length = stretch.length * 10;
    expect(length).toBeGreaterThanOrEqual(200);
    expect(Math.min(...stretch.map(e => e.count))).toBe(3);
    expect(stretch.every(e => e.a < 100)).toBe(true);
  });

  it('returns nothing when no edge has a value', () => {
    expect(strongestStretch(busy, () => null, () => 10)).toBeNull();
  });
});

describe('smoothOverGraph', () => {
  // A line of cells 0..20, 10 m apart.
  const line = Array.from({ length: 20 }, (_, i) => ({ a: i, b: i + 1 }));
  const tenMetres = () => 10;

  it('irons out values that alternate cell to cell', () => {
    const out = smoothOverGraph(line, c => (c % 2 === 0 ? 100 : 140), tenMetres, 20);
    const middle = [...Array(11).keys()].map(i => out.get(i + 5)!);
    expect(Math.max(...middle) - Math.min(...middle)).toBeLessThan(5);
    expect(middle.every(v => v > 115 && v < 125)).toBe(true);
  });

  it('keeps a real change, softened over tens of metres rather than flattened', () => {
    const out = smoothOverGraph(line, c => (c < 10 ? 100 : 160), tenMetres, 20);
    expect(out.get(0)!).toBeLessThan(105);
    expect(out.get(20)!).toBeGreaterThan(155);
    expect(out.get(9)!).toBeLessThan(out.get(11)!);
  });

  it('measures along the network, so an unconnected street does not bleed in', () => {
    const two = [...line, { a: 100, b: 101 }];
    const out = smoothOverGraph(two, c => (c >= 100 ? 200 : 100), tenMetres, 20);
    expect(out.get(5)).toBeCloseTo(100);
    expect(out.get(100)).toBeCloseTo(200);
  });

  it('leaves a cell with nothing measured in reach as no reading', () => {
    const out = smoothOverGraph(line, c => (c === 0 ? 120 : null), tenMetres, 10);
    expect(out.get(1)).toBeCloseTo(120);
    expect(out.get(20)).toBeNull();
  });
});

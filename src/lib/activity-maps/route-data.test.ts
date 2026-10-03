import { describe, expect, it } from 'vitest';
import { compactRoute, interpolateHeartRate } from './route-data';

const T0 = Date.parse('2026-09-01T12:00:00Z');
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

describe('interpolateHeartRate', () => {
  const samples = [
    { timestamp: iso(60), value: 100 },
    { timestamp: iso(120), value: 160 },
  ];

  it('interpolates linearly between the bracketing samples', () => {
    expect(interpolateHeartRate([T0 + 90_000], samples)).toEqual([130]);
  });

  it('holds the edge value outside the sampled span instead of extrapolating', () => {
    expect(interpolateHeartRate([T0, T0 + 600_000], samples)).toEqual([100, 160]);
  });

  it('gives null everywhere when nothing was measured', () => {
    expect(interpolateHeartRate([T0, T0 + 1000], [])).toEqual([null, null]);
  });

  it('ignores unordered input and zero or unparseable samples', () => {
    const messy = [samples[1], { timestamp: 'nope', value: 90 }, { timestamp: iso(90), value: 0 }, samples[0]];
    expect(interpolateHeartRate([T0 + 90_000], messy)).toEqual([130]);
  });
});

describe('compactRoute', () => {
  const meta = { workoutId: 'w', workoutType: 'Walk', start: iso(0), dayKey: '2026-09-01' };

  it('packs points as microdegrees, seconds and bpm', () => {
    const r = compactRoute(
      meta,
      [
        { latitude: 40.123456, longitude: -80.654321, time: iso(5) },
        { latitude: 40.123556, longitude: -80.654221, time: iso(6) },
      ],
      [{ timestamp: iso(0), value: 120 }]
    )!;
    expect([...r.lat]).toEqual([40123456, 40123556]);
    expect([...r.lon]).toEqual([-80654321, -80654221]);
    expect([...r.t]).toEqual([5, 6]);
    expect([...r.hr]).toEqual([120, 120]);
    expect(r.bounds).toEqual({ south: 40123456, north: 40123556, west: -80654321, east: -80654221 });
  });

  it('skips malformed and null-island points, and is null with none left', () => {
    const r = compactRoute(
      meta,
      [
        { latitude: NaN, longitude: 1, time: iso(1) },
        { latitude: 0, longitude: 0, time: iso(2) },
        { latitude: 91, longitude: 0, time: iso(3) },
        { latitude: 10, longitude: 10, time: 'bad' },
      ],
      []
    );
    expect(r).toBeNull();
  });

  it('marks points with no reading as 0', () => {
    const r = compactRoute(meta, [{ latitude: 1, longitude: 1, time: iso(1) }], [])!;
    expect([...r.hr]).toEqual([0]);
  });
});

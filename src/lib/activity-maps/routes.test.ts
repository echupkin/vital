import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkoutRecord } from '@/lib/metrics/types';
import { clearRouteStore, loadRoutes, routeStoreStats } from './routes';

const env = { HAE_API_URL: 'http://hae.test', HAE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;

function workout(id: string, end = '2026-09-01T13:00:00Z'): WorkoutRecord {
  return {
    id,
    workout_type: 'Outdoor Walk',
    start_time: '2026-09-01T12:00:00Z',
    end_time: end,
    duration_minutes: 60,
    calories_burned: 200,
    source: 'Health Auto Export',
  };
}

const detail = {
  route: [
    { latitude: 40, longitude: -80, time: '2026-09-01T12:00:01Z' },
    { latitude: 40.0001, longitude: -80, time: '2026-09-01T12:00:02Z' },
  ],
  heartRateData: [{ timestamp: '2026-09-01T12:00:00Z', value: 110 }],
};

function fakeFetch(handler: (id: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const id = decodeURIComponent(url.split('/api/workouts/')[1].split('?')[0]);
    calls.push(url);
    return handler(id);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => clearRouteStore());

describe('loadRoutes', () => {
  it('reads each workout once, with its route and heart rate, and serves it from memory after', async () => {
    const f = fakeFetch(() => json(detail));
    const first = await loadRoutes([workout('a'), workout('b')], 'live', { env, fetchImpl: f.impl });
    expect(first.routes).toHaveLength(2);
    expect([...first.routes[0].hr]).toEqual([110, 110]);
    expect(f.calls[0]).toContain('include=route,heartRateData');

    const again = await loadRoutes([workout('a'), workout('b')], 'live', { env, fetchImpl: f.impl });
    expect(again.routes).toHaveLength(2);
    expect(f.calls).toHaveLength(2);
    expect(again.generation).toBe(first.generation);
  });

  it('re-reads a session whose end time changed', async () => {
    const f = fakeFetch(() => json(detail));
    await loadRoutes([workout('a')], 'live', { env, fetchImpl: f.impl });
    await loadRoutes([workout('a', '2026-09-01T13:30:00Z')], 'live', { env, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(2);
  });

  it('remembers a workout with no route, and one the source no longer has, as having none', async () => {
    const f = fakeFetch(id => (id === 'gone' ? json({ error: 'Workout not found' }, 404) : json({ route: [], heartRateData: [] })));
    const out = await loadRoutes([workout('strength'), workout('gone')], 'live', { env, fetchImpl: f.impl });
    expect(out).toMatchObject({ routes: [], failed: 0 });
    await loadRoutes([workout('strength'), workout('gone')], 'live', { env, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(2);
  });

  it('counts a failed read without caching it, and throws only when every read failed', async () => {
    let fail = true;
    const f = fakeFetch(id => (id === 'b' && fail ? json({ error: 'boom' }, 500) : json(detail)));
    const partial = await loadRoutes([workout('a'), workout('b')], 'live', { env, fetchImpl: f.impl });
    expect(partial).toMatchObject({ failed: 1 });
    expect(partial.routes).toHaveLength(1);
    fail = false;
    const retried = await loadRoutes([workout('a'), workout('b')], 'live', { env, fetchImpl: f.impl });
    expect(retried.routes).toHaveLength(2);

    clearRouteStore();
    const down = fakeFetch(() => json({ error: 'down' }, 503));
    await expect(loadRoutes([workout('x')], 'live', { env, fetchImpl: down.impl })).rejects.toThrow(/HTTP 503/);
  });

  it('evicts the least recently used routes beyond the point cap', async () => {
    const f = fakeFetch(() =>
      json({
        route: Array.from({ length: 6000 }, (_, i) => ({
          latitude: 40 + i * 1e-5,
          longitude: -80,
          time: new Date(Date.parse('2026-09-01T12:00:00Z') + i * 1000).toISOString(),
        })),
      })
    );
    const capped = { ...env, ROUTE_CACHE_MAX_POINTS: '10000' } as unknown as NodeJS.ProcessEnv;
    await loadRoutes([workout('a'), workout('b')], 'live', { env: capped, fetchImpl: f.impl });
    expect(routeStoreStats().points).toBeLessThanOrEqual(10_000);
    expect(routeStoreStats().withRoute).toBe(1);
  });

  it('reads nothing in demo mode', async () => {
    const f = fakeFetch(() => json(detail));
    const out = await loadRoutes([{ ...workout('demo-1'), workout_type: 'Running' }, { ...workout('demo-2'), workout_type: 'Yoga' }], 'demo', {
      env,
      fetchImpl: f.impl,
    });
    expect(f.calls).toHaveLength(0);
    expect(out.routes).toHaveLength(1);
    expect(out.routes[0].lat.length).toBeGreaterThan(100);
  });
});

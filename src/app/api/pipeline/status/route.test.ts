// ── /api/pipeline/status: the full report, or one part of it ────────────────

import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const args: unknown[] = [];
vi.mock('@/lib/pipeline/status', () => ({
  resolvePipelineStatus: async () => {
    calls.push('full');
    return { full: true };
  },
  resolvePart: {
    sources: async (deps: unknown) => (calls.push('sources'), args.push(deps), { part: 'sources' }),
    dataset: async (deps: unknown) => (calls.push('dataset'), args.push(deps), { part: 'dataset' }),
    workouts: async (deps: unknown) => (calls.push('workouts'), args.push(deps), { part: 'workouts' }),
  },
}));

import { GET } from './route';

const get = (query = '') => GET(new Request(`http://localhost/api/pipeline/status${query}`));

describe('GET /api/pipeline/status', () => {
  it('answers the full report without a part, private and uncacheable', async () => {
    calls.length = 0;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ full: true });
    expect(calls).toEqual(['full']);
  });

  it.each(['sources', 'dataset', 'workouts'])('answers ?part=%s with that part alone', async part => {
    calls.length = 0;
    const res = await get(`?part=${part}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ part });
    expect(calls).toEqual([part]);
  });

  it('reads afresh with fresh=1 ("Check again"), and from the caches otherwise', async () => {
    args.length = 0;
    await get('?part=dataset&fresh=1');
    await get('?part=dataset');
    expect(args).toEqual([{ fresh: true }, {}]);
  });

  it('refuses an unknown part and checks nothing', async () => {
    calls.length = 0;
    const res = await get('?part=everything');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sources, dataset, workouts/);
    expect(calls).toEqual([]);
  });
});

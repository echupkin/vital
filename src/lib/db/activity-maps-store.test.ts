import { describe, expect, it } from 'vitest';
import { MapConflictError, MapNotFoundError, createMap, deleteMap, reorderMaps, toActivityMap, updateMap } from './activity-maps-store';
import type { PoolLike } from './pool';
import { bboxAround, defaultMapSettings } from '@/lib/activity-maps/types';

const bbox = bboxAround(37.77, -122.48, 4000);
const row = (id: string, revision = 1, position = 0) => ({
  id,
  position,
  name: 'Home',
  bbox,
  settings: { metric: 'heart_rate', basemap: { provider: 'opentopomap', style: 'terrain', appearance: 'auto' }, range: 30, activityTypes: null },
  revision,
  updated_at: '2026-10-03T12:00:00Z',
});

/** A client that answers each query with the next canned result, recording what it was sent. */
function fake(results: Record<string, unknown>[][]): PoolLike & { sent: { text: string; params?: unknown[] }[] } {
  const sent: { text: string; params?: unknown[] }[] = [];
  return {
    sent,
    async query(text: string, params?: unknown[]) {
      sent.push({ text, params });
      return { rows: results.shift() ?? [] };
    },
  };
}

describe('activity maps store', () => {
  it('reads a row back through the validators, defaulting unknown ids', () => {
    expect(toActivityMap({ ...row('m'), settings: { metric: 'pace' } }).settings.metric).toBe('frequency');
    expect(() => toActivityMap({ ...row('m'), bbox: { south: 2, north: 1, west: 0, east: 1 } })).toThrow(/invalid area/);
  });

  it('appends a new map after the last one', async () => {
    const client = fake([[{ n: 2, last: 4 }], [row('new', 1, 5)]]);
    const map = await createMap(client, { name: 'Home', bbox, settings: defaultMapSettings() });
    expect(map.position).toBe(5);
    expect(client.sent[1].params?.[1]).toBe(5);
  });

  it('refuses a stale update or delete, and names a missing map', async () => {
    await expect(updateMap(fake([[], [{ revision: 3 }]]), 'm', { name: 'x', bbox, settings: defaultMapSettings() }, 2)).rejects.toBeInstanceOf(MapConflictError);
    await expect(deleteMap(fake([[], []]), 'm', 1)).rejects.toBeInstanceOf(MapNotFoundError);
    const ok = await updateMap(fake([[row('m', 3)]]), 'm', { name: 'x', bbox, settings: defaultMapSettings() }, 2);
    expect(ok.revision).toBe(3);
  });

  it('reorders only with a list naming every map exactly once', async () => {
    await expect(reorderMaps(fake([[row('a'), row('b')]]), ['a'])).rejects.toBeInstanceOf(MapConflictError);
    await expect(reorderMaps(fake([[row('a'), row('b')]]), ['a', 'a'])).rejects.toBeInstanceOf(MapConflictError);
    const out = await reorderMaps(fake([[row('a'), row('b')], [], [row('b', 1, 1), row('a', 1, 2)]]), ['b', 'a']);
    expect(out.map(m => m.id)).toEqual(['b', 'a']);
  });
});

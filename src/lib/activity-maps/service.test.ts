import { describe, expect, it } from 'vitest';
import { coverageQuery, parseCoverageRequest } from './service';

const box = 'south=37.75&west=-122.51&north=37.79&east=-122.45';

describe('parseCoverageRequest', () => {
  it('reads the box, repeated types, range and metric', () => {
    const r = parseCoverageRequest(new URLSearchParams(`${box}&type=Walk&type=Ride&type=Walk&range=30&metric=heart_rate`));
    expect(r).toMatchObject({ types: ['Ride', 'Walk'], range: 30, metric: 'heart_rate' });
  });

  it('defaults to every type, all time and frequency', () => {
    expect(parseCoverageRequest(new URLSearchParams(box))).toMatchObject({ types: null, range: 'all', metric: 'frequency' });
  });

  it('answers a malformed query with the reason', () => {
    expect(typeof parseCoverageRequest(new URLSearchParams('south=1'))).toBe('string');
    expect(parseCoverageRequest(new URLSearchParams(`${box}&range=0`))).toMatch(/range/);
    expect(parseCoverageRequest(new URLSearchParams(`${box}&metric=pace`))).toMatch(/metric/);
  });
});

describe('coverageQuery', () => {
  const req = parseCoverageRequest(new URLSearchParams(box));
  if (typeof req === 'string') throw new Error(req);

  it('ends a day range on the reference day, inclusive', () => {
    const q = coverageQuery({ ...req, range: 7 }, '2026-10-03');
    expect(q.range).toEqual({ fromKey: '2026-09-27', toKey: '2026-10-03' });
    expect(q.newSinceKey).toBe('2026-09-27');
  });

  it('counts new ground over the last 30 days when the range is all time', () => {
    const q = coverageQuery(req, '2026-10-03');
    expect(q.range).toBeNull();
    expect(q.newSinceKey).toBe('2026-09-04');
  });
});

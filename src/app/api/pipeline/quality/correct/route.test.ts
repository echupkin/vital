// ── Route tests for data-quality corrections, with an INJECTED pool ──────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PoolLike } from '@/lib/db/pool';

const holder: { client: PoolLike | null; rows: string[]; silenced: string[]; cleared: number } = { client: null, rows: [], silenced: [], cleared: 0 };

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.client,
  closePool: async () => {},
}));
vi.mock('@/lib/adapters/cache', () => ({
  clearLiveCaches: () => {
    holder.cleared++;
  },
}));

import { POST, DELETE } from './route';

/** A pool that holds the quality_correction_off table in memory. */
function fakePool(): PoolLike {
  return {
    async query(text: string, params: unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('INSERT INTO quality_correction_off')) {
        if (!holder.rows.includes(String(params[0]))) holder.rows.push(String(params[0]));
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM quality_correction_off')) {
        holder.rows = holder.rows.filter(r => r !== params[0]);
        return { rows: [] };
      }
      if (sql.startsWith('DELETE FROM quality_silenced WHERE check_id = $1 AND metric_id = $2')) {
        holder.silenced = holder.silenced.filter(r => r !== `${params[0]}:${params[1]}`);
        return { rows: [] };
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  };
}

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/pipeline/quality/correct', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  holder.rows = [];
  holder.silenced = [];
  holder.cleared = 0;
  holder.client = fakePool();
});

describe('DELETE /api/pipeline/quality/correct (stop correcting)', () => {
  it('turns the correction off, drops the cached data, and answers 200, private and uncacheable', async () => {
    const res = await DELETE(req('DELETE', { checkId: 'overlapping-exports' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await res.json()).toEqual({ checkId: 'overlapping-exports', correcting: false });
    expect(holder.rows).toEqual(['overlapping-exports']);
    expect(holder.cleared).toBe(1);
  });

  it('is idempotent', async () => {
    await DELETE(req('DELETE', { checkId: 'duplicate-readings' }));
    expect((await DELETE(req('DELETE', { checkId: 'duplicate-readings' }))).status).toBe(200);
    expect(holder.rows).toEqual(['duplicate-readings']);
  });
});

describe('POST /api/pipeline/quality/correct (fix it)', () => {
  it('turns the correction back on and drops the cached data', async () => {
    await DELETE(req('DELETE', { checkId: 'overlapping-exports' }));
    const res = await POST(req('POST', { checkId: 'overlapping-exports' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkId: 'overlapping-exports', correcting: true });
    expect(holder.rows).toEqual([]);
    expect(holder.cleared).toBe(2);
  });

  it('lifts a silence on that check, turning the correction on or off', async () => {
    holder.silenced = ['overlapping-exports:', 'duplicate-readings:', 'stale:'];
    await POST(req('POST', { checkId: 'overlapping-exports' }));
    expect(holder.silenced).toEqual(['duplicate-readings:', 'stale:']);
    await DELETE(req('DELETE', { checkId: 'duplicate-readings' }));
    expect(holder.silenced).toEqual(['stale:']);
  });

  it.each([
    ['a check Vital cannot correct', { checkId: 'missing-days' }],
    ['an unknown check', { checkId: 'nope' }],
    ['a missing check', {}],
    ['an unknown field', { checkId: 'overlapping-exports', day: '2026-10-01' }],
  ])('answers 400 for %s and changes nothing', async (_n, body) => {
    const res = await POST(req('POST', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\S/);
    expect(holder.cleared).toBe(0);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect((await POST(req('POST', '{nope'))).status).toBe(400);
  });

  it('answers 503 with the reason when no database is configured', async () => {
    holder.client = null;
    const res = await DELETE(req('DELETE', { checkId: 'overlapping-exports' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/No Postgres database is configured/);
    expect(holder.cleared).toBe(0);
  });

  it('answers 500 when the database fails, and keeps the cached data', async () => {
    holder.client = { query: async () => { throw new Error('connection refused'); } };
    expect((await DELETE(req('DELETE', { checkId: 'overlapping-exports' }))).status).toBe(500);
    expect(holder.cleared).toBe(0);
  });
});

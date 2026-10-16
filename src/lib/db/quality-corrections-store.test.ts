import { describe, expect, it } from 'vitest';
import { pgCorrectionOff, pgCorrectionOn, pgReadCorrectionsOff, resolveCorrections } from './quality-corrections-store';
import type { PoolLike } from './pool';

/** An in-memory stand-in for the quality_correction_off table, matching the store's statements. */
class FakeCorrections implements PoolLike {
  rows: { check_id: string }[] = [];
  statements: string[] = [];

  async query(text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    if (sql.startsWith('SELECT check_id FROM quality_correction_off')) {
      return { rows: [...this.rows].sort((a, b) => a.check_id.localeCompare(b.check_id)) };
    }
    if (sql.startsWith('INSERT INTO quality_correction_off') && sql.includes('ON CONFLICT (check_id) DO NOTHING')) {
      if (!this.rows.some(r => r.check_id === params[0])) this.rows.push({ check_id: String(params[0]) });
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM quality_correction_off WHERE check_id = $1')) {
      this.rows = this.rows.filter(r => r.check_id !== params[0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }
}

describe('quality corrections store', () => {
  it('corrects everything until something is turned off', async () => {
    expect([...(await resolveCorrections({ client: new FakeCorrections() }))]).toEqual(['overlapping-exports', 'duplicate-readings']);
  });

  it('turns one off, idempotently, and leaves the other on', async () => {
    const db = new FakeCorrections();
    await pgCorrectionOff(db, 'overlapping-exports');
    await pgCorrectionOff(db, 'overlapping-exports');
    expect(db.rows).toHaveLength(1);
    expect(await pgReadCorrectionsOff(db)).toEqual(['overlapping-exports']);
    expect([...(await resolveCorrections({ client: db }))]).toEqual(['duplicate-readings']);
  });

  it('turns it on again, and turning on what is on is not an error', async () => {
    const db = new FakeCorrections();
    await pgCorrectionOff(db, 'duplicate-readings');
    await pgCorrectionOn(db, 'duplicate-readings');
    await pgCorrectionOn(db, 'duplicate-readings');
    expect(await pgReadCorrectionsOff(db)).toEqual([]);
  });

  it('drops a stored row for a check that is not correctable', async () => {
    const db = new FakeCorrections();
    db.rows.push({ check_id: 'missing-days' });
    expect(await pgReadCorrectionsOff(db)).toEqual([]);
  });

  it('keeps the default, every correction on, without a database or when it fails', async () => {
    expect((await resolveCorrections({ client: null })).size).toBe(2);
    const failing: PoolLike = { query: async () => { throw new Error('connection refused'); } };
    expect((await resolveCorrections({ client: failing })).size).toBe(2);
  });

  it('writes only the check id: no day, range or value reaches the statement', async () => {
    const db = new FakeCorrections();
    await pgCorrectionOff(db, 'overlapping-exports');
    expect(db.statements.join(' ')).not.toMatch(/\b(day|range|value|from|to)\b\s*[,)=]/i);
  });
});

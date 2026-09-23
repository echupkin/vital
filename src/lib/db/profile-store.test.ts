// ── Postgres profile store (offline, injected pool) ──────────────────────────
//
// The store never opens a connection of its own: `getPool` is mocked, so the SQL
// and the row mapping run against a small stateful stand-in — no live database in
// CI. The column list is asserted too, because `sex` is the field this gate adds
// and the whole point is that it is actually written and read back, not merely
// accepted by the validator.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const holder: { pool: unknown; calls: Array<{ text: string; params?: unknown[] }> } = {
  pool: null,
  calls: [],
};

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.pool,
  closePool: async () => {},
}));

import { readProfileRow, writeProfileRow, PROFILE_SCHEMA_VERSION } from '@/lib/db/profile-store';
import { defaultProfile, type VitalProfile } from '@/lib/profile/types';

beforeEach(() => {
  holder.calls = [];
  holder.pool = null;
});

afterEach(() => {
  holder.pool = null;
});

/** A one-row stand-in with just enough behaviour to round-trip a profile. */
function fakePool() {
  let row: Record<string, unknown> | null = null;
  return {
    async query(text: string, params?: unknown[]) {
      holder.calls.push({ text, params });
      if (text.includes('INSERT INTO profile')) {
        const previousRevision = Number(row?.revision ?? 0);
        row = {
          name: params?.[0] ?? null,
          date_of_birth: params?.[1] ?? null,
          sex: params?.[2] ?? null,
          notes: params?.[3] ?? null,
          timezone: params?.[4],
          briefing_hour: params?.[5],
          revision: previousRevision + 1,
          updated_at: new Date('2026-01-02T03:04:05.000Z').toISOString(),
        };
        return { rows: [{ revision: row.revision, updated_at: row.updated_at }] };
      }
      if (text.includes('FROM profile')) {
        return { rows: row ? [{ ...row }] : [] };
      }
      return { rows: [] };
    },
  };
}

const PROFILE: VitalProfile = {
  name: 'Ada Lovelace',
  dateOfBirth: '1815-12-10',
  sex: 'female',
  notes: 'Counts things.',
  timezone: 'Europe/London',
  briefingHour: 7,
};

describe('postgres profile store — the sex field', () => {
  it('writes sex in its own column, in the documented position', async () => {
    holder.pool = fakePool();
    await writeProfileRow(PROFILE);

    const insert = holder.calls.find(call => call.text.includes('INSERT INTO profile'));
    expect(insert).toBeDefined();
    expect(insert!.text).toMatch(/name, date_of_birth, sex, notes, timezone, briefing_hour/);
    // ($1 name, $2 date_of_birth, $3 sex, …)
    expect(insert!.params?.[2]).toBe('female');
    expect(insert!.text).toContain(`${PROFILE_SCHEMA_VERSION}, 1, now()`);
  });

  it('round-trips the whole profile, sex included', async () => {
    holder.pool = fakePool();
    const written = await writeProfileRow(PROFILE);
    expect(written.profile).toEqual(PROFILE);
    expect(written.revision).toBe(1);

    const read = await readProfileRow();
    expect(read?.profile).toEqual(PROFILE);
    expect(read?.profile.sex).toBe('female');

    // A second write bumps the revision, and `sex` survives the update.
    const again = await writeProfileRow({ ...PROFILE, sex: 'male' });
    expect(again.revision).toBe(2);
    expect((await readProfileRow())?.profile.sex).toBe('male');
  });

  it('reads a NULL sex back as null and never as a default', async () => {
    holder.pool = fakePool();
    await writeProfileRow({ ...defaultProfile(), sex: null });
    const read = await readProfileRow();
    expect(read?.profile.sex).toBeNull();
    expect(read?.profile).toEqual({ ...defaultProfile(), sex: null });
  });

  it('refuses a stored row whose sex is not one of the two values', async () => {
    holder.pool = {
      async query() {
        return {
          rows: [
            {
              name: null,
              date_of_birth: null,
              sex: 'unknown',
              notes: null,
              timezone: 'UTC',
              briefing_hour: 6,
              revision: 1,
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      },
    };
    await expect(readProfileRow()).rejects.toThrow(/not a valid profile/);
  });

  it('refuses to write a profile whose sex is not valid', async () => {
    holder.pool = fakePool();
    await expect(
      writeProfileRow({ ...PROFILE, sex: 'other' as unknown as VitalProfile['sex'] })
    ).rejects.toThrow(/Refusing to write an invalid profile/);
    expect(holder.calls).toHaveLength(0);
  });

  it('reports no row when the profile has never been written', async () => {
    holder.pool = fakePool();
    expect(await readProfileRow()).toBeNull();
  });
});
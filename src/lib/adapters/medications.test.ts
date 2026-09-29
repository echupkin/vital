import { afterEach, describe, expect, it } from 'vitest';
import { HaeError } from '@/lib/adapters/hae';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import {
  MEDICATIONS_PATH,
  UNKNOWN_MEDICATION_KEY,
  fetchMedications,
  loadMedications,
  medicationGroupingKey,
  toMedicationRecord,
} from '@/lib/adapters/medications';

const TOKEN = 'test-read-token-do-not-log';
const ENV = {
  HAE_API_URL: 'http://hae.test:3001',
  HAE_API_KEY: TOKEN,
  HAE_CACHE_TTL_SECONDS: '300',
} as unknown as NodeJS.ProcessEnv;

/** A window of upstream records shaped exactly like the verified live payload. */
const SAMPLE: unknown[] = [
  {
    _id: 'a1',
    displayText: 'Carvedilol 6.25mg Oral tablet',
    dosage: 1,
    scheduledDate: '2026-09-28T03:00:00.000Z',
    start: '2026-09-28T03:00:00.000Z',
    end: '2026-09-28T03:00:00.000Z',
    status: 'Taken',
    isArchived: false,
    codings: [
      { code: '1044587', system: 'http://www.nlm.nih.gov/research/umls/rxnorm', version: '' },
    ],
    createdAt: '2026-09-28T04:00:00.000Z',
    updatedAt: '2026-09-28T04:00:00.000Z',
  },
  {
    _id: 'a2',
    displayText: 'Losartan Potassium 50mg, Hydrochlorothiazide 12.5mg Oral tablet',
    dosage: 1,
    scheduledDate: '2026-09-27T17:00:00.000Z',
    status: 'Skipped',
    isArchived: false,
    codings: [],
  },
  {
    // A real record whose scheduledDate is null — must survive, not be dropped.
    _id: 'a3',
    displayText: 'Mots-C',
    dosage: 1,
    scheduledDate: null,
    status: 'Taken',
    isArchived: false,
    codings: [],
  },
];

function recordingFetch(body: unknown = SAMPLE, ok = true, status = 200) {
  const calls: { url: string; apiKey: string | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), apiKey: headers['api-key'] });
    return { ok, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

afterEach(() => {
  liveCache.clear();
  setCacheTtlForTests(null);
});

describe('medications grouping key (§ displayText is free text)', () => {
  it('takes only the leading name, stopping at the dose', () => {
    expect(medicationGroupingKey('Carvedilol 6.25mg Oral tablet')).toBe('Carvedilol');
    expect(medicationGroupingKey('Tesamorelin 2mg Lyophilisate for solution for injection')).toBe(
      'Tesamorelin'
    );
  });

  it('keeps a multi-word name up to the strength boundary', () => {
    expect(medicationGroupingKey('Losartan Potassium 50mg, Hydrochlorothiazide 12.5mg Oral tablet')).toBe(
      'Losartan Potassium'
    );
  });

  it('returns the whole label when no strength is stated (never invents one)', () => {
    expect(medicationGroupingKey('Mots-C')).toBe('Mots-C');
    expect(medicationGroupingKey('Atorvastatin Calcium')).toBe('Atorvastatin Calcium');
    expect(medicationGroupingKey('Retatrutide')).toBe('Retatrutide');
    expect(medicationGroupingKey('Some Drug 5mg')).toBe('Some Drug');
  });

  it('never returns an empty key for an empty label', () => {
    expect(medicationGroupingKey('')).toBe(UNKNOWN_MEDICATION_KEY);
    expect(medicationGroupingKey(null)).toBe(UNKNOWN_MEDICATION_KEY);
    expect(medicationGroupingKey('   ')).toBe(UNKNOWN_MEDICATION_KEY);
  });

  it('preserves the full displayText verbatim on the record', () => {
    const record = toMedicationRecord({
      _id: 'x',
      displayText: 'Carvedilol 6.25mg Oral tablet',
      status: 'Taken',
    });
    expect(record.displayText).toBe('Carvedilol 6.25mg Oral tablet');
    expect(record.groupingKey).toBe('Carvedilol');
  });
});

describe('fetchMedications in a local timezone', () => {
  it("attributes each dose to its day in the caller's zone, widening the upstream window", async () => {
    const { impl, calls } = recordingFetch();
    const result = await fetchMedications(
      { from: '2026-09-27', to: '2026-09-28' },
      { env: ENV, fetchImpl: impl, timezone: 'America/New_York' }
    );
    // UTC days straddle the local ones, so a day is fetched on each side.
    expect(calls[0].url).toContain('from=2026-09-26');
    expect(calls[0].url).toContain('to=2026-09-29');
    // 03:00Z on Sep 28 is 11 PM on Sep 27 in New York.
    expect(result.records.find(r => r.id === 'a1')?.dayKey).toBe('2026-09-27');
    expect(result.records.find(r => r.id === 'a2')?.dayKey).toBe('2026-09-27');
    expect(result.records.find(r => r.id === 'a3')?.dayKey).toBeNull();
    expect(result.window).toEqual({ from: '2026-09-27', to: '2026-09-28' });
  });

  it('trims records that fall outside the requested local days', async () => {
    const { impl } = recordingFetch();
    const result = await fetchMedications(
      { from: '2026-09-28', to: '2026-09-29' },
      { env: ENV, fetchImpl: impl, timezone: 'America/New_York' }
    );
    // Both dated records are on Sep 27 locally; the undated one is kept.
    expect(result.records.map(r => r.id)).toEqual(['a3']);
  });
});

describe('fetchMedications (§ windowed read)', () => {
  it('happy path: sends windows, the api-key header (not Bearer), and maps records', async () => {
    const { impl, calls } = recordingFetch();
    const result = await fetchMedications(
      { from: '2026-09-19', to: '2026-09-28' },
      { env: ENV, fetchImpl: impl }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe(TOKEN);
    expect(calls[0].url).toContain(MEDICATIONS_PATH);
    expect(calls[0].url).toContain('from=2026-09-19');
    expect(calls[0].url).toContain('to=2026-09-28');
    expect(calls[0].url).not.toContain(TOKEN);

    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      id: 'a1',
      displayText: 'Carvedilol 6.25mg Oral tablet',
      groupingKey: 'Carvedilol',
      status: 'Taken',
      dayKey: '2026-09-28',
    });
    expect(result.records[0].codings).toEqual([
      { code: '1044587', system: 'http://www.nlm.nih.gov/research/umls/rxnorm', version: '' },
    ]);
    expect(result.records[1]).toMatchObject({ groupingKey: 'Losartan Potassium', status: 'Skipped' });
    expect(result.window).toEqual({ from: '2026-09-19', to: '2026-09-28' });
    // Covered span is derived from scheduledDates, ignoring the null-dated record.
    expect(result.covered).toEqual({ from: '2026-09-27T17:00:00.000Z', to: '2026-09-28T03:00:00.000Z' });
  });

  it('a window that returns nothing is an honest empty, not an error', async () => {
    const { impl } = recordingFetch([]);
    const result = await fetchMedications(
      { from: '2020-01-01', to: '2020-01-02' },
      { env: ENV, fetchImpl: impl }
    );
    expect(result.records).toEqual([]);
    expect(result.covered).toBeNull();
  });

  it('keeps a record with a null scheduledDate, marked as not attributable to a day', async () => {
    const { impl } = recordingFetch();
    const result = await fetchMedications({}, { env: ENV, fetchImpl: impl });
    const nullDated = result.records.find(r => r.id === 'a3');
    expect(nullDated).toBeDefined();
    expect(nullDated).toMatchObject({
      displayText: 'Mots-C',
      groupingKey: 'Mots-C',
      scheduledDate: null,
      dayKey: null,
    });
  });

  it('treats a non-array body as an error, never as "no data"', async () => {
    const { impl } = recordingFetch({ error: 'nope' });
    await expect(fetchMedications({}, { env: ENV, fetchImpl: impl })).rejects.toMatchObject({
      kind: 'invalid_payload',
    });
  });

  it('surfaces a non-JSON body as an invalid payload', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;
    await expect(fetchMedications({}, { env: ENV, fetchImpl: impl })).rejects.toBeInstanceOf(HaeError);
    await expect(fetchMedications({}, { env: ENV, fetchImpl: impl })).rejects.toMatchObject({
      kind: 'invalid_payload',
    });
  });

  it('surfaces an HTTP error and a timeout as failures', async () => {
    const httpFail = (async () => ({
      ok: false,
      status: 503,
      json: async () => [],
    })) as unknown as typeof fetch;
    await expect(fetchMedications({}, { env: ENV, fetchImpl: httpFail })).rejects.toMatchObject({
      kind: 'http_error',
      httpStatus: 503,
    });

    const abort = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    await expect(fetchMedications({}, { env: ENV, fetchImpl: abort })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('reports not-configured without making a request', async () => {
    const { impl, calls } = recordingFetch();
    await expect(
      fetchMedications({}, { env: {} as NodeJS.ProcessEnv, fetchImpl: impl })
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });
});

describe('loadMedications (§ cache policy)', () => {
  it('serves a repeated window from cache with a single upstream request', async () => {
    setCacheTtlForTests(60_000);
    const { impl, calls } = recordingFetch();
    const deps = { env: ENV, fetchImpl: impl };
    await loadMedications({ from: '2026-09-01', to: '2026-09-30' }, deps);
    await loadMedications({ from: '2026-09-01', to: '2026-09-30' }, deps);
    expect(calls).toHaveLength(1);
  });

  it('bypassCache always hits upstream', async () => {
    const { impl, calls } = recordingFetch();
    const deps = { env: ENV, fetchImpl: impl, bypassCache: true };
    await loadMedications({}, deps);
    await loadMedications({}, deps);
    expect(calls).toHaveLength(2);
  });
});

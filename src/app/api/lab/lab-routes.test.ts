// ── Route-level tests for the lab API, with an INJECTED pool ────────────────
//
// The routes are driven through their real handlers; the only thing replaced is
// the pool, so the request parsing, validation, status codes and messages under
// test are the ones production runs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '@/lib/lab/extract';
import type { PoolLike } from '@/lib/db/pool';

const holder: { client: PoolLike | null } = { client: null };

vi.mock('@/lib/db/pool', () => ({
  getPool: () => holder.client,
  closePool: async () => {},
}));

import { POST as uploadReport, GET as listReportsRoute } from './reports/route';
import { POST as commitReport } from './reports/commit/route';
import { GET as summaryRoute } from './summary/route';
import { PATCH as patchResult } from './results/[id]/route';

const FIXTURE = join(process.cwd(), 'src/lib/lab/__fixtures__/trend-matrix.pdf');
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE));

const SHA = 'b'.repeat(64);

function scriptedPool(rules: Array<{ test: (sql: string) => boolean; rows: (p?: unknown[]) => Record<string, unknown>[] }>): PoolLike {
  return {
    async query(text: string, params?: unknown[]) {
      for (const rule of rules) if (rule.test(text)) return { rows: rule.rows(params) };
      return { rows: [] };
    },
  };
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ORDER_MESSAGE = 'lab order';

beforeEach(() => {
  holder.client = null;
  delete process.env.VITAL_LAB_MAX_BYTES;
  delete process.env.VITAL_LAB_DIR;
});

afterEach(() => {
  delete process.env.VITAL_LAB_MAX_BYTES;
});

describe('POST /api/lab/reports', () => {
  it('rejects a non-PDF with 415', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'notes.txt'));
    const response = await uploadReport(
      new Request('http://test/api/lab/reports', { method: 'POST', body: form })
    );
    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('not a PDF');
  });

  it('rejects an oversize upload with 413', async () => {
    process.env.VITAL_LAB_MAX_BYTES = '64';
    const big = new Uint8Array(200);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const form = new FormData();
    form.append('file', new File([big], 'big.pdf'));
    const response = await uploadReport(
      new Request('http://test/api/lab/reports', { method: 'POST', body: form })
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('64-byte limit');
  });

  it('rejects a request with no file part with 400', async () => {
    const form = new FormData();
    form.append('note', 'nothing here');
    const response = await uploadReport(
      new Request('http://test/api/lab/reports', { method: 'POST', body: form })
    );
    expect(response.status).toBe(400);
  });

  it('returns the EXISTING report for a duplicate hash rather than double-importing', async () => {
    holder.client = scriptedPool([
      {
        test: sql => sql.includes('source_sha256'),
        rows: () => [
          {
            id: '22222222-2222-2222-2222-222222222222',
            kind: 'results',
            document_date: null,
            lab_name: null,
            source_filename: 'trend-matrix.pdf',
            source_sha256: SHA,
            source_bytes: fixtureBytes.byteLength,
            page_count: 1,
            extraction: {},
            notes: null,
            schema_version: 1,
            revision: 1,
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);

    const form = new FormData();
    form.append('file', new File([fixtureBytes], 'trend-matrix.pdf', { type: 'application/pdf' }));
    const response = await uploadReport(
      new Request('http://test/api/lab/reports', { method: 'POST', body: form })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { duplicate: boolean; message: string; report: { id: string }; draft?: unknown };
    expect(body.duplicate).toBe(true);
    expect(body.report.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(body.message).toContain('already stored');
    // No draft is produced for a duplicate: nothing was parsed again.
    expect(body.draft).toBeUndefined();
  });

  it('lists no reports, with the honest reason, when no database is configured', async () => {
    holder.client = null;
    const response = await listReportsRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { available: boolean; reason: string; reports: unknown[] };
    expect(body.available).toBe(false);
    expect(body.reason).toContain('No Postgres database');
    expect(body.reports).toEqual([]);
  });
});

describe('POST /api/lab/reports/commit', () => {
  it('refuses an order form with the kind message and imports nothing', async () => {
    const response = await commitReport(
      jsonRequest('http://test/api/lab/reports/commit', 'POST', { kind: 'order', results: [] })
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain(ORDER_MESSAGE);
    expect(body.error.toLowerCase()).toContain('nothing was imported');
  });

  it('rejects a malformed row with 400 and writes nothing', async () => {
    let queried = false;
    holder.client = {
      async query() {
        queried = true;
        return { rows: [] };
      },
    };
    const response = await commitReport(
      jsonRequest('http://test/api/lab/reports/commit', 'POST', {
        kind: 'results',
        documentDate: '2024-03-04',
        sourceFilename: 'results.pdf',
        sourceSha256: SHA,
        sourceBytes: 4096,
        pageCount: 1,
        results: [{ printedName: 'Sodium', resultOn: 'nope', value: 140 }],
      })
    );
    expect(response.status).toBe(400);
    expect(queried).toBe(false);
  });

  it('inserts the report and its observations in one transaction', async () => {
    const statements: string[] = [];
    holder.client = {
      async query(text: string, params?: unknown[]) {
        statements.push(text.trim().split('\n')[0]!.trim());
        if (text.includes('INSERT INTO lab_reports')) {
          return {
            rows: [
              {
                id: '33333333-3333-3333-3333-333333333333',
                kind: 'results',
                document_date: '2024-03-04',
                lab_name: null,
                source_filename: 'results.pdf',
                source_sha256: SHA,
                source_bytes: 4096,
                page_count: 1,
                extraction: {},
                notes: null,
                schema_version: 1,
                revision: 1,
                created_at: '2024-03-05T00:00:00.000Z',
                updated_at: '2024-03-05T00:00:00.000Z',
              },
            ],
          };
        }
        if (text.includes('INSERT INTO lab_results')) {
          return {
            rows: [
              {
                id: 'result-1',
                report_id: params?.[0],
                line_no: params?.[1],
                analyte_key: params?.[2],
                printed_name: params?.[3],
                result_on: params?.[4],
                value: params?.[5],
                value_text: params?.[6],
                unit: params?.[7],
                ref_low: params?.[8],
                ref_high: params?.[9],
                ref_text: params?.[10],
                ref_source: params?.[11],
                ref_basis: params?.[12],
                printed_flag: params?.[13],
                category: params?.[14],
                extraction_method: params?.[15],
                confidence: params?.[16],
                source_line: params?.[17],
                revision: 1,
                created_at: '',
                updated_at: '',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const response = await commitReport(
      jsonRequest('http://test/api/lab/reports/commit', 'POST', {
        kind: 'results',
        documentDate: '2024-03-04',
        sourceFilename: 'results.pdf',
        sourceSha256: SHA,
        sourceBytes: 4096,
        pageCount: 1,
        results: [{ printedName: 'SGPT (ALT)', resultOn: '2024-03-03', value: 42, unit: 'U/L', refLow: 10, refHigh: 40, refText: '10-40' }],
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { report: { id: string; resultCount: number }; results: unknown[] };
    expect(body.report.resultCount).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(statements.some(s => s.includes('SELECT'))).toBe(true); // the duplicate check
    expect(statements).toContain('BEGIN');
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });

  it('is a 503 when no database is configured', async () => {
    holder.client = null;
    const response = await commitReport(
      jsonRequest('http://test/api/lab/reports/commit', 'POST', {
        kind: 'results',
        documentDate: '2024-03-04',
        sourceFilename: 'results.pdf',
        sourceSha256: SHA,
        sourceBytes: 4096,
        pageCount: 1,
        results: [{ printedName: 'Sodium', resultOn: '2024-03-03', value: 140 }],
      })
    );
    expect(response.status).toBe(503);
  });
});

describe('GET /api/lab/summary', () => {
  it('serves the series read model, with the band chosen from the profile', async () => {
    holder.client = scriptedPool([
      {
        test: sql => sql.includes('FROM profile'),
        rows: () => [{ date_of_birth: '1980-01-01', sex: 'male' }],
      },
      {
        test: sql => sql.includes('FROM lab_results'),
        rows: () => [
          {
            id: 'r1',
            report_id: 'p1',
            line_no: 1,
            analyte_key: 'hemoglobin',
            printed_name: 'Hgb',
            result_on: '2024-01-01',
            value: '15.0',
            value_text: null,
            unit: 'g/dL',
            ref_low: null,
            ref_high: null,
            ref_text: null,
            ref_source: 'none',
            ref_basis: null,
            printed_flag: null,
            category: null,
            extraction_method: 'deterministic',
            confidence: '1',
            source_line: 'Hgb | 15.0',
            revision: 1,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    ]);

    const response = await summaryRoute();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      available: boolean;
      profile: { sexSet: boolean };
      analytes: Array<{ analyteKey: string; points: Array<{ status: string; interval: { origin: string } }> }>;
      totalObservations: number;
    };
    expect(body.available).toBe(true);
    expect(body.profile.sexSet).toBe(true);
    expect(body.totalObservations).toBe(1);
    expect(body.analytes[0]?.analyteKey).toBe('hemoglobin');
    expect(body.analytes[0]?.points[0]?.interval.origin).toBe('reference_table');
    expect(body.analytes[0]?.points[0]?.status).toBe('in_range');
  });
});

describe('PATCH /api/lab/results/[id]', () => {
  it('marks the corrected row manual and returns it', async () => {
    const sqlSeen: string[] = [];
    holder.client = {
      async query(text: string) {
        sqlSeen.push(text);
        return {
          rows: [
            {
              id: '44444444-4444-4444-4444-444444444444',
              report_id: 'p1',
              line_no: 1,
              analyte_key: 'alt',
              printed_name: 'SGPT (ALT)',
              result_on: '2024-03-03',
              value: 44,
              value_text: null,
              unit: 'U/L',
              ref_low: 10,
              ref_high: 40,
              ref_text: '10-40',
              ref_source: 'manual',
              ref_basis: null,
              printed_flag: null,
              category: null,
              extraction_method: 'manual',
              confidence: 1,
              source_line: 'row',
              revision: 2,
              created_at: '',
              updated_at: '',
            },
          ],
        };
      },
    };

    const response = await patchResult(
      jsonRequest('http://test/api/lab/results/44444444-4444-4444-4444-444444444444', 'PATCH', { value: 44 }),
      { params: Promise.resolve({ id: '44444444-4444-4444-4444-444444444444' }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { extractionMethod: string; value: number } };
    expect(body.result.extractionMethod).toBe('manual');
    expect(body.result.value).toBe(44);
    expect(sqlSeen.join(' ')).toContain("extraction_method = 'manual'");
  });

  it('rejects a malformed patch with 400', async () => {
    const response = await patchResult(
      jsonRequest('http://test/api/lab/results/44444444-4444-4444-4444-444444444444', 'PATCH', { value: 'high' }),
      { params: Promise.resolve({ id: '44444444-4444-4444-4444-444444444444' }) }
    );
    expect(response.status).toBe(400);
  });

  it('rejects a non-UUID id with 400', async () => {
    const response = await patchResult(jsonRequest('http://test/api/lab/results/not-an-id', 'PATCH', { value: 1 }), {
      params: Promise.resolve({ id: 'not-an-id' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('the fixture hash the duplicate test relies on', () => {
  it('is a real 64-character hex digest of the committed fixture', () => {
    expect(sha256Of(fixtureBytes)).toMatch(/^[a-f0-9]{64}$/);
  });
});
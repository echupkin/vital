import { describe, it, expect } from 'vitest';
import {
  assertNoPii,
  deleteReport,
  getReport,
  getSeries,
  insertReport,
  listReports,
  replaceResults,
  toLabReport,
  toLabResult,
  updateResult,
  updateResultPanel,
  withTransaction,
  type NewReportInput,
  type NewObservationInput,
} from './lab-store';
import type { PoolLike } from './pool';

interface Rule {
  test: (sql: string) => boolean;
  rows: (params?: unknown[]) => Record<string, unknown>[];
  throws?: Error;
}

/** A scripted fake: records every statement and answers by pattern. */
class FakeDb implements PoolLike {
  readonly queries: { text: string; params?: unknown[] }[] = [];
  constructor(private rules: Rule[]) {}

  async query(text: string, params?: unknown[]) {
    this.queries.push({ text, params });
    for (const rule of this.rules) {
      if (rule.test(text)) {
        if (rule.throws) throw rule.throws;
        return { rows: rule.rows(params) };
      }
    }
    return { rows: [] };
  }

  /** The statements issued, trimmed, in order. */
  get statements(): string[] {
    return this.queries.map(query => query.text.trim().split('\n')[0]!.trim());
  }

  find(pattern: RegExp) {
    return this.queries.filter(query => pattern.test(query.text));
  }
}

const REPORT_ID = '11111111-1111-1111-1111-111111111111';

const REPORT_ROW: Record<string, unknown> = {
  id: REPORT_ID,
  kind: 'results',
  document_date: '2024-03-04',
  lab_name: null,
  source_filename: 'results.pdf',
  source_sha256: 'a'.repeat(64),
  source_bytes: 4096,
  page_count: 1,
  extraction: { parserVersion: 'test' },
  notes: null,
  schema_version: 1,
  revision: 1,
  created_at: '2024-03-05T00:00:00.000Z',
  updated_at: '2024-03-05T00:00:00.000Z',
};

/** A db that answers the report insert and mirrors each result insert back. */
function writingDb(overrides: Rule[] = []): FakeDb {
  return new FakeDb([
    ...overrides,
    {
      test: sql => sql.includes('INSERT INTO lab_reports'),
      rows: () => [REPORT_ROW],
    },
    {
      test: sql => sql.includes('INSERT INTO lab_results'),
      rows: params => [
        {
          id: `result-${String(params?.[1])}`,
          report_id: params?.[0],
          line_no: params?.[1],
          analyte_key: params?.[2],
          printed_name: params?.[3],
          panel: params?.[4],
          result_on: params?.[5],
          value: params?.[6],
          value_text: params?.[7],
          unit: params?.[8],
          ref_low: params?.[9],
          ref_high: params?.[10],
          ref_text: params?.[11],
          ref_source: params?.[12],
          ref_basis: params?.[13],
          printed_flag: params?.[14],
          category: params?.[15],
          extraction_method: params?.[16],
          confidence: params?.[17],
          source_line: params?.[18],
          revision: 1,
          created_at: '2024-03-05T00:00:00.000Z',
          updated_at: '2024-03-05T00:00:00.000Z',
        },
      ],
    },
  ]);
}

const REPORT: NewReportInput = {
  kind: 'results',
  documentDate: '2024-03-04',
  labName: null,
  sourceFilename: 'results.pdf',
  sourceSha256: 'a'.repeat(64),
  sourceBytes: 4096,
  pageCount: 1,
  extraction: { parserVersion: 'test' },
  notes: null,
};

function observation(overrides: Partial<NewObservationInput> = {}): NewObservationInput {
  return {
    lineNo: 1,
    analyteKey: 'sodium',
    printedName: 'Sodium',
    panel: 'Comprehensive Metabolic Panel',
    resultOn: '2024-03-03',
    value: 140,
    valueText: null,
    unit: 'mEq/L',
    refLow: 136,
    refHigh: 145,
    refText: '136-145',
    refSource: 'report',
    refBasis: null,
    printedFlag: null,
    category: null,
    extractionMethod: 'deterministic',
    confidence: 1,
    sourceLine: 'Sodium | 136-145 | 140',
    ...overrides,
  };
}

describe('row mapping', () => {
  it('maps a report row, including a null document date', () => {
    const report = toLabReport({ ...REPORT_ROW, document_date: null });
    expect(report.documentDate).toBeNull();
    expect(report.kind).toBe('results');
    expect(report.revision).toBe(1);
  });

  it('maps numeric columns that arrive as strings, and leaves nulls null', () => {
    const result = toLabResult({
      id: 'r',
      report_id: 'p',
      line_no: '3',
      analyte_key: 'alt',
      printed_name: 'SGPT (ALT)',
      result_on: '2024-03-03',
      value: '42',
      value_text: null,
      unit: 'U/L',
      ref_low: '10',
      ref_high: '40',
      ref_text: '10-40',
      ref_source: 'report',
      ref_basis: null,
      printed_flag: 'H',
      category: null,
      extraction_method: 'deterministic',
      confidence: '1',
      source_line: 'SGPT (ALT) | 10-40 | 42 H',
    });
    expect(result.value).toBe(42);
    expect(result.refLow).toBe(10);
    expect(result.confidence).toBe(1);
    expect(result.valueText).toBeNull();
  });
});

describe('insertReport writes one transaction', () => {
  it('opens, inserts the report and every result, then commits', async () => {
    const db = writingDb();
    const stored = await insertReport(db, REPORT, [observation(), observation({ lineNo: 2, printedName: 'Potassium', analyteKey: 'potassium', value: 4.1 })]);

    expect(stored.report.id).toBe(REPORT_ID);
    expect(stored.results).toHaveLength(2);
    expect(stored.results[1]?.printedName).toBe('Potassium');

    const statements = db.statements;
    expect(statements[0]).toBe('BEGIN');
    expect(statements).toContain('INSERT INTO lab_reports');
    expect(statements.filter(s => s.startsWith('INSERT INTO lab_results'))).toHaveLength(2);
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });

  it('rolls the whole document back when a result insert fails', async () => {
    let seen = 0;
    const db = writingDb([
      {
        test: sql => sql.includes('INSERT INTO lab_results'),
        rows: () => {
          seen += 1;
          if (seen > 1) throw new Error('constraint violation');
          return [
            {
              id: 'result-1',
              report_id: REPORT_ID,
              line_no: 1,
              analyte_key: 'sodium',
              printed_name: 'Sodium',
              result_on: '2024-03-03',
              value: 140,
              value_text: null,
              unit: 'mEq/L',
              ref_low: 136,
              ref_high: 145,
              ref_text: '136-145',
              ref_source: 'report',
              ref_basis: null,
              printed_flag: null,
              category: null,
              extraction_method: 'deterministic',
              confidence: 1,
              source_line: 'Sodium | 136-145 | 140',
              revision: 1,
              created_at: '',
              updated_at: '',
            },
          ];
        },
      },
    ]);

    await expect(insertReport(db, REPORT, [observation(), observation({ lineNo: 2 })])).rejects.toThrow(
      'constraint violation'
    );
    expect(db.statements[0]).toBe('BEGIN');
    expect(db.statements).toContain('ROLLBACK');
    expect(db.statements).not.toContain('COMMIT');
  });

  it('never writes a row whose source line is not redacted', async () => {
    const db = writingDb();
    await expect(
      insertReport(db, REPORT, [observation({ sourceLine: 'Patient: Jane Doe, 123 Main Street' })])
    ).rejects.toThrow('redacted form');
    // Nothing reached the database at all.
    expect(db.queries).toHaveLength(0);
  });
});

describe('assertNoPii', () => {
  it('accepts a redacted line and the redaction marker', () => {
    expect(() => assertNoPii([{ sourceLine: '[redacted: identity or provider details]' }])).not.toThrow();
    expect(() => assertNoPii([{ sourceLine: 'Sodium | 136-145 | 140' }])).not.toThrow();
    expect(() => assertNoPii([{ sourceLine: null }])).not.toThrow();
  });

  it('refuses a raw identity line', () => {
    expect(() => assertNoPii([{ sourceLine: 'Patient: Jane Doe' }])).toThrow();
  });
});

describe('the collision rule', () => {
  it('keeps both rows for one (analyte_key, result_on) and counts the collision', async () => {
    const row = (id: string, value: number, refSource: string) => ({
      id,
      report_id: 'p1',
      line_no: 1,
      analyte_key: 'protein_total',
      printed_name: 'Protein Total',
      result_on: '2024-03-03',
      value,
      value_text: null,
      unit: 'g/dL',
      ref_low: '6.0',
      ref_high: '8.3',
      ref_text: '6.0-8.3',
      ref_source: refSource,
      ref_basis: null,
      printed_flag: null,
      category: null,
      extraction_method: 'deterministic',
      confidence: 1,
      source_line: 'Protein Total | 6.0-8.3 | 7.1',
      revision: 1,
      created_at: '',
      updated_at: '',
    });
    const db = new FakeDb([
      { test: sql => sql.includes('FROM lab_results'), rows: () => [row('r1', 7.1, 'report'), row('r2', 7.4, 'report')] },
    ]);

    const series = await getSeries(db, null);
    expect(series.analytes).toHaveLength(1);
    const analyte = series.analytes[0]!;
    expect(analyte.points).toHaveLength(2);
    expect(analyte.collisions).toBe(1);
    expect(series.collisions).toBe(1);
    expect(analyte.warnings.join(' ')).toContain('more than one observation');
  });
});

describe('the series read model', () => {
  function resultRows() {
    const make = (over: Record<string, unknown>) => ({
      id: String(over.id),
      report_id: 'p1',
      line_no: 1,
      analyte_key: String(over.analyte_key),
      printed_name: String(over.printed_name ?? over.analyte_key),
      result_on: String(over.result_on),
      value: over.value ?? null,
      value_text: over.value_text ?? null,
      unit: over.unit ?? null,
      ref_low: over.ref_low ?? null,
      ref_high: over.ref_high ?? null,
      ref_text: over.ref_text ?? null,
      ref_source: over.ref_source ?? 'none',
      ref_basis: null,
      printed_flag: over.printed_flag ?? null,
      category: null,
      extraction_method: 'deterministic',
      confidence: 1,
      source_line: 'row',
      revision: 1,
      created_at: '',
      updated_at: '',
    });
    return [
      make({ id: 'a1', analyte_key: 'hemoglobin', printed_name: 'Hgb', result_on: '2023-01-01', value: 15.0 }),
      make({ id: 'a2', analyte_key: 'hemoglobin', printed_name: 'Hgb', result_on: '2024-01-01', value: 13.5 }),
      make({
        id: 'b1',
        analyte_key: 'alt',
        printed_name: 'SGPT (ALT)',
        result_on: '2024-01-01',
        value: 42,
        ref_low: 10,
        ref_high: 40,
        ref_text: '10-40',
        ref_source: 'report',
        printed_flag: 'L',
      }),
      make({ id: 'c1', analyte_key: 'psa', printed_name: 'PSA', result_on: '2024-01-01', value: 1.2 }),
      make({ id: 'd1', analyte_key: 'widget_one', printed_name: 'Widget One', result_on: '2024-01-01', value: 3 }),
      make({
        id: 'e1',
        analyte_key: 'creatinine',
        printed_name: 'Creatinine',
        result_on: '2024-01-01',
        value_text: 'TRACE',
      }),
    ];
  }

  it('orders points by date and computes first, last and delta', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, null);
    const hgb = series.analytes.find(a => a.analyteKey === 'hemoglobin')!;
    expect(hgb.points.map(p => p.resultOn)).toEqual(['2023-01-01', '2024-01-01']);
    expect(hgb.first).toEqual({ value: 15.0, on: '2023-01-01' });
    expect(hgb.last).toEqual({ value: 13.5, on: '2024-01-01' });
    expect(hgb.delta).toBeCloseTo(-1.5);
  });

  it('scores against the printed interval, and discloses the flag disagreement', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, null);
    const alt = series.analytes.find(a => a.analyteKey === 'alt')!;
    const point = alt.points[0]!;
    expect(point.interval.origin).toBe('report');
    expect(point.status).toBe('slightly_out_high');
    expect(point.notes.join(' ')).toContain('corroboration only');
    expect(alt.displayName).toBe('Alanine aminotransferase');
  });

  it('leaves an analyte with no agreed interval unscored', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, null);
    const psa = series.analytes.find(a => a.analyteKey === 'psa')!;
    expect(psa.points[0]?.status).toBe('unscored_no_range');
    expect(psa.points[0]?.tone).toBe('neutral');
  });

  it('uses a fallback band and states its provenance when the report printed none', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, { dateOfBirth: '1980-01-01', sex: 'male' });
    const hgb = series.analytes.find(a => a.analyteKey === 'hemoglobin')!;
    const point = hgb.points[1]!;
    expect(point.interval.origin).toBe('reference_table');
    expect(point.interval.refBasis).toBe('male');
    expect(point.status).toBe('out_low');
  });

  it('leaves a sex-specific band unscored when the profile has no sex, and warns', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, { dateOfBirth: '1980-01-01', sex: null });
    const hgb = series.analytes.find(a => a.analyteKey === 'hemoglobin')!;
    const point = hgb.points[1]!;
    expect(point.interval.origin).toBe('none');
    expect(point.status).toBe('unscored_no_range');
    expect(point.notes.join(' ')).toContain('no sex set');
  });

  it('marks an unknown analyte as unregistered and keeps it', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, null);
    const widget = series.analytes.find(a => a.analyteKey === 'widget_one')!;
    expect(widget.registered).toBe(false);
    expect(widget.displayName).toBe('Widget One');
    expect(widget.category).toBe('Other');
  });

  it('reports a non-numeric result as unscored, keeping the printed text', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows: resultRows }]);
    const series = await getSeries(db, null);
    const creat = series.analytes.find(a => a.analyteKey === 'creatinine')!;
    expect(creat.points[0]?.status).toBe('unscored_non_numeric');
    expect(creat.points[0]?.valueText).toBe('TRACE');
    expect(creat.first).toBeNull();
    expect(creat.delta).toBeNull();
  });
});

describe('read helpers', () => {
  it('lists reports with counts and date range', async () => {
    const db = new FakeDb([
      {
        test: sql => sql.includes('FROM lab_reports') && sql.includes('LEFT JOIN'),
        rows: () => [{ ...REPORT_ROW, result_count: '18', analyte_count: '5', date_count: '3', first_result_on: '2021-11-02', last_result_on: '2024-03-03' }],
      },
    ]);
    const reports = await listReports(db);
    expect(reports[0]?.resultCount).toBe(18);
    expect(reports[0]?.analyteCount).toBe(5);
    expect(reports[0]?.firstResultOn).toBe('2021-11-02');
  });

  it('returns null for an unknown report', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_reports'), rows: () => [] }]);
    expect(await getReport(db, '11111111-1111-1111-1111-111111111111')).toBeNull();
  });

  it('reports whether a delete removed a row', async () => {
    const yes = new FakeDb([{ test: sql => sql.includes('DELETE FROM lab_reports'), rows: () => [{ id: 'x' }] }]);
    const no = new FakeDb([{ test: sql => sql.includes('DELETE FROM lab_reports'), rows: () => [] }]);
    expect(await deleteReport(yes, '11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(await deleteReport(no, '11111111-1111-1111-1111-111111111111')).toBe(false);
  });
});

describe('updateResult marks the row manual and bumps its revision', () => {
  it('sets extraction_method manual in the SQL and returns the mapped row', async () => {
    const db = new FakeDb([
      {
        test: sql => sql.includes('UPDATE lab_results'),
        rows: () => [
          {
            id: 'result-1',
            report_id: REPORT_ID,
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
      },
    ]);
    const updated = await updateResult(db, 'result-1', { value: 44, refSource: 'manual' });
    expect(updated?.extractionMethod).toBe('manual');
    expect(updated?.value).toBe(44);
    const sql = db.find(/UPDATE lab_results/)[0]!.text;
    expect(sql).toContain("extraction_method = 'manual'");
    expect(sql).toContain('revision          = revision + 1');
  });

  it('returns null when there is no such row', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('UPDATE lab_results'), rows: () => [] }]);
    expect(await updateResult(db, 'missing', { value: 1 })).toBeNull();
  });
});

describe('replaceResults swaps a report\u2019s observations in one transaction', () => {
  it('deletes, re-inserts, bumps the report revision and commits', async () => {
    const db = writingDb();
    const results = await replaceResults(db, REPORT_ID, [observation()]);
    expect(results).toHaveLength(1);
    const statements = db.statements;
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some(s => s.includes('DELETE FROM lab_results'))).toBe(true);
    expect(statements.some(s => s.includes('UPDATE lab_reports'))).toBe(true);
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });
});

describe('withTransaction', () => {
  it('rolls back and rethrows on a failure inside the callback', async () => {
    const db = new FakeDb([]);
    await expect(
      withTransaction(db, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(db.statements).toEqual(['BEGIN', 'ROLLBACK']);
  });
});

describe('the panel a row was printed under', () => {
  it('is mapped from the row, and is null when the page printed none', () => {
    expect(toLabResult({ id: 'x', analyte_key: 'glucose', panel: 'URINALYSIS, COMPLETE' }).panel).toBe(
      'URINALYSIS, COMPLETE'
    );
    expect(toLabResult({ id: 'x', analyte_key: 'glucose' }).panel).toBeNull();
  });

  it('is refused when a caller hands over identity instead of a panel heading', () => {
    const row = { sourceLine: 'glucose | 78', printedName: 'Glucose', panel: '2501 SAMPLE ST, SAMPLE TX 00000' };
    expect(() => assertNoPii([row])).toThrow(/panel carries identity/);
    // The heading a report really prints shares the `SURNAME, GIVEN` shape with a
    // person's name and must still be accepted.
    expect(() =>
      assertNoPii([{ sourceLine: 'glucose | 78', printedName: 'Glucose', panel: 'URINALYSIS, COMPLETE' }])
    ).not.toThrow();
  });

  it('is written and updated by the panel path alone, never re-inserting the row', async () => {
    const db = new FakeDb([
      {
        test: sql => sql.includes('SET panel'),
        rows: () => [
          {
            id: 'r1',
            report_id: 'p1',
            line_no: 1,
            analyte_key: 'glucose',
            printed_name: 'GLUCOSE, URINE',
            panel: 'URINALYSIS, COMPLETE',
            result_on: '2024-03-03',
            value: null,
            value_text: 'NEGATIVE',
          },
        ],
      },
    ]);
    const updated = await updateResultPanel(db, 'r1', 'URINALYSIS, COMPLETE');
    expect(updated?.panel).toBe('URINALYSIS, COMPLETE');
    const sql = db.queries[0]!.text;
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('RETURNING'));
    expect(setClause).toContain('panel = $2');
    // The measurement, its revision and its creation time are untouched: only the
    // heading the report printed for it is being recorded.
    expect(setClause).not.toContain('value');
    expect(setClause).not.toContain('revision');
    expect(setClause).not.toContain('created_at');
    expect(db.queries[0]!.params).toEqual(['r1', 'URINALYSIS, COMPLETE']);
  });

  it('returns null when there is no such row', async () => {
    const db = new FakeDb([{ test: sql => sql.includes('SET panel'), rows: () => [] }]);
    expect(await updateResultPanel(db, 'missing', 'URINALYSIS, COMPLETE')).toBeNull();
  });
});

describe('the specimen split', () => {
  function rows() {
    const make = (over: Record<string, unknown>) => ({
      id: String(over.id),
      report_id: 'p1',
      line_no: 1,
      analyte_key: String(over.analyte_key),
      printed_name: String(over.printed_name ?? over.analyte_key),
      panel: over.panel ?? null,
      result_on: String(over.result_on),
      value: over.value ?? null,
      value_text: over.value_text ?? null,
      unit: over.unit ?? null,
      ref_low: over.ref_low ?? null,
      ref_high: over.ref_high ?? null,
      ref_text: over.ref_text ?? null,
      ref_source: over.ref_source ?? 'none',
      ref_basis: null,
      printed_flag: null,
      category: null,
      extraction_method: 'deterministic',
      confidence: 1,
      source_line: 'row',
      revision: 1,
      created_at: '',
      updated_at: '',
    });
    return [
      make({
        id: 'g1',
        analyte_key: 'glucose',
        printed_name: 'GLUCOSE',
        panel: 'COMPREHENSIVE METABOLIC PANEL',
        result_on: '2024-03-03',
        value: 78,
        unit: 'mg/dL',
        ref_low: 65,
        ref_high: 99,
        ref_text: '65-99 mg/dL',
        ref_source: 'report',
      }),
      make({
        id: 'g2',
        analyte_key: 'glucose',
        printed_name: 'GLUCOSE, URINE',
        panel: 'URINALYSIS, COMPLETE',
        result_on: '2024-03-03',
        value_text: 'NEGATIVE',
        ref_text: 'NEGATIVE',
        ref_source: 'report',
      }),
      make({
        id: 'p1r',
        analyte_key: 'protein',
        printed_name: 'PROTEIN',
        panel: 'URINALYSIS, COMPLETE',
        result_on: '2024-03-03',
        value_text: 'NEGATIVE',
        ref_text: 'NEGATIVE',
        ref_source: 'report',
      }),
      make({
        id: 'w1',
        analyte_key: 'wbc',
        printed_name: 'WBC',
        panel: 'CBC (INCLUDES DIFF/PLT)',
        result_on: '2024-03-03',
        value: 6.2,
        unit: 'K/uL',
      }),
      make({
        id: 'w2',
        analyte_key: 'wbc',
        printed_name: 'WBC',
        panel: 'URINALYSIS, COMPLETE',
        result_on: '2024-03-03',
        value_text: 'NONE SEEN',
        unit: '/HPF',
        ref_text: '< OR = 5 /HPF',
        ref_source: 'report',
      }),
    ];
  }

  async function series() {
    const db = new FakeDb([{ test: sql => sql.includes('FROM lab_results'), rows }]);
    return getSeries(db, null);
  }

  it('never lets a urine row share a series with the blood rows of the same analyte', async () => {
    const read = await series();
    const glucose = read.analytes.filter(analyte => analyte.analyteKey === 'glucose');
    expect(glucose).toHaveLength(2);

    const blood = glucose.find(analyte => analyte.specimen === 'other')!;
    const urine = glucose.find(analyte => analyte.specimen === 'urine')!;
    expect(blood.points.map(point => point.resultId)).toEqual(['g1']);
    expect(urine.points.map(point => point.resultId)).toEqual(['g2']);
    // The qualitative row can never be drawn, scored or "difference"-ed against
    // the mg/dL one: they are two metrics, labelled apart and grouped apart.
    expect(urine.points.every(point => point.value === null)).toBe(true);
    expect(blood.unit).toBe('mg/dL');
    expect(urine.unit).toBeNull();
    // The registry's unit describes the SERUM assay and must not be borrowed: the
    // urine `wbc` is a sediment count in /HPF, not a blood count in K/uL.
    const wbc = read.analytes.filter(analyte => analyte.analyteKey === 'wbc');
    expect(wbc.find(analyte => analyte.specimen === 'urine')?.unit).toBe('/HPF');
    expect(wbc.find(analyte => analyte.specimen === 'other')?.unit).toBe('thousand/µL (10^3/µL)');
  });

  it('gives the two series distinct ids, labels and categories', async () => {
    const read = await series();
    const glucose = read.analytes.filter(analyte => analyte.analyteKey === 'glucose');
    expect(glucose.map(analyte => analyte.seriesKey).sort()).toEqual(['glucose', 'glucose~urine']);
    expect(glucose.map(analyte => analyte.displayName).sort()).toEqual(['Glucose (blood)', 'Glucose (urine)']);
    expect(glucose.find(analyte => analyte.specimen === 'urine')?.category).toBe('Urinalysis');
    // A urinalysis series carries the headings it was printed under, and says so.
    expect(glucose.find(analyte => analyte.specimen === 'urine')?.panels).toEqual(['URINALYSIS, COMPLETE']);
    expect(glucose.find(analyte => analyte.specimen === 'urine')?.warnings.join(' ')).toMatch(/urinalysis \(urine\)/i);
    // The blood side keeps its ordinary category and name.
    expect(glucose.find(analyte => analyte.specimen === 'other')?.category).toBe('Metabolic');
  });

  it('does not manufacture an empty twin for an analyte that only ever appears in urine', async () => {
    const read = await series();
    const protein = read.analytes.filter(analyte => analyte.analyteKey === 'protein');
    expect(protein).toHaveLength(1);
    expect(protein[0]!.seriesKey).toBe('protein');
    expect(protein[0]!.displayName).toBe('Protein');
    expect(protein[0]!.category).toBe('Urinalysis');
    expect(protein[0]!.split).toBe(false);
  });

  it('keeps a row whose page printed no heading with the analyte’s ordinary series', async () => {
    // No panel is the document making no statement about the specimen, so the row
    // is not moved into the urine series on a guess.
    const db = new FakeDb([
      {
        test: sql => sql.includes('FROM lab_results'),
        rows: () => [{ ...rows()[0]!, panel: null }],
      },
    ]);
    const read = await getSeries(db, null);
    expect(read.analytes).toHaveLength(1);
    expect(read.analytes[0]!.specimen).toBe('other');
    expect(read.analytes[0]!.seriesKey).toBe('glucose');
    expect(read.analytes[0]!.displayName).toBe('Glucose');
  });
});
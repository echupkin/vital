// ── End to end, over the synthetic fixtures ──────────────────────────────────
//
// Each fixture is read the way the application reads an upload, and its exact
// observation set is asserted. The fixtures are hand-built PDFs under
// __fixtures__/ (see scripts/make-lab-fixtures.mjs); they are synthetic and must
// stay that way — no real report, value, name or date may ever be added to them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLabDocument, sha256Of } from '@/lib/lab/extract';
import type { ExtractedObservation } from '@/lib/lab/types';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'src', 'lib', 'lab', '__fixtures__', name)));
}

/** The fields an observation is judged on, so a failure shows only what matters. */
function shape(observation: ExtractedObservation) {
  return {
    analyteKey: observation.analyteKey,
    printedName: observation.printedName,
    resultOn: observation.resultOn,
    value: observation.value,
    valueText: observation.valueText,
    unit: observation.unit,
    refLow: observation.refLow,
    refHigh: observation.refHigh,
    refText: observation.refText,
    printedFlag: observation.printedFlag,
    extractionMethod: observation.extractionMethod,
  };
}

describe('a trend matrix with three date columns', () => {
  it('yields one observation per analyte per printed date', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), {
      filename: 'trend-matrix.pdf',
      modelAssist: false,
    });

    expect(result.kind).toBe('results');
    expect(result.pass).toBe('deterministic');
    expect(result.pageCount).toBe(1);
    expect(result.observations).toHaveLength(18);

    // Each analyte, in full. Counted against the fixture by hand: six blocks of
    // three dates each.
    expect(result.observations.map(shape)).toEqual([
      // 1. A wrapped name, a value above its own name line, the report's flag on
      //    the interval line, and a unit that wraps — all in one row.
      {
        analyteKey: 'widget_one',
        printedName: 'Widget One',
        resultOn: '2020-01-15',
        value: 12.1,
        valueText: null,
        unit: 'u/L',
        refLow: 4,
        refHigh: 12,
        refText: '4.0 - 12.0 u/L',
        printedFlag: 'High',
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'widget_one',
        printedName: 'Widget One',
        resultOn: '2021-06-30',
        value: 9.3,
        valueText: null,
        unit: 'u/L',
        refLow: 4,
        refHigh: 12,
        refText: '4.0 - 12.0 u/L',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'widget_one',
        printedName: 'Widget One',
        resultOn: '2022-03-20',
        value: 8.2,
        valueText: null,
        unit: 'u/L',
        refLow: 4,
        refHigh: 12,
        refText: '4.0 - 12.0 u/L',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      // 2. A ratio interval.
      {
        analyteKey: 'gamma_ratio',
        printedName: 'Gamma Ratio',
        resultOn: '2020-01-15',
        value: 1.1,
        valueText: null,
        unit: 'ratio',
        refLow: 0,
        refHigh: 4.44,
        refText: '0.00 - 4.44 ratio',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'gamma_ratio',
        printedName: 'Gamma Ratio',
        resultOn: '2021-06-30',
        value: 1.2,
        valueText: null,
        unit: 'ratio',
        refLow: 0,
        refHigh: 4.44,
        refText: '0.00 - 4.44 ratio',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'gamma_ratio',
        printedName: 'Gamma Ratio',
        resultOn: '2022-03-20',
        value: 1.3,
        valueText: null,
        unit: 'ratio',
        refLow: 0,
        refHigh: 4.44,
        refText: '0.00 - 4.44 ratio',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      // 3. An interval whose upper bound wrapped.
      {
        analyteKey: 'delta_count',
        printedName: 'Delta Count',
        resultOn: '2020-01-15',
        value: 60,
        valueText: null,
        unit: 'K/ul',
        refLow: 5,
        refHigh: 50,
        refText: '5 - 50 K/ul',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'delta_count',
        printedName: 'Delta Count',
        resultOn: '2021-06-30',
        value: 41,
        valueText: null,
        unit: 'K/ul',
        refLow: 5,
        refHigh: 50,
        refText: '5 - 50 K/ul',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'delta_count',
        printedName: 'Delta Count',
        resultOn: '2022-03-20',
        value: 30,
        valueText: null,
        unit: 'K/ul',
        refLow: 5,
        refHigh: 50,
        refText: '5 - 50 K/ul',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      // 4. The FIRST of two analytes printing the same name, with their own ranges.
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2020-01-15',
        value: 1.5,
        valueText: null,
        unit: 'g/l',
        refLow: 1,
        refHigh: 2,
        refText: '1.0 - 2.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2021-06-30',
        value: 1.6,
        valueText: null,
        unit: 'g/l',
        refLow: 1,
        refHigh: 2,
        refText: '1.0 - 2.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2022-03-20',
        value: 1.7,
        valueText: null,
        unit: 'g/l',
        refLow: 1,
        refHigh: 2,
        refText: '1.0 - 2.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      // 5. The SECOND, same name, different range — it must not be merged away.
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2020-01-15',
        value: 3.5,
        valueText: null,
        unit: 'g/l',
        refLow: 3,
        refHigh: 4,
        refText: '3.0 - 4.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2021-06-30',
        value: 3.6,
        valueText: null,
        unit: 'g/l',
        refLow: 3,
        refHigh: 4,
        refText: '3.0 - 4.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'sigma_total',
        printedName: 'Sigma Total',
        resultOn: '2022-03-20',
        value: 3.7,
        valueText: null,
        unit: 'g/l',
        refLow: 3,
        refHigh: 4,
        refText: '3.0 - 4.0 g/l',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      // 6. Every non-plain result form, kept as printed with no invented number.
      {
        analyteKey: 'epsilon_trace',
        printedName: 'Epsilon Trace',
        resultOn: '2020-01-15',
        value: null,
        valueText: '<0.5',
        unit: 'mg/dL',
        refLow: null,
        refHigh: 100,
        refText: '<100 mg/dL',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'epsilon_trace',
        printedName: 'Epsilon Trace',
        resultOn: '2021-06-30',
        value: null,
        valueText: 'TRACE',
        unit: null,
        refLow: null,
        refHigh: 100,
        refText: '<100 mg/dL',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'epsilon_trace',
        printedName: 'Epsilon Trace',
        resultOn: '2022-03-20',
        value: null,
        valueText: '>39',
        unit: 'mg/dL',
        refLow: null,
        refHigh: 100,
        refText: '<100 mg/dL',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
    ]);
  });

  it('never stores a date of birth, name, address or phone', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), { filename: 'trend-matrix.pdf' });
    const everything = JSON.stringify(result);
    for (const secret of ['Sample Person', 'Date of Birth', 'Jan 1, 1970', 'EXAMPLE ST', '00000-0000', '[SSN]']) {
      expect(everything, secret).not.toContain(secret);
    }
    // The identity line was read and refused, and is recorded only as a marker.
    const identity = result.rejections.find(rejection => rejection.reason === 'identity_line');
    expect(identity?.text).toBe('[redacted: identity or provider details]');
  });

  it('records a reason for every row it refused', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), { filename: 'trend-matrix.pdf' });
    expect(result.rejections.map(rejection => rejection.reason)).toEqual([
      'document_title',
      'notice_line',
      'identity_line',
      'table_caption',
      'column_header',
      'non_metric_row',
    ]);
    // The interval line and the analyte rows were NOT refused.
    expect(result.rejections.some(rejection => rejection.text.includes('Normal Range'))).toBe(false);
  });

  it('gives every observation its own line number', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), { filename: 'trend-matrix.pdf' });
    const numbers = result.observations.map(observation => observation.lineNo);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.min(...numbers)).toBe(1);
  });

  it('says plainly that no document date was printed, instead of inventing one', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), { filename: 'trend-matrix.pdf' });
    expect(result.documentDate).toBeNull();
    expect(result.warnings.map(warning => warning.code)).toContain('document_date_absent');
  });

  it('reads a date out of the filename when the document prints none', async () => {
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), {
      filename: 'Result Trends - Panel - Mar 3, 2019.PDF',
    });
    expect(result.documentDate).toBe('2019-03-03');
  });

  it('hashes the bytes it was given', async () => {
    const bytes = fixture('trend-matrix.pdf');
    const result = await extractLabDocument(bytes, { filename: 'trend-matrix.pdf' });
    expect(result.sourceSha256).toBe(sha256Of(bytes));
    expect(result.sourceBytes).toBe(bytes.byteLength);
  });
});

describe('a single-date table', () => {
  it('reads one column and one observation per analyte', async () => {
    const result = await extractLabDocument(fixture('single-date.pdf'), { filename: 'single-date.pdf' });
    expect(result.kind).toBe('results');
    expect(result.observations.map(shape)).toEqual([
      {
        analyteKey: 'alpha_analyte',
        printedName: 'Alpha Analyte',
        resultOn: '2021-02-02',
        value: 2,
        valueText: null,
        unit: 'mg/dL',
        refLow: 1,
        refHigh: 3,
        refText: '1.0 - 3.0',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
      {
        analyteKey: 'beta_analyte',
        printedName: 'Beta Analyte',
        resultOn: '2021-02-02',
        value: 5,
        valueText: null,
        unit: 'mg/dL',
        refLow: 4,
        refHigh: 6,
        refText: '4.0 - 6.0',
        printedFlag: null,
        extractionMethod: 'deterministic',
      },
    ]);
  });

  it('takes the document date from the field the document printed', async () => {
    const result = await extractLabDocument(fixture('single-date.pdf'), { filename: 'single-date.pdf' });
    expect(result.documentDate).toBe('2021-02-02');
  });
});

describe('an order form', () => {
  it('is recognised as an order, produces no results, and says so', async () => {
    const result = await extractLabDocument(fixture('order-form.pdf'), { filename: 'order-form.pdf' });
    expect(result.kind).toBe('order');
    expect(result.observations).toEqual([]);
    expect(result.pass).toBe('none');
    expect(result.notes).toMatch(/order form/i);
    // The tests it lists are read and refused with a reason, not parsed as results.
    expect(result.rejections.filter(rejection => rejection.reason === 'order_entry').length).toBeGreaterThanOrEqual(3);
  });

  it('still stores none of the identity fields on the form', async () => {
    const result = await extractLabDocument(fixture('order-form.pdf'), { filename: 'order-form.pdf' });
    const everything = JSON.stringify(result);
    for (const secret of ['Sample Person', 'Date of Birth', 'Jan 1, 1970', 'EXAMPLE ST', 'SAMPLEVILLE', '[SSN]', '(000) 000-0000']) {
      expect(everything, secret).not.toContain(secret);
    }
  });
});

describe('a page with no text layer', () => {
  it('says it looks like a scan rather than returning silently empty rows', async () => {
    const result = await extractLabDocument(fixture('scan-like.pdf'), { filename: 'scan-like.pdf' });
    expect(result.kind).toBe('unknown');
    expect(result.observations).toEqual([]);
    const warning = result.warnings.find(entry => entry.code === 'page_without_text');
    expect(warning?.message).toMatch(/OCR is not implemented/);
    expect(warning?.page).toBe(1);
  });
});

describe('the optional model pass', () => {
  it('is never offered when the deterministic pass already read rows', async () => {
    let asked = 0;
    const result = await extractLabDocument(fixture('trend-matrix.pdf'), {
      filename: 'trend-matrix.pdf',
      modelDeps: {
        complete: async () => {
          asked += 1;
          return { text: '{}' };
        },
      },
    });
    expect(asked).toBe(0);
    expect(result.pass).toBe('deterministic');
    expect(result.warnings.some(warning => warning.code === 'deterministic_pass_empty')).toBe(false);
  });
});
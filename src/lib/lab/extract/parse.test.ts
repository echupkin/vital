// ── The interpretation rules, one form at a time ─────────────────────────────
//
// Every form here is one the documents actually print. A form that is NOT listed
// must come back null rather than a plausible guess — that is the property these
// tests exist to pin down.

import { describe, expect, it } from 'vitest';
import { classifyLine, parsePrintedDate, stripRangeLabel } from '@/lib/lab/extract/layout';
import {
  analyteKeyFor,
  confidenceOf,
  countOrderEntries,
  detectDocumentDate,
  detectDocumentKind,
  detectLabName,
  hasPii,
  parseFlag,
  parseRangeText,
  parseValueCell,
  redact,
} from '@/lib/lab/extract/parse';
import type { DocumentLayout } from '@/lib/lab/extract/layout';

/** The smallest layout that says "there is a results table here". */
function layoutWith(overrides: Partial<DocumentLayout> = {}): DocumentLayout {
  return {
    pages: [],
    headers: [],
    blocks: [],
    lines: [],
    classified: [],
    warnings: [],
    ...overrides,
  };
}

describe('result cell forms', () => {
  it('reads a plain number, with and without a unit', () => {
    expect(parseValueCell('12.3')).toEqual({ value: 12.3, valueText: null, unit: null });
    expect(parseValueCell('1.03')).toEqual({ value: 1.03, valueText: null, unit: null });
    expect(parseValueCell('0.0')).toEqual({ value: 0, valueText: null, unit: null });
    expect(parseValueCell('2,000')).toEqual({ value: 2000, valueText: null, unit: null });
    expect(parseValueCell('12.1 %')).toEqual({ value: 12.1, valueText: null, unit: '%' });
    expect(parseValueCell('161 mg/dL')).toEqual({ value: 161, valueText: null, unit: 'mg/dL' });
    expect(parseValueCell('3.73 ratio')).toEqual({ value: 3.73, valueText: null, unit: 'ratio' });
  });

  it('reads a compound unit exactly as printed', () => {
    expect(parseValueCell('86.85 mL/min/1.73m^2')).toEqual({
      value: 86.85,
      valueText: null,
      unit: 'mL/min/1.73m^2',
    });
  });

  it('keeps a bounded result as printed and invents no number', () => {
    expect(parseValueCell('<0.5')).toEqual({ value: null, valueText: '<0.5', unit: null });
    expect(parseValueCell('<=200')).toEqual({ value: null, valueText: '<=200', unit: null });
    expect(parseValueCell('>39')).toEqual({ value: null, valueText: '>39', unit: null });
    expect(parseValueCell('<= 200 mg/dL')).toEqual({ value: null, valueText: '<=200', unit: 'mg/dL' });
  });

  it('keeps a qualitative result exactly as the report spelled it', () => {
    expect(parseValueCell('NEGATIVE')).toEqual({ value: null, valueText: 'NEGATIVE', unit: null });
    expect(parseValueCell('Negative')).toEqual({ value: null, valueText: 'Negative', unit: null });
    expect(parseValueCell('TRACE')).toEqual({ value: null, valueText: 'TRACE', unit: null });
    expect(parseValueCell('+')).toEqual({ value: null, valueText: '+', unit: null });
  });

  it('refuses a cell it cannot read rather than guessing one', () => {
    expect(parseValueCell('')).toBeNull();
    expect(parseValueCell('Yes')).toBeNull();
    expect(parseValueCell('1.2.3')).toBeNull();
    expect(parseValueCell('mg/dL')).toBeNull();
  });
});

describe('reference interval forms', () => {
  it('reads a two-sided interval in every printed separator', () => {
    for (const text of ['140 - 200 mg/dL', '70-99', '70 – 99', '70 to 99', '0.00 - 4.44 ratio', '3.5 - 5.6 %']) {
      const parsed = parseRangeText(text);
      expect(parsed, text).not.toBeNull();
      expect(parsed?.refText).toBe(text);
      expect(parsed?.refLow).not.toBeNull();
      expect(parsed?.refHigh).not.toBeNull();
    }
  });

  it('keeps a one-sided interval one-sided', () => {
    expect(parseRangeText('>40 mg/dL')).toMatchObject({ refLow: 40, refHigh: null, refText: '>40 mg/dL' });
    expect(parseRangeText('<100 mg/dL')).toMatchObject({ refLow: null, refHigh: 100 });
    expect(parseRangeText('<= 200')).toMatchObject({ refLow: null, refHigh: 200 });
    expect(parseRangeText('>= 40')).toMatchObject({ refLow: 40, refHigh: null });
  });

  it('reads the unit carried by the interval', () => {
    expect(parseRangeText('>60.00 mL/min/1.73m^2')?.unit).toBe('mL/min/1.73m^2');
    expect(parseRangeText('70-99')?.unit).toBeNull();
  });

  it('strips only the printed label', () => {
    expect(stripRangeLabel('Normal Range: 135 - 145 mm/L')).toBe('135 - 145 mm/L');
    expect(stripRangeLabel('Normal Range:6.1 - 8.3')).toBe('6.1 - 8.3');
  });

  it('refuses an interval it cannot read', () => {
    expect(parseRangeText('')).toBeNull();
    expect(parseRangeText('see note')).toBeNull();
  });
});

describe('flag tokens', () => {
  it('accepts exactly the markers a report prints', () => {
    for (const flag of ['H', 'L', 'HH', 'LL', 'A', 'High', 'Low']) {
      expect(parseFlag(flag)).toBe(flag);
    }
  });

  it('refuses anything else', () => {
    expect(parseFlag('Normal')).toBeNull();
    expect(parseFlag('12.1')).toBeNull();
    expect(parseFlag('')).toBeNull();
  });
});

describe('analyte aliases', () => {
  it('maps the printed names the documents use', () => {
    expect(analyteKeyFor('SGPT (ALT)')).toBe('alt');
    expect(analyteKeyFor('SGOT (AST)')).toBe('ast');
    expect(analyteKeyFor('Glycohemoglobin (GHb),Total')).toBe('hba1c');
    expect(analyteKeyFor('Glycohemoglobin')).toBe('hba1c');
    expect(analyteKeyFor('CHD')).toBe('cholesterol_hdl_ratio');
    expect(analyteKeyFor('NE%')).toBe('neutrophils_pct');
    expect(analyteKeyFor('LY%')).toBe('lymphocytes_pct');
    expect(analyteKeyFor('MO%')).toBe('monocytes_pct');
    expect(analyteKeyFor('EO%')).toBe('eosinophils_pct');
    expect(analyteKeyFor('BA%')).toBe('basophils_pct');
    expect(analyteKeyFor('NE#')).toBe('neutrophils_abs');
    expect(analyteKeyFor('BA#')).toBe('basophils_abs');
    expect(analyteKeyFor('HGB')).toBe('hemoglobin');
    expect(analyteKeyFor('Estimated Average Glucose')).toBe('estimated_average_glucose');
  });

  it('keeps a percentage and an absolute count apart', () => {
    expect(analyteKeyFor('MO%')).not.toBe(analyteKeyFor('MO#'));
  });

  it('slugs an unknown name instead of dropping it', () => {
    expect(analyteKeyFor('Some New Marker')).toBe('some_new_marker');
    expect(analyteKeyFor('Protein Total')).toBe('protein_total');
  });
});

describe('document kind', () => {
  it('is results when there is a date-header row', () => {
    const layout = layoutWith({
      headers: [{ page: 1, lineNo: 1, y: 700, columns: [] }],
    });
    expect(detectDocumentKind('Component Jan 1, 2020', layout).kind).toBe('results');
  });

  it('is results when intervals are printed, even without a header', () => {
    expect(detectDocumentKind('Normal Range: 1 - 2 mg/dL', layoutWith()).kind).toBe('results');
  });

  it('is an order form when it lists Profiles/Tests and prints no values', () => {
    const text = ['Profiles/Tests', '100 - One [SERUM]', '200 - Two [SERUM]', '300 - Three [BLOOD]'].join('\n');
    const decision = detectDocumentKind(text, layoutWith());
    expect(decision.kind).toBe('order');
    expect(decision.reason).toMatch(/order form/i);
    expect(countOrderEntries(text)).toBe(3);
  });

  it('is unknown when it is neither', () => {
    expect(detectDocumentKind('Dear reader', layoutWith()).kind).toBe('unknown');
  });
});

describe('document date', () => {
  it('prefers an explicit printed field', () => {
    expect(
      detectDocumentDate({ text: 'Report Date: Feb 2, 2021', filename: 'x.pdf', creationDate: '2020-01-01' })
    ).toBe('2021-02-02');
    expect(
      detectDocumentDate({ text: 'Collection Date: 03/04/2021', filename: 'x.pdf', creationDate: null })
    ).toBe('2021-03-04');
  });

  it('falls back to the file, then the filename, then nothing', () => {
    expect(detectDocumentDate({ text: 'no date here', filename: null, creationDate: '2020-05-06' })).toBe('2020-05-06');
    expect(
      detectDocumentDate({ text: 'no date here', filename: 'Result Trends - Panel - Mar 3, 2019.PDF', creationDate: null })
    ).toBe('2019-03-03');
    expect(detectDocumentDate({ text: 'no date here', filename: 'panel.pdf', creationDate: null })).toBeNull();
  });

  it('does not treat a label with no value as a date', () => {
    expect(detectDocumentDate({ text: 'Collection Date:      Time:', filename: null, creationDate: null })).toBeNull();
  });

  it('never reads a date out of a result cell', () => {
    // The table's own date range and a result-shaped date are not the document's
    // production date.
    expect(
      detectDocumentDate({
        text: 'Results found from Mar 3, 2019 - Nov 2, 2021.\nComponent  Mar 3, 2019',
        filename: null,
        creationDate: null,
      })
    ).toBeNull();
  });
});

describe('printed dates', () => {
  it('accepts the printed shapes', () => {
    expect(parsePrintedDate('Mar 3, 2019')).toBe('2019-03-03');
    expect(parsePrintedDate('Mar 3 2019')).toBe('2019-03-03');
    expect(parsePrintedDate('08/31/2023')).toBe('2023-08-31');
    expect(parsePrintedDate('2023-08-31')).toBe('2023-08-31');
  });

  it('refuses a date-shaped string that is not a real date', () => {
    expect(parsePrintedDate('Feb 30, 2021')).toBeNull();
    expect(parsePrintedDate('13/45/2020')).toBeNull();
    expect(parsePrintedDate('not a date')).toBeNull();
  });
});

describe('the laboratory', () => {
  it('is read only when the document names itself', () => {
    expect(detectLabName('Quest Diagnostics Incorporated')).toBe('Quest Diagnostics');
    expect(detectLabName('Laboratory Corporation of America')).toBe('LabCorp');
    expect(detectLabName('Result Trends')).toBeNull();
  });
});

describe('identity data', () => {
  const sensitive = [
    'Sample Person   Date of Birth: Jan 1, 1970',
    'SSN: 000-00-0000',
    '123 EXAMPLE ST',
    'SAMPLEVILLE, CA 00000-0000',
    'Home Phone: (000) 000-0000',
    'Ref Physician Provider ID: SAMPLE,PROVIDER',
    'NPI: [NPI]',
    'SAMPLE, PROVIDER',
  ];

  it('recognises identity, contact and provider data', () => {
    for (const line of sensitive) expect(hasPii(line), line).toBe(true);
  });

  it('replaces a whole identity line rather than quoting part of it', () => {
    for (const line of sensitive) {
      const safe = redact(line);
      expect(safe).toBe('[redacted: identity or provider details]');
      expect(safe).not.toContain('Sample');
      expect(safe).not.toContain('00000');
    }
  });

  it('leaves an analyte row alone', () => {
    const line = 'Cholesterol | 140 - 200 mg/dL | 161 mg/dL  151 mg/dL';
    expect(hasPii(line)).toBe(false);
    expect(redact(line)).toBe(line);
  });
});

describe('rejection reasons', () => {
  it('names a reason for every non-metric row shape', () => {
    expect(classifyLine('Result Trends', true)).toBe('document_title');
    expect(classifyLine('Results limited to those after Apr 8, 2021.', true)).toBe('notice_line');
    expect(classifyLine('Mar 3, 2019 - Nov 2, 2021 (Table 1 of 1)', true)).toBe('table_caption');
    expect(classifyLine('Sample Person Date of Birth: Jun 20, 1976', true)).toBe('identity_line');
    expect(classifyLine('Component', true)).toBe('column_header');
    expect(classifyLine('Fasting? Yes Yes Yes', false)).toBe('non_metric_row');
    expect(classifyLine('6399 - CBC (includes Differential and Platelets) [BLOOD]', false)).toBe('order_entry');
    expect(classifyLine('09/16/2026', false)).toBe('not_a_result_line');
    expect(classifyLine('Page # 1', false)).toBe('not_a_result_line');
    expect(classifyLine('   ', false)).toBe('empty');
    expect(classifyLine('Sodium', false)).toBeNull();
  });

  it('refuses a line above the table that is not otherwise recognised', () => {
    expect(classifyLine('Something unfamiliar here', true)).toBe('outside_table_region');
  });
});

describe('confidence', () => {
  it('is 1 when name, value, unit and interval all read', () => {
    expect(confidenceOf({ name: 'X', hasValue: true, unit: 'mg/dL', range: '1 - 2 mg/dL' })).toBe(1);
  });

  it('falls by a quarter for each field that is missing', () => {
    expect(confidenceOf({ name: 'X', hasValue: true, unit: null, range: '1 - 2' })).toBe(0.75);
    expect(confidenceOf({ name: 'X', hasValue: false, unit: null, range: null })).toBe(0.25);
  });
});
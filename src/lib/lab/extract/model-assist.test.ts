// ── The optional second pass ─────────────────────────────────────────────────
//
// The pass exists for a layout the deterministic parser has never seen. What this
// file pins down is its two safety properties: an identity line never reaches the
// prompt, and nothing the model says is kept unless it is verbatim in the
// document. It also pins down that a configured-but-unusable environment asks
// nobody anything.

import { describe, expect, it } from 'vitest';
import {
  assistExtraction,
  appearsInSource,
  readCandidates,
  validateCandidate,
} from '@/lib/lab/extract/model-assist';

const SOURCE = [
  'Component   Jan 15, 2020   Jun 30, 2021',
  'Sample Person   Date of Birth: Jan 1, 1970',
  'Widget One',
  'Normal Range: 4.0 - 12.0 u/L',
  '12.1 u/L',
  'High',
].join('\n');

const DATES = new Set(['2020-01-15', '2021-06-30']);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    lineNo: 4,
    printedName: 'Widget One',
    resultOn: '2020-01-15',
    value: 12.1,
    valueText: null,
    unit: 'u/L',
    refText: '4.0 - 12.0 u/L',
    printedFlag: 'High',
    ...overrides,
  };
}

describe('validation against the document', () => {
  it('accepts a row that is entirely verbatim', () => {
    const verdict = validateCandidate(candidate(), SOURCE, DATES);
    expect(verdict.ok).toBe(true);
  });

  it('refuses a name the document does not print', () => {
    const verdict = validateCandidate(candidate({ printedName: 'Invented Analyte' }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toMatch(/not in the document/);
  });

  it('refuses a value the document does not print', () => {
    const verdict = validateCandidate(candidate({ value: 999 }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toMatch(/value/);
  });

  it('refuses a printed result the document does not print', () => {
    const verdict = validateCandidate(candidate({ value: null, valueText: '<0.5' }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
  });

  it('refuses a unit the document does not print', () => {
    const verdict = validateCandidate(candidate({ unit: 'mmol/L' }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toMatch(/unit/);
  });

  it('refuses an interval the document does not print', () => {
    const verdict = validateCandidate(candidate({ refText: '1.0 - 2.0 mg/dL' }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toMatch(/interval/);
  });

  it('refuses a date that is not one of the printed columns', () => {
    const verdict = validateCandidate(candidate({ resultOn: '2019-03-03' }), SOURCE, DATES);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toMatch(/column/);
  });

  it('refuses a row with no result at all', () => {
    expect(validateCandidate(candidate({ value: null, valueText: null }), SOURCE, DATES)).toMatchObject({ ok: false });
  });

  it('refuses a candidate that is not an object', () => {
    expect(validateCandidate('Widget One 12.1', SOURCE, DATES)).toMatchObject({ ok: false });
    expect(validateCandidate(null, SOURCE, DATES)).toMatchObject({ ok: false });
  });

  it('compares after whitespace normalisation only', () => {
    expect(appearsInSource(SOURCE, '4.0   -    12.0 u/L')).toBe(true);
    expect(appearsInSource(SOURCE, '4.0-12.0 u/L')).toBe(false);
    expect(appearsInSource(SOURCE, '')).toBe(false);
    expect(appearsInSource(SOURCE, null)).toBe(true);
  });
});

describe('reading the reply', () => {
  it('reads the documented object shape', () => {
    expect(readCandidates('{"observations":[{"printedName":"X"}]}')).toHaveLength(1);
  });

  it('reads a bare array, and a fenced block', () => {
    expect(readCandidates('[{"printedName":"X"}]')).toHaveLength(1);
    expect(readCandidates('```json\n{"observations":[{"printedName":"X"}]}\n```')).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a reply it cannot read', () => {
    expect(readCandidates('I am not sure how to read this document.')).toEqual([]);
    expect(readCandidates('')).toEqual([]);
  });
});

const COLUMNS = [{ dateText: 'Jan 15, 2020', date: '2020-01-15' }];
/** The lines the candidate above is drawn from; validation reads these. */
const LINES = [
  { lineNo: 1, text: 'Component   Jan 15, 2020' },
  { lineNo: 2, text: 'Widget One' },
  { lineNo: 3, text: 'Normal Range: 4.0 - 12.0 u/L' },
  { lineNo: 4, text: '12.1 u/L' },
  { lineNo: 5, text: 'High' },
];

describe('the pass itself', () => {
  it('asks nobody when no provider is configured', async () => {
    const result = await assistExtraction(
      { lines: LINES, columns: COLUMNS },
      { env: {} as NodeJS.ProcessEnv }
    );
    expect(result.attempted).toBe(false);
    expect(result.observations).toEqual([]);
    expect(result.provider).toBeNull();
  });

  it('keeps only the rows that validate, and reports what it dropped', async () => {
    const result = await assistExtraction(
      { lines: LINES, columns: COLUMNS },
      {
        complete: async () => ({
          text: JSON.stringify({
            observations: [candidate(), candidate({ printedName: 'Invented Analyte', lineNo: 1 })],
          }),
        }),
      }
    );

    expect(result.attempted).toBe(true);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      printedName: 'Widget One',
      resultOn: '2020-01-15',
      value: 12.1,
      unit: 'u/L',
      refText: '4.0 - 12.0 u/L',
      printedFlag: 'High',
      extractionMethod: 'model',
      refSource: 'report',
    });
    expect(result.dropped).toHaveLength(1);
    expect(result.warnings.map(warning => warning.code)).toContain('model_rows_dropped');
  });

  it("numbers the rows it keeps, and does not trust the model's own numbering", async () => {
    const result = await assistExtraction(
      { lines: LINES, columns: COLUMNS },
      { complete: async () => ({ text: JSON.stringify({ observations: [candidate({ lineNo: 501 })] }) }) }
    );
    expect(result.observations.map(observation => observation.lineNo)).toEqual([1]);
  });

  it('keeps the row text it validated, not the model\'s claim about it', async () => {
    const result = await assistExtraction(
      { lines: LINES, columns: COLUMNS },
      { complete: async () => ({ text: JSON.stringify({ observations: [candidate()] }) }) }
    );
    expect(result.observations[0].sourceLine).toBe('12.1 u/L');
  });

  it('sends no identity data, and says where the row came from', async () => {
    let sent = '';
    const result = await assistExtraction(
      {
        lines: [
          { lineNo: 1, text: 'Sample Person   Date of Birth: Jan 1, 1970' },
          { lineNo: 2, text: 'SSN: [SSN]' },
          { lineNo: 3, text: 'Widget One' },
          { lineNo: 4, text: 'Normal Range: 4.0 - 12.0 u/L' },
          { lineNo: 5, text: '12.1 u/L' },
          { lineNo: 6, text: 'High' },
        ],
        columns: COLUMNS,
      },
      {
        complete: async (_system, user) => {
          sent = user;
          return { text: JSON.stringify({ observations: [candidate({ lineNo: 5 })] }) };
        },
      }
    );

    for (const secret of ['Sample Person', 'Date of Birth', 'Jan 1, 1970', '[SSN]']) {
      expect(sent, secret).not.toContain(secret);
    }
    expect(sent).toContain('[redacted: identity or provider details]');
    expect(sent).toContain('Widget One');
    expect(result.provider).toBe('injected');
    expect(result.observations).toHaveLength(1);
  });

  it('reports a provider failure instead of pretending there are no rows', async () => {
    const result = await assistExtraction(
      { lines: [], columns: [] },
      {
        complete: async () => {
          throw new Error('endpoint unreachable');
        },
      }
    );
    expect(result.attempted).toBe(true);
    expect(result.observations).toEqual([]);
    expect(result.warnings[0].message).toMatch(/endpoint unreachable/);
  });
});
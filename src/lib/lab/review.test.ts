// ── The lab review screen's decisions, as pure functions ─────────────────────
//
// Nothing here touches the DOM or the network: these are the rules that decide
// what the reader is told before an import, what the commit body contains, and
// what a success line may claim. They are tested directly, so the UI cannot
// quietly disagree with them.

import { describe, it, expect } from 'vitest';
import {
  FALLBACK_MAX_BYTES,
  analyteOptions,
  buildCommitPayload,
  checkUploadFile,
  evaluateUploadResponse,
  formatBytes,
  formatDateRange,
  isIsoDate,
  parseNumber,
  parseText,
  rowsFromDraft,
  statusForRow,
  summariseCommit,
  toCommitRow,
  validateReview,
  type ReviewRow,
} from './review';
import type { LabDraft } from './commit';
import type { ExtractedObservation } from './types';

function observation(overrides: Partial<ExtractedObservation> = {}): ExtractedObservation {
  return {
    lineNo: 1,
    analyteKey: 'sodium',
    printedName: 'Sodium',
    panel: 'Comprehensive Metabolic Panel',
    resultOn: '2024-03-03',
    value: 140,
    valueText: null,
    unit: 'mmol/L',
    refLow: 135,
    refHigh: 145,
    refText: '135 - 145',
    refSource: 'report',
    refBasis: null,
    printedFlag: null,
    category: null,
    extractionMethod: 'deterministic',
    confidence: 1,
    sourceLine: 'Sodium 140 135 - 145',
    ...overrides,
  };
}

function draft(overrides: Partial<LabDraft> = {}): LabDraft {
  return {
    kind: 'results',
    documentDate: '2024-03-04',
    labName: 'Example Labs',
    filename: 'trend-matrix.pdf',
    sha256: 'a'.repeat(64),
    bytes: 4096,
    pageCount: 2,
    pass: 'deterministic',
    detectedDates: ['2024-03-03'],
    rows: [observation()],
    warnings: [],
    notes: null,
    persisted: false,
    ...overrides,
  };
}

function rowFrom(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return { ...rowsFromDraft(draft())[0]!, ...overrides };
}

describe('choosing a file', () => {
  it('accepts a PDF by type or by extension', () => {
    expect(checkUploadFile({ name: 'report.pdf', type: 'application/pdf', size: 1000 })).toBeNull();
    expect(checkUploadFile({ name: 'report.PDF', type: '', size: 1000 })).toBeNull();
  });

  it('refuses a file that is not a PDF, naming it', () => {
    const problem = checkUploadFile({ name: 'notes.txt', type: 'text/plain', size: 10 });
    expect(problem?.code).toBe('not_pdf');
    expect(problem?.message).toContain('notes.txt');
    expect(problem?.retryable).toBe(true);
  });

  it('refuses an oversize file with both sizes, mirroring the route', () => {
    const problem = checkUploadFile({ name: 'big.pdf', type: 'application/pdf', size: 20 * 1024 * 1024 }, 15 * 1024 * 1024);
    expect(problem?.code).toBe('too_large');
    expect(problem?.message).toContain('20 MB');
    expect(problem?.message).toContain('15 MB');
  });

  it('refuses an empty file', () => {
    expect(checkUploadFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 })?.code).toBe('empty');
  });

  it('uses the documented default cap when the server has not said', () => {
    expect(FALLBACK_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(checkUploadFile({ name: 'a.pdf', type: 'application/pdf', size: FALLBACK_MAX_BYTES })).toBeNull();
    expect(checkUploadFile({ name: 'a.pdf', type: 'application/pdf', size: FALLBACK_MAX_BYTES + 1 })?.code).toBe('too_large');
  });

  it('formats sizes the way the copy does', () => {
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12)).toBe('12 bytes');
  });
});

describe('reading the upload response', () => {
  it('returns the draft for a results document', () => {
    const outcome = evaluateUploadResponse(201, { draft: draft() });
    expect(outcome.outcome).toBe('review');
    if (outcome.outcome === 'review') expect(outcome.draft.kind).toBe('results');
  });

  it('reports an ORDER FORM as nothing importable, and never as a review', () => {
    const outcome = evaluateUploadResponse(201, { draft: draft({ kind: 'order', rows: [] }) });
    expect(outcome.outcome).toBe('problem');
    if (outcome.outcome === 'problem') {
      expect(outcome.problem.code).toBe('order_form');
      expect(outcome.problem.message).toContain('lab order');
      expect(outcome.problem.message).toContain('nothing can be imported');
      expect(outcome.problem.retryable).toBe(false);
    }
  });

  it('reports a SCAN distinctly, from the page_without_text warning', () => {
    const outcome = evaluateUploadResponse(201, {
      draft: draft({ kind: 'unknown', rows: [], warnings: [{ code: 'page_without_text', message: 'no text', page: 1, line: null }] }),
    });
    if (outcome.outcome === 'problem') {
      expect(outcome.problem.code).toBe('scan');
      expect(outcome.problem.message).toContain('looks like a scan');
      expect(outcome.problem.message).toContain('OCR is not implemented');
    } else {
      throw new Error('expected a problem');
    }
  });

  it('reports an unknown document with no scan warning as unreadable', () => {
    const outcome = evaluateUploadResponse(201, { draft: draft({ kind: 'unknown', rows: [] }) });
    if (outcome.outcome === 'problem') expect(outcome.problem.code).toBe('unreadable');
    else throw new Error('expected a problem');
  });

  it('reports a duplicate upload from the server message', () => {
    const outcome = evaluateUploadResponse(200, { duplicate: true, message: 'This exact document is already stored.' });
    if (outcome.outcome === 'problem') {
      expect(outcome.problem.code).toBe('duplicate');
      expect(outcome.problem.message).toContain('already stored');
      expect(outcome.problem.retryable).toBe(false);
    } else {
      throw new Error('expected a problem');
    }
  });

  it('maps the route status codes to the same codes the client uses', () => {
    const notPdf = evaluateUploadResponse(415, { error: 'The uploaded file is not a PDF (it does not start with %PDF-).' });
    const tooLarge = evaluateUploadResponse(413, { error: 'too big' });
    const bad = evaluateUploadResponse(500, { error: 'boom' });
    expect(notPdf.outcome === 'problem' && notPdf.problem.code).toBe('not_pdf');
    expect(tooLarge.outcome === 'problem' && tooLarge.problem.code).toBe('too_large');
    expect(bad.outcome === 'problem' && bad.problem.code).toBe('unreadable');
  });
});

describe('the editable rows', () => {
  it('turns a draft into included, editable rows', () => {
    const rows = rowsFromDraft(draft({ rows: [observation({ lineNo: 1 }), observation({ lineNo: 2, printedName: 'Potassium', analyteKey: 'potassium' })] }));
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.include)).toBe(true);
    expect(rows[0]!.value).toBe('140');
    expect(rows[1]!.printedName).toBe('Potassium');
    // The registry backs the analyte select.
    expect(analyteOptions().some(o => o.value === 'sodium')).toBe(true);
  });

  it('parses text fields without coercing junk to zero', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('42.5')).toBe(42.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseText('  hi ')).toBe('hi');
    expect(parseText('')).toBeNull();
  });
});

describe('building the commit payload', () => {
  it('sends only included rows', () => {
    const rows = [rowFrom({ lineNo: 1 }), rowFrom({ lineNo: 2, include: false, printedName: 'Excluded' })];
    const payload = buildCommitPayload(draft(), rows, '2024-03-04');
    expect(payload.results).toHaveLength(1);
    expect(payload.results?.[0]?.lineNo).toBe(1);
    expect(payload.results?.some(r => r.printedName === 'Excluded')).toBe(false);
  });

  it('carries the document header and the parser bookkeeping verbatim', () => {
    const payload = buildCommitPayload(draft(), rowsFromDraft(draft()), '2024-03-04');
    expect(payload.sourceSha256).toBe('a'.repeat(64));
    expect(payload.sourceBytes).toBe(4096);
    expect(payload.pageCount).toBe(2);
    expect(payload.documentDate).toBe('2024-03-04');
    expect(payload.kind).toBe('results');
    expect((payload.extraction as { pass?: string }).pass).toBe('deterministic');
  });

  it('never invents a document date: null stays null', () => {
    const payload = buildCommitPayload(draft({ documentDate: null }), rowsFromDraft(draft()), null);
    expect(payload.documentDate).toBeNull();
  });

  it('takes a result date from the row, not from the document', () => {
    const rows = [rowFrom({ resultOn: '2021-11-02' })];
    const payload = buildCommitPayload(draft(), rows, '2024-03-04');
    expect(payload.results?.[0]?.resultOn).toBe('2021-11-02');
  });

  it('converts an edited row back to the wire shape without inventing a value', () => {
    const wire = toCommitRow(rowFrom({ value: '', valueText: 'TRACE' }));
    expect(wire.value).toBeNull();
    expect(wire.valueText).toBe('TRACE');
    expect(wire.refLow).toBe(135);
  });
});

describe('validating the review before sending', () => {
  it('requires a document date when the parser found none, and says why', () => {
    const result = validateReview(draft({ documentDate: null }), rowsFromDraft(draft()), '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('document-date');
      expect(result.error).toContain('never guessed');
    }
  });

  it('refuses a date that is not a real calendar date', () => {
    expect(validateReview(draft(), rowsFromDraft(draft()), '2024-02-30').ok).toBe(false);
    expect(validateReview(draft(), rowsFromDraft(draft()), '04/03/2024').ok).toBe(false);
    expect(validateReview(draft(), rowsFromDraft(draft()), '2024-03-04').ok).toBe(true);
  });

  it('refuses a review with every row excluded', () => {
    const result = validateReview(draft(), [rowFrom({ include: false })], '2024-03-04');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('rows');
      expect(result.error).toContain('nothing to import');
    }
  });

  it('refuses a row left with neither a value nor printed text', () => {
    const result = validateReview(draft(), [rowFrom({ value: '', valueText: '' })], '2024-03-04');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/value or printed text/);
  });

  it('ignores an excluded row that is incomplete', () => {
    const rows = [rowFrom({ lineNo: 1 }), rowFrom({ lineNo: 2, include: false, value: '', valueText: '' })];
    expect(validateReview(draft(), rows, '2024-03-04').ok).toBe(true);
  });

  it('refuses a bad result date or a missing printed name', () => {
    expect(validateReview(draft(), [rowFrom({ resultOn: 'nope' })], '2024-03-04').ok).toBe(false);
    expect(validateReview(draft(), [rowFrom({ printedName: '   ' })], '2024-03-04').ok).toBe(false);
  });

  it('reports the included count on success', () => {
    const rows = [rowFrom({ lineNo: 1 }), rowFrom({ lineNo: 2, include: false })];
    const result = validateReview(draft(), rows, '2024-03-04');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.includedCount).toBe(1);
      expect(result.payload.results).toHaveLength(1);
    }
  });

  it('recognises a real calendar date and rejects the near misses', () => {
    expect(isIsoDate('2026-02-29')).toBe(false); // not a leap year
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('the status shown beside a row', () => {
  it('scores a row against the interval the report printed', () => {
    // 135-145 → width 10 → the "slightly out" allowance is 1, so 146 is slightly high.
    const status = statusForRow(rowFrom({ value: '146' }), { dateOfBirth: null, sex: null });
    expect(status.status).toBe('slightly_out_high');
    expect(status.sourceLabel).toBe('Printed on report');
    expect(status.tone).toBe('caution');
    expect(statusForRow(rowFrom({ value: '160' }), { dateOfBirth: null, sex: null }).status).toBe('out_high');
  });

  it('falls back to the registry band and labels it as a general interval', () => {
    const status = statusForRow(
      rowFrom({ analyteKey: 'hemoglobin', printedName: 'Hgb', value: '15', unit: 'g/dL', refLow: '', refHigh: '', refText: '' }),
      { dateOfBirth: '1980-01-01', sex: 'male' }
    );
    expect(status.sourceLabel).toBe('General reference interval');
    expect(status.status).not.toBe('unscored_no_range');
  });

  it('leaves a sex-specific band unscored when no sex is set, and explains it', () => {
    const row = rowFrom({ analyteKey: 'creatinine', printedName: 'Creatinine', value: '1.2', unit: 'mg/dL', refLow: '', refHigh: '', refText: '' });
    const unset = statusForRow(row, { dateOfBirth: '1980-01-01', sex: null });
    expect(unset.status).toBe('unscored_no_range');
    expect(unset.sourceLabel).toBe('None');
    expect(unset.bandReason).toBe('sex_unset');
    expect(unset.warning).toContain('no sex set');

    const male = statusForRow(row, { dateOfBirth: '1980-01-01', sex: 'male' });
    expect(male.sourceLabel).toBe('General reference interval');
    expect(male.status).toBe('in_range');
  });

  it('warns about a row that carries nothing, without scoring it', () => {
    const status = statusForRow(rowFrom({ value: '', valueText: '', refLow: '', refHigh: '', refText: '' }), { dateOfBirth: null, sex: null });
    expect(status.warning).toContain('neither a numeric value nor printed text');
  });

  it('carries the bound on a bounded row through to an unscored verdict', () => {
    // A value printed as `>10` against `0-5`: a region with no upper end cannot
    // be shown to lie inside the interval, so it is never called out of range.
    const above = statusForRow(
      rowFrom({ analyteKey: 'estradiol', printedName: 'Estradiol', value: '10', valueText: '>10', refLow: '0', refHigh: '5', refText: '0-5' }),
      { dateOfBirth: null, sex: null }
    );
    expect(above.status).toBe('unscored_bound');
    expect(above.label).toBe('Bounded result');
    expect(above.tone).toBe('neutral');
    expect(above.notes.join(' ')).toMatch(/no upper end/);

    // The same interval with an upper bound whose whole region is inside it.
    const below = statusForRow(
      rowFrom({ analyteKey: 'estradiol', printedName: 'Estradiol', value: '3', valueText: '<3', refLow: '0', refHigh: '5', refText: '0-5' }),
      { dateOfBirth: null, sex: null }
    );
    expect(below.status).toBe('in_range');
    expect(below.notes.join(' ')).toMatch(/bound/);
  });
});

describe('what a commit may claim it stored', () => {
  const response = {
    report: { id: 'r1', resultCount: 3 },
    results: [
      { analyteKey: 'alt', resultOn: '2024-03-03' },
      { analyteKey: 'alt', resultOn: '2024-03-03' },
      { analyteKey: 'sodium', resultOn: '2024-06-01' },
    ],
  };

  it('counts observations, distinct analytes and the real date range from the API response', () => {
    const summary = summariseCommit(response);
    expect(summary).not.toBeNull();
    expect(summary!.observations).toBe(3);
    expect(summary!.analytes).toBe(2);
    expect(summary!.documents).toBe(1);
    expect(summary!.firstOn).toBe('2024-03-03');
    expect(summary!.lastOn).toBe('2024-06-01');
  });

  it('returns null rather than inventing counts for a payload it cannot read', () => {
    expect(summariseCommit(null)).toBeNull();
    expect(summariseCommit({})).toBeNull();
    expect(summariseCommit({ report: { id: 'x' } })).toBeNull();
    expect(summariseCommit({ results: [] })).toBeNull();
  });

  it('formats a date range honestly, including one-sided and empty ones', () => {
    expect(formatDateRange('2024-03-03', '2024-06-01')).toBe('2024-03-03 to 2024-06-01');
    expect(formatDateRange('2024-03-03', '2024-03-03')).toBe('2024-03-03');
    expect(formatDateRange(null, null)).toBe('no dated results');
  });
});
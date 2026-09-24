import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { extractLabDocument } from './extract';
import { MAX_PRINTED_FLAG_LENGTH } from './types';
import { buildDraft, isIsoDate, isPdf, validateCommitPayload } from './commit';
import type { ExtractionResult } from './types';

const SHA = 'a'.repeat(64);

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'results',
    documentDate: '2024-03-04',
    sourceFilename: 'results.pdf',
    sourceSha256: SHA,
    sourceBytes: 4096,
    pageCount: 1,
    results: [
      {
        printedName: 'Cholesterol, Total',
        resultOn: '2024-03-03',
        value: 180,
        unit: 'mg/dL',
        refLow: null,
        refHigh: 200,
        refText: '<200 mg/dL',
        sourceLine: 'Cholesterol, Total | <200 mg/dL | 180',
      },
    ],
    ...overrides,
  };
}

describe('an order form is refused', () => {
  it('refuses kind=order with the "lab order" message', () => {
    const result = validateCommitPayload({ kind: 'order', results: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error.toLowerCase()).toContain('lab order');
      expect(result.error.toLowerCase()).toContain('nothing was imported');
    }
  });

  it('refuses an unknown kind', () => {
    const result = validateCommitPayload({ kind: 'unknown' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe('the whole payload is validated before anything is written', () => {
  it('accepts a well-formed payload and resolves the analyte key from the name', () => {
    const result = validateCommitPayload(basePayload());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.kind).toBe('results');
      expect(result.report.documentDate).toBe('2024-03-04');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.analyteKey).toBe('total_cholesterol');
      expect(result.results[0]?.refSource).toBe('report');
      expect(result.results[0]?.lineNo).toBe(1);
    }
  });

  it('rejects the whole payload when ONE row is malformed', () => {
    const payload = basePayload({
      results: [
        { printedName: 'Sodium', resultOn: '2024-03-03', value: 140, unit: 'mEq/L' },
        { printedName: 'Potassium', resultOn: 'not-a-date', value: 4.1 },
      ],
    });
    const result = validateCommitPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('results[1].resultOn');
  });

  it('requires every result to carry a result date', () => {
    const payload = basePayload({ results: [{ printedName: 'Sodium', value: 140 }] });
    const result = validateCommitPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('resultOn');
  });

  it('refuses a row with neither a value nor printed text', () => {
    const payload = basePayload({ results: [{ printedName: 'Sodium', resultOn: '2024-03-03' }] });
    const result = validateCommitPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('neither a numeric value nor printed text');
  });

  it('refuses a non-numeric value and a malformed unit', () => {
    expect(validateCommitPayload(basePayload({ results: [{ printedName: 'Sodium', resultOn: '2024-03-03', value: 'high' }] })).ok).toBe(false);
    expect(validateCommitPayload(basePayload({ results: [{ printedName: 'Sodium', resultOn: '2024-03-03', value: 140, unit: 'x'.repeat(41) }] })).ok).toBe(false);
  });

  it('refuses a duplicated lineNo', () => {
    const payload = basePayload({
      results: [
        { printedName: 'Sodium', resultOn: '2024-03-03', value: 140, lineNo: 1 },
        { printedName: 'Potassium', resultOn: '2024-03-03', value: 4.1, lineNo: 1 },
      ],
    });
    const result = validateCommitPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('used twice');
  });

  it('requires a document date or an explicitly supplied one', () => {
    const result = validateCommitPayload(basePayload({ documentDate: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toContain('document date');
    }
  });

  it('requires a valid SHA-256 and a positive byte count', () => {
    expect(validateCommitPayload(basePayload({ sourceSha256: 'zz' })).ok).toBe(false);
    expect(validateCommitPayload(basePayload({ sourceBytes: 0 })).ok).toBe(false);
    expect(validateCommitPayload(basePayload({ sourceFilename: '' })).ok).toBe(false);
  });

  it('requires at least one observation', () => {
    const result = validateCommitPayload(basePayload({ results: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it('defaults refSource to none when no interval is present and rejects a bad one', () => {
    const ok = validateCommitPayload(
      basePayload({ results: [{ printedName: 'Sodium', resultOn: '2024-03-03', value: 140 }] })
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.results[0]?.refSource).toBe('none');
    expect(
      validateCommitPayload(
        basePayload({ results: [{ printedName: 'Sodium', resultOn: '2024-03-03', value: 140, refSource: 'guessed' }] })
      ).ok
    ).toBe(false);
  });
});

describe('date and PDF shapes', () => {
  it('accepts real calendar dates and rejects impossible ones', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-13-01')).toBe(false);
    expect(isIsoDate('2024-1-1')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('recognises the PDF magic number', () => {
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
    expect(isPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(isPdf(new Uint8Array([]))).toBe(false);
  });
});

describe('the draft is reviewable and not persisted', () => {
  it('lists the detected dates and marks itself unpersisted', () => {
    const extraction: ExtractionResult = {
      parserVersion: 'test',
      kind: 'results',
      pageCount: 1,
      documentDate: null,
      labName: null,
      pass: 'deterministic',
      observations: [
        {
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
        },
        {
          lineNo: 2,
          analyteKey: 'sodium',
          printedName: 'Sodium',
          panel: 'Comprehensive Metabolic Panel',
          resultOn: '2023-11-02',
          value: 141,
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
          sourceLine: 'Sodium | 136-145 | 141',
        },
      ],
      warnings: [],
      rejections: [],
      sourceSha256: SHA,
      sourceBytes: 4096,
      notes: null,
    };
    const draft = buildDraft(extraction, 'results.pdf', SHA, 4096);
    expect(draft.detectedDates).toEqual(['2023-11-02', '2024-03-03']);
    expect(draft.rows).toHaveLength(2);
    expect(draft.persisted).toBe(false);
    expect(draft.kind).toBe('results');
  });
});

// ── The chain the import actually walks ──────────────────────────────────────
//
// These cases exist because of a real document that was refused. The extractor
// read Quest Diagnostics' own status column verbatim — `In Range`, `Out Of
// Range` — while the validator capped `printedFlag` at 8 characters, a limit
// written for a one-letter `H`/`L` flag. Every out-of-range row therefore failed
// and the WHOLE report was rejected with `results[6].printedFlag must be a short
// string or null.` The extractor's output had never been fed to the validator in
// a test, so neither side noticed; the shipped synthetic Quest fixture contains
// four `Out Of Range` rows and would have failed the same way.

/** The payload the client sends back, built from what the extractor read. */
async function payloadFromFixture(name: string) {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'src', 'lib', 'lab', '__fixtures__', name)));
  const extraction = await extractLabDocument(bytes);
  return {
    extraction,
    payload: {
      kind: extraction.kind,
      documentDate: extraction.documentDate,
      sourceFilename: name,
      sourceSha256: extraction.sourceSha256,
      sourceBytes: extraction.sourceBytes,
      pageCount: extraction.pageCount,
      results: extraction.observations,
    } as Record<string, unknown>,
  };
}

describe('what the extractor read can be committed', () => {
  it('accepts the status word a real report prints in its flag column', async () => {
    const { extraction, payload } = await payloadFromFixture('quest-results.pdf');

    // The fixture must genuinely carry the long flag, or the case proves nothing.
    const longFlags = extraction.observations.filter(row => row.printedFlag === 'Out Of Range');
    expect(longFlags.length).toBeGreaterThan(0);
    expect('Out Of Range'.length).toBeGreaterThan(8);

    const result = validateCommitPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Kept verbatim: the flag is evidence of what the report printed.
      expect(result.results.filter(row => row.printedFlag === 'Out Of Range')).toHaveLength(longFlags.length);
    }
  });

  it('never lets a flag longer than the stated limit through', async () => {
    const { extraction, payload } = await payloadFromFixture('quest-results.pdf');
    const longest = Math.max(...extraction.observations.map(row => (row.printedFlag ?? '').length));
    expect(longest).toBeLessThanOrEqual(MAX_PRINTED_FLAG_LENGTH);
  });

  it('names the limit when it refuses a flag, so the message is actionable', () => {
    const tooLong = 'x'.repeat(MAX_PRINTED_FLAG_LENGTH + 1);
    const result = validateCommitPayload(
      basePayload({ results: [{ printedName: 'Cholesterol, Total', resultOn: '2024-03-03', value: 180, printedFlag: tooLong }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(String(MAX_PRINTED_FLAG_LENGTH));
      expect(result.error).not.toBe('results[0].printedFlag must be a short string or null.');
    }
  });

  it('still accepts a row with no flag at all', () => {
    const result = validateCommitPayload(
      basePayload({ results: [{ printedName: 'Cholesterol, Total', resultOn: '2024-03-03', value: 180, printedFlag: null }] })
    );
    expect(result.ok).toBe(true);
  });
});

// ── The Quest Diagnostics results layout, one shape at a time ────────────────
//
// Two kinds of test live here. The unit tests pin the GRAMMAR of the layout — a
// header, a value cell, a reference cell, a panel label, a qualitative result —
// and the ones built on hand-made LAYOUTS pin the walk: which printed line
// becomes an observation, which is refused and why, and that a patient
// identifier cannot ride out in any field. The fixture-generated PDF is read end
// to end in ./extract.test.ts.
//
// NOTHING HERE IS A REAL REPORT. Every name, value, date and identifier is
// invented and obviously fake; no line of the owner's document appears either.

import { describe, expect, it } from 'vitest';
import type { DocumentLayout, LayoutLine } from '@/lib/lab/extract/layout';
import {
  findQuestHeader,
  interpretQuest,
  isPanelLabel,
  isQuestResultsLayout,
  nameBoundaryOf,
  parseQuestReference,
  parseQuestValueCell,
  qualitativeBasisFor,
  qualitativeSummary,
  questCollectedDates,
  questDocumentDate,
  questFurnitureReason,
  QUEST_BLOCK_TEXT,
} from '@/lib/lab/extract/quest';
import type { PdfTextItem } from '@/lib/lab/extract/pdf-items';

// ── Hand-made geometry ───────────────────────────────────────────────────────

/** One positioned run. Width is only ever used to join runs, never to read one. */
function item(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y, width: str.length * 4.7, height: 9 };
}

/** One printed line from `[text, x]` pairs, left to right. */
function line(page: number, lineNo: number, y: number, runs: [string, number][]): LayoutLine {
  const items = runs.map(([str, x]) => item(str, x, y)).sort((a, b) => a.x - b.x);
  return { page, lineNo, y, items, text: items.map(entry => entry.str).join(' ') };
}

/** The smallest layout that holds the lines given. */
function layoutOf(pages: number, lines: LayoutLine[]): DocumentLayout {
  return {
    pages: Array.from({ length: pages }, (_, index) => {
      const page = index + 1;
      const own = lines.filter(entry => entry.page === page);
      return { page, width: 612, height: 792, itemCount: own.length, lineCount: own.length };
    }),
    headers: [],
    blocks: [],
    lines,
    classified: [],
    warnings: [],
  };
}

/** The header every page of the layout prints, at the x the columns really use. */
const HEADER_RUNS: [string, number][] = [
  ['Test Name', 20],
  ['In Range', 240],
  ['Out Of Range', 320],
  ['Reference Range', 404],
  ['Lab', 560],
];

describe('the results-table header', () => {
  it('is found by its own labels, and one x per column comes from it', () => {
    const header = findQuestHeader(1, [line(1, 1, 600, HEADER_RUNS)]);
    expect(header).not.toBeNull();
    expect(header?.columns.map(column => column.kind)).toEqual(['in_range', 'out_of_range', 'reference']);
    expect(header?.columns.map(column => column.x)).toEqual([240, 320, 404]);
    expect(header?.resultColumns.map(column => column.label)).toEqual(['In Range', 'Out Of Range']);
    expect(header?.nameX).toBe(20);
    expect(header?.labX).toBe(560);
  });

  it('accepts the single `Result` variant the same documents embed', () => {
    const header = findQuestHeader(1, [
      line(1, 1, 600, [
        ['Test Name', 100],
        ['Result', 280],
        ['Reference Range', 356],
        ['Lab', 560],
      ]),
    ]);
    expect(header?.resultColumns.map(column => column.kind)).toEqual(['result']);
    expect(header?.resultColumns[0].label).toBe('Result');
  });

  it('is not a header without a Reference Range label, or without a value column', () => {
    expect(findQuestHeader(1, [line(1, 1, 600, [['Test Name', 20], ['In Range', 240]])])).toBeNull();
    expect(
      findQuestHeader(1, [
        line(1, 1, 600, [
          ['Test Name', 20],
          ['Reference Range', 404],
        ]),
      ])
    ).toBeNull();
  });

  it('is not a header when the reference label sits left of the values', () => {
    const odd = findQuestHeader(1, [
      line(1, 1, 600, [
        ['Reference Range', 20],
        ['Test Name', 100],
        ['In Range', 240],
      ]),
    ]);
    expect(odd).toBeNull();
  });

  it('makes the name region end at the midpoint of the `Test Name` and first value column', () => {
    const header = findQuestHeader(1, [line(1, 1, 600, HEADER_RUNS)]);
    expect(header && nameBoundaryOf(header)).toBe(130);
  });

  it('recognises the layout from the document as a whole', () => {
    const quest = layoutOf(1, [line(1, 1, 600, HEADER_RUNS)]);
    expect(isQuestResultsLayout(quest)).toBe(true);
    expect(isQuestResultsLayout(layoutOf(1, [line(1, 1, 600, [['Component', 40], ['Jan 15, 2020', 240]])]))).toBe(false);
  });
});

describe('printed values in this layout', () => {
  it('reads a plain number, with or without a unit', () => {
    expect(parseQuestValueCell('12.1')).toEqual({ value: 12.1, valueText: null, unit: null });
    expect(parseQuestValueCell('1.017')).toEqual({ value: 1.017, valueText: null, unit: null });
  });

  it('never reads the report’s trailing marker as a number or a unit', () => {
    expect(parseQuestValueCell('44.7 L')).toEqual({ value: 44.7, valueText: null, unit: null });
    expect(parseQuestValueCell('90 H')).toEqual({ value: 90, valueText: null, unit: null });
  });

  it('keeps a qualitative result as printed', () => {
    expect(parseQuestValueCell('NONE SEEN')).toEqual({ value: null, valueText: 'NONE SEEN', unit: null });
    expect(parseQuestValueCell('YELLOW')).toEqual({ value: null, valueText: 'YELLOW', unit: null });
  });

  it('never reads a notice or annotation token as a value', () => {
    for (const token of ['SEE NOTE:', 'SEE NOTE', 'NOTE:', 'D:', 'I:', ':']) {
      expect(parseQuestValueCell(token), token).toBeNull();
    }
  });

  it('reads a printed BOUND as the number plus an explicit bound, verbatim in valueText', () => {
    expect(parseQuestValueCell('<30')).toEqual({ value: 30, valueText: '<30', unit: null, bound: '<' });
    expect(parseQuestValueCell('<=200')).toEqual({ value: 200, valueText: '<=200', unit: null, bound: '<=' });
    expect(parseQuestValueCell('>39 mg/dL')).toEqual({ value: 39, valueText: '>39', unit: 'mg/dL', bound: '>' });
    expect(parseQuestValueCell('>=40')).toEqual({ value: 40, valueText: '>=40', unit: null, bound: '>=' });
    // The report's own stranded `or`, kept verbatim in the printed text.
    expect(parseQuestValueCell('< OR = 5 /HPF')).toEqual({ value: 5, valueText: '< OR = 5', unit: '/HPF', bound: '<=' });
    expect(parseQuestValueCell('> OR = 60')).toEqual({ value: 60, valueText: '> OR = 60', unit: null, bound: '>=' });
    // A urinalysis grade: the printed grade or more, labelled as printed.
    expect(parseQuestValueCell('2+')).toEqual({ value: 2, valueText: '2+', unit: null, bound: '+' });
    expect(parseQuestValueCell('1+')).toEqual({ value: 1, valueText: '1+', unit: null, bound: '+' });
  });

  it('refuses a cell it cannot read rather than guessing one', () => {
    expect(parseQuestValueCell('not a result')).toBeNull();
    expect(parseQuestValueCell('')).toBeNull();
  });
});

describe('printed reference cells in this layout', () => {
  it('reads an interval and splits its inline unit off', () => {
    expect(parseQuestReference('50-180 mcg/dL')).toEqual({
      refLow: 50,
      refHigh: 180,
      refText: '50-180 mcg/dL',
      unit: 'mcg/dL',
      form: 'range',
    });
  });

  it('reads a bare interval with no unit', () => {
    expect(parseQuestReference('5.0-8.0')).toMatchObject({ refLow: 5, refHigh: 8, unit: null, form: 'range' });
  });

  it('keeps `(calc)` out of the number and out of the unit', () => {
    const parsed = parseQuestReference('250-425 mcg/dL (calc)');
    expect(parsed).toMatchObject({ refLow: 250, refHigh: 425, unit: 'mcg/dL', form: 'range' });
    // The cell is stored as printed, suffix and all; only the bounds are read.
    expect(parsed?.refText).toBe('250-425 mcg/dL (calc)');
  });

  it('reads the printed one-sided forms, including a stranded `or`', () => {
    expect(parseQuestReference('<5.0 (calc)')).toMatchObject({ refLow: null, refHigh: 5, form: 'range' });
    expect(parseQuestReference('> OR = 60 mL/min/1.73m2')).toMatchObject({ refLow: 60, refHigh: null });
    expect(parseQuestReference('< OR = 0.2 mg/dL')).toMatchObject({ refLow: null, refHigh: 0.2 });
    expect(parseQuestReference('< OR = 5 /HPF')).toMatchObject({ refLow: null, refHigh: 5, unit: '/HPF' });
  });

  it('reads a printed textual expectation, with or without a per-field unit', () => {
    expect(parseQuestReference('NONE SEEN /HPF')).toEqual({
      refLow: null,
      refHigh: null,
      refText: 'NONE SEEN /HPF',
      unit: null,
      form: 'text',
    });
    expect(parseQuestReference('NONE SEEN /LPF')).toMatchObject({ refText: 'NONE SEEN /LPF', form: 'text' });
  });

  it('recognises a cell that is only a unit, and one that is only expected text', () => {
    expect(parseQuestReference('mg/dL')).toEqual({ refLow: null, refHigh: null, refText: 'mg/dL', unit: 'mg/dL', form: 'unit' });
    expect(parseQuestReference('%')).toMatchObject({ unit: '%', form: 'unit' });
    expect(parseQuestReference('NEGATIVE')).toEqual({
      refLow: null,
      refHigh: null,
      refText: 'NEGATIVE',
      unit: null,
      form: 'text',
    });
  });

  it('keeps a marker that is nothing but an annotation out of the interval', () => {
    expect(parseQuestReference('(calc)')).toEqual({
      refLow: null,
      refHigh: null,
      refText: null,
      unit: null,
      form: 'annotation',
    });
    expect(parseQuestReference('')).toBeNull();
  });
});

describe('panel labels', () => {
  it('are the ALL-CAPS group labels, and nothing else', () => {
    expect(isPanelLabel('URINALYSIS, COMPLETE')).toBe(true);
    expect(isPanelLabel('IRON, TIBC AND FERRITIN PANEL')).toBe(true);
    expect(isPanelLabel('PANEL')).toBe(true);
    expect(isPanelLabel('Glucose')).toBe(false);
    expect(isPanelLabel('')).toBe(false);
  });
});

// ── The closed qualitative vocabulary ────────────────────────────────────────
//
// The importer interprets EXACTLY THREE words — POSITIVE, NEGATIVE, NONE SEEN —
// and only against the expected value the report itself printed. Everything else
// keeps the honest unscored behaviour, and every call states its basis.

describe('qualitative results', () => {
  it('counts a match with the printed expected value as in range, and says that is the basis', () => {
    const basis = qualitativeBasisFor('NEGATIVE', 'NEGATIVE');
    expect(basis?.status).toBe('in_range');
    expect(basis?.note).toMatch(/matches the expected value the report printed/i);
    expect(qualitativeBasisFor('POSITIVE', 'POSITIVE')?.status).toBe('in_range');
  });

  it('is case-insensitive: the report’s own spelling never decides the verdict', () => {
    expect(qualitativeBasisFor('negative', 'Negative')?.status).toBe('in_range');
    expect(qualitativeBasisFor('None Seen', 'NONE SEEN')?.status).toBe('in_range');
  });

  it('calls POSITIVE against a printed NEGATIVE out of range, on the report’s own convention', () => {
    const basis = qualitativeBasisFor('POSITIVE', 'NEGATIVE');
    expect(basis?.status).toBe('out_of_expected');
    expect(basis?.note).toMatch(/the report prints NEGATIVE as the expected result/i);
    expect(basis?.note).toMatch(/not a diagnosis/);
    // …and the other way round.
    expect(qualitativeBasisFor('NEGATIVE', 'POSITIVE')?.status).toBe('out_of_expected');
  });

  it('reads NONE SEEN as zero and lets it satisfy an upper limit', () => {
    const basis = qualitativeBasisFor('NONE SEEN', '< OR = 5 /HPF', { upperLimit: true, upperLimitValue: 5 });
    expect(basis?.status).toBe('in_range');
    expect(basis?.note).toMatch(/Nothing was seen/);
    expect(basis?.note).toMatch(/upper limit/);
    expect(basis?.note).toMatch(/No number is invented/);
  });

  it('ignores the per-field suffix when the expected value carries one', () => {
    const basis = qualitativeBasisFor('NONE SEEN', 'NONE SEEN /HPF');
    expect(basis?.status).toBe('in_range');
    expect(basis?.note).toMatch(/matches the expected value the report printed/i);
    expect(basis?.note).toMatch(/\/HPF/);
    expect(basis?.note).toMatch(/suffix .*is ignored/);
    expect(qualitativeBasisFor('NONE SEEN', 'NONE SEEN /LPF')?.status).toBe('in_range');
  });

  it('leaves a word outside the vocabulary unscored, naming the vocabulary', () => {
    for (const word of ['YELLOW', 'TRACE', '1+', 'CLEAR']) {
      const basis = qualitativeBasisFor(word, 'YELLOW');
      expect(basis?.status).toBe('unscored_non_numeric');
      expect(basis?.note).toMatch(/not one of the qualitative values this importer interprets/);
      expect(basis?.note).toMatch(/POSITIVE, NEGATIVE, NONE SEEN/);
    }
  });

  it('never guesses at a combination the vocabulary does not cover', () => {
    // A word from the vocabulary against an expected value that is not one of
    // the three, e.g. NEGATIVE where the report expects a count of `<5`.
    const basis = qualitativeBasisFor('NEGATIVE', '<5');
    expect(basis?.status).toBe('unscored_non_numeric');
    expect(basis?.note).toMatch(/left unscored rather than guessed at/);
  });

  it('leaves a result with no printed expected value unscored', () => {
    const basis = qualitativeBasisFor('TRACE', null);
    expect(basis?.status).toBe('unscored_non_numeric');
    expect(basis?.note).toMatch(/no expected value/);
  });

  it('has nothing to decide for an empty result', () => {
    expect(qualitativeBasisFor('', 'NEGATIVE')).toBeNull();
  });

  it('writes ONE summary line for a document, not one warning per row', () => {
    const one = qualitativeSummary(1);
    expect(one).toMatch(/^1 qualitative result was read/);
    expect(qualitativeSummary(12)).toMatch(/^12 qualitative results were read/);
    expect(qualitativeSummary(12)).toMatch(/negatives match negatives/);
    expect(qualitativeSummary(0)).toBeNull();
  });
});

describe('the patient block', () => {
  it('names the reason each line of it is refused', () => {
    expect(questFurnitureReason('SAMPLE, PERSON')).toBe('identity_line');
    expect(questFurnitureReason('DOB: Jan 1, 1970')).toBe('identity_line');
    expect(questFurnitureReason('Health ID: 0000000000000000')).toBe('identity_line');
    expect(questFurnitureReason('Report Status: Final')).toBe('letterhead_line');
    expect(questFurnitureReason('Specimen: SPEC0000')).toBe('letterhead_line');
    expect(questFurnitureReason('PHYSICIAN COMMENTS:')).toBe('notice_line');
    expect(questFurnitureReason('Page 1 of 2')).toBe('not_a_result_line');
    expect(questFurnitureReason('GLUCOSE')).toBeNull();
  });

  it('is stored as a placeholder, never quoted', () => {
    expect(QUEST_BLOCK_TEXT).toMatch(/^\[redacted:/);
  });
});

// ── The walk over a hand-made page ───────────────────────────────────────────

describe('reading a page of this layout', () => {
  const layout = layoutOf(1, [
    // The block every page repeats, above the table.
    line(1, 1, 760, [['SAMPLE, PERSON', 480], ['Report Status: Final', 20]]),
    line(1, 2, 730, [['DOB: Jan 1, 1970', 20], ['Specimen: SPEC0000', 230], ['Client #: 00000000', 430]]),
    line(1, 3, 700, [['SAMPLE CASE', 20], ['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 4, 600, HEADER_RUNS),
    // A panel label, then rows in each result column.
    line(1, 5, 580, [['GAMMA PANEL', 20]]),
    line(1, 6, 560, [['ALPHA ONE', 40], ['12.1', 240], ['4.0-12.0 u/L', 404], ['IG', 560]]),
    line(1, 7, 540, [['BETA TWO', 40], ['15.5 H', 320], ['4.0-12.0 u/L', 404]]),
    line(1, 8, 520, [['GAMMA COLOR', 40], ['YELLOW', 240], ['YELLOW', 404]]),
    line(1, 9, 500, [['COLOR TWO', 40], ['YELLOW', 240], ['NEGATIVE', 404]]),
    // A name that wraps onto the line its value is printed on.
    line(1, 10, 480, [['DELTA LONG', 40]]),
    line(1, 11, 460, [['NAME TEST', 52], ['3.0', 240], ['1.0-5.0', 404]]),
    // A calculated interval, and a row whose result column carried a NOTICE
    // token — a pointer to a comment block, never a value.
    line(1, 12, 440, [['EPSILON NOTE', 40], ['SEE NOTE:', 240], ['6-22 (calc)', 404]]),
    line(1, 13, 420, [['ZETA REFONLY', 40], ['1.0-2.0', 404]]),
    // A cell that is not a result in any known form.
    line(1, 14, 400, [['ETA JUNK', 40], ['not a result', 240]]),
    // Text in the columns with no test name at all: a footnote block.
    line(1, 15, 380, [['Below Average Risk:', 240], ['<2.28', 320]]),
  ]);

  const read = interpretQuest(layout);

  it('reads one observation per result row, with the column as the printed flag', () => {
    expect(read.observations.map(observation => ({
      key: observation.analyteKey,
      name: observation.printedName,
      on: observation.resultOn,
      value: observation.value,
      valueText: observation.valueText,
      unit: observation.unit,
      low: observation.refLow,
      high: observation.refHigh,
      refText: observation.refText,
      flag: observation.printedFlag,
      source: observation.refSource,
      method: observation.extractionMethod,
    }))).toEqual([
      {
        key: 'alpha_one',
        name: 'ALPHA ONE',
        on: '2021-02-03',
        value: 12.1,
        valueText: null,
        unit: 'u/L',
        low: 4,
        high: 12,
        refText: '4.0-12.0 u/L',
        flag: 'In Range',
        source: 'report',
        method: 'deterministic',
      },
      {
        key: 'beta_two',
        name: 'BETA TWO',
        on: '2021-02-03',
        value: 15.5,
        valueText: null,
        unit: 'u/L',
        low: 4,
        high: 12,
        refText: '4.0-12.0 u/L',
        flag: 'Out Of Range',
        source: 'report',
        method: 'deterministic',
      },
      {
        key: 'gamma_color',
        name: 'GAMMA COLOR',
        on: '2021-02-03',
        value: null,
        valueText: 'YELLOW',
        unit: null,
        low: null,
        high: null,
        refText: 'YELLOW',
        flag: 'In Range',
        source: 'report',
        method: 'deterministic',
      },
      {
        key: 'color_two',
        name: 'COLOR TWO',
        on: '2021-02-03',
        value: null,
        valueText: 'YELLOW',
        unit: null,
        low: null,
        high: null,
        refText: 'NEGATIVE',
        flag: 'In Range',
        source: 'report',
        method: 'deterministic',
      },
      {
        key: 'delta_long_name_test',
        name: 'DELTA LONG NAME TEST',
        on: '2021-02-03',
        value: 3,
        valueText: null,
        unit: null,
        low: 1,
        high: 5,
        refText: '1.0-5.0',
        flag: 'In Range',
        source: 'report',
        method: 'deterministic',
      },
    ]);
  });

  it('refuses a row whose result column carried a notice token, and never stores it', () => {
    expect(read.observations.some(observation => observation.analyteKey === 'epsilon_note')).toBe(false);
    const refused = read.rejections.find(rejection => rejection.reason === 'notice_line');
    expect(refused?.text).toContain('EPSILON NOTE');
    // The token is nowhere in a stored field, in any form.
    expect(JSON.stringify(read.observations)).not.toContain('SEE NOTE');
  });

  it('leaves a word outside the vocabulary unscored, per row, and warns about each one', () => {
    const gamma = read.observations.find(observation => observation.analyteKey === 'gamma_color');
    expect(gamma?.value).toBeNull();
    expect(gamma?.valueText).toBe('YELLOW');
    expect(gamma?.refBasis).toMatch(/not one of the qualitative values this importer interprets/);
    const colorTwo = read.observations.find(observation => observation.analyteKey === 'color_two');
    expect(colorTwo?.refBasis).toMatch(/not one of the qualitative values this importer interprets/);
    // Neither can be scored, so each keeps its own warning — and the document
    // carries no summary line, because no row was resolved by the vocabulary.
    expect(read.warnings.filter(warning => warning.code === 'non_numeric_result')).toHaveLength(2);
    expect(read.qualitativeRead).toBe(0);
    expect(read.qualitativeNote).toBeNull();
  });

  it('reads a panel label as the panel of the rows below it, never as an analyte', () => {
    // The label introduces the rows rather than being one of them: it is CONTEXT,
    // so it is never refused (there is no `panel_header` refusal any more — the
    // reason is gone from the vocabulary), never an empty analyte of its own, and
    // every row under it carries it as the panel it was printed under.
    expect(read.panels).toEqual(['GAMMA PANEL']);
    expect(read.rejections.some(rejection => rejection.text.includes('GAMMA PANEL'))).toBe(false);
    expect(read.observations.some(observation => observation.printedName.includes('PANEL'))).toBe(false);
    expect(read.observations.length).toBeGreaterThan(0);
    expect(read.observations.every(observation => observation.panel === 'GAMMA PANEL')).toBe(true);
  });

  it('refuses a row that prints an interval but no value', () => {
    expect(read.rejections.some(rejection => rejection.reason === 'no_result')).toBe(true);
    expect(read.observations.some(observation => observation.analyteKey === 'zeta_refonly')).toBe(false);
  });

  it('warns about a value cell it cannot read, and stores no row for it', () => {
    const warning = read.warnings.find(entry => entry.code === 'unparsable_value');
    expect(warning?.page).toBe(1);
    expect(read.observations.some(observation => observation.analyteKey === 'eta_junk')).toBe(false);
  });

  it('refuses the footnote block that is laid out in the table’s columns', () => {
    expect(read.rejections.filter(rejection => rejection.reason === 'not_a_result_line').length).toBeGreaterThanOrEqual(1);
  });

  it('gives every observation its own line number, in reading order', () => {
    const numbers = read.observations.map(observation => observation.lineNo);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(Math.min(...numbers)).toBe(1);
  });

  it('stores no identifier from the repeated block, in any field', () => {
    const everything = JSON.stringify(read);
    for (const secret of ['SAMPLE, PERSON', 'Jan 1, 1970', 'SPEC0000', '00000000', 'Client #']) {
      expect(everything, secret).not.toContain(secret);
    }
    // The refusal is recorded, with the placeholder in place of the line.
    const identity = read.rejections.find(rejection => rejection.reason === 'identity_line');
    expect(identity?.text).toBe(QUEST_BLOCK_TEXT);
  });
});

describe('reading a panel heading', () => {
  const layout = layoutOf(1, [
    line(1, 1, 700, [['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 2, 600, HEADER_RUNS),
    // A heading the report wrapped over two lines: both halves are one panel.
    line(1, 3, 580, [['COMPREHENSIVE METABOLIC', 20]]),
    line(1, 4, 560, [['PANEL', 40]]),
    line(1, 5, 540, [['ALPHA ONE', 40], ['12.1', 240], ['4.0-12.0 u/L', 404]]),
    // Then a sub-group heading over the rows of one analyte. It is deeper than the
    // panel's own first line, but it already reads as a complete panel name, so the
    // join STOPS and the rows below belong to the panel that was ordered.
    line(1, 6, 520, [['THYROID PANEL WITH TSH', 20]]),
    line(1, 7, 500, [['THYROID PANEL', 40]]),
    line(1, 8, 480, [['BETA TWO', 40], ['3.3', 240], ['0.5-4.5 u/L', 404]]),
    // A name that wraps: held back and merged into the row below, never a heading.
    line(1, 9, 460, [['SEX HORMONE BINDING', 40]]),
    line(1, 10, 440, [['GLOBULIN', 52], ['45', 240], ['10-50 nmol/L', 404]]),
  ]);

  const read = interpretQuest(layout);

  it('joins a wrapped heading into one panel, and stops at a complete one', () => {
    expect(read.panels).toEqual(['COMPREHENSIVE METABOLIC PANEL', 'THYROID PANEL WITH TSH']);
  });

  it('gives every row the heading above it, and refuses none of them', () => {
    expect(read.observations.map(observation => [observation.printedName, observation.panel])).toEqual([
      ['ALPHA ONE', 'COMPREHENSIVE METABOLIC PANEL'],
      ['BETA TWO', 'THYROID PANEL WITH TSH'],
      ['SEX HORMONE BINDING GLOBULIN', 'THYROID PANEL WITH TSH'],
    ]);
    expect(read.rejections.filter(rejection => rejection.reason === 'group_label')).toEqual([]);
  });

  it('never carries one page’s heading onto the next page’s rows', () => {
    const twoPages = layoutOf(2, [
      line(1, 1, 700, [['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
      line(1, 2, 600, HEADER_RUNS),
      line(1, 3, 580, [['URINALYSIS, COMPLETE', 20]]),
      line(1, 4, 560, [['ALPHA ONE', 40], ['NEGATIVE', 240], ['NEGATIVE', 404]]),
      line(2, 5, 700, [['Collected: 02/04/2021 / 08:00 CDT', 230], ['Reported: 02/05/2021 / 09:00 CDT', 430]]),
      line(2, 6, 600, HEADER_RUNS),
      line(2, 7, 560, [['BETA TWO', 40], ['3.3', 240], ['0.5-4.5 u/L', 404]]),
    ]);
    // A new page starts a new section: the page that printed no heading of its own
    // says nothing about its specimen, so its rows carry NO panel rather than the
    // previous page's urine one.
    expect(interpretQuest(twoPages).observations.map(observation => observation.panel)).toEqual([
      'URINALYSIS, COMPLETE',
      null,
    ]);
  });
});

describe('the dates this layout prints', () => {
  const layout = layoutOf(2, [
    line(1, 1, 700, [['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 2, 600, HEADER_RUNS),
    line(1, 3, 560, [['ALPHA ONE', 40], ['12.1', 240], ['4.0-12.0 u/L', 404]]),
    line(2, 4, 700, [['Collected: 02/04/2021 / 08:00 CDT', 230], ['Reported: 02/05/2021 / 09:00 CDT', 430]]),
    line(2, 5, 600, HEADER_RUNS),
    line(2, 6, 560, [['BETA TWO', 40], ['13.1', 240], ['4.0-12.0 u/L', 404]]),
  ]);
  const read = interpretQuest(layout);

  it('takes each row’s date from its own page’s `Collected:` field', () => {
    expect(questCollectedDates(layout).get(1)).toBe('2021-02-03');
    expect(read.observations.map(observation => observation.resultOn)).toEqual(['2021-02-03', '2021-02-04']);
  });

  it('takes the document’s date from `Reported:`', () => {
    expect(questDocumentDate(layout)).toBe('2021-02-05');
  });

  it('never invents a date when the page printed none', () => {
    const bare = layoutOf(1, [line(1, 1, 600, HEADER_RUNS), line(1, 2, 560, [['ALPHA ONE', 40], ['12.1', 240]])]);
    const bareRead = interpretQuest(bare);
    expect(questCollectedDates(bare).size).toBe(0);
    expect(bareRead.observations).toEqual([]);
    expect(bareRead.warnings.some(warning => warning.code === 'unparsable_value')).toBe(true);
  });
});

describe('a page carrying no results table', () => {
  it('refuses every line on it, and yields no rows', () => {
    const read = interpretQuest(
      layoutOf(1, [
        line(1, 1, 700, [['SAMPLE, PERSON', 40]]),
        line(1, 2, 680, [['Something unfamiliar here', 40]]),
      ])
    );
    expect(read.observations).toEqual([]);
    expect(read.rejections.map(rejection => rejection.reason)).toEqual(['identity_line', 'not_a_result_line']);
  });
});

// ── The closed vocabulary, read end to end ───────────────────────────────────

describe('the closed qualitative vocabulary, over a page', () => {
  const layout = layoutOf(1, [
    line(1, 1, 700, [['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 2, 600, HEADER_RUNS),
    // A negative that matches the printed expectation, and a positive that does
    // not: the report's own convention, never a diagnosis.
    line(1, 3, 580, [['ALPHA NEG', 40], ['NEGATIVE', 240], ['NEGATIVE', 404]]),
    line(1, 4, 560, [['BETA POS', 40], ['POSITIVE', 240], ['NEGATIVE', 404]]),
    // `NONE SEEN` — zero — against an upper limit, and against an expectation
    // that is itself the same words with a per-field suffix.
    line(1, 5, 540, [['GAMMA SEEN', 40], ['NONE SEEN', 240], ['< OR = 5 /HPF', 404]]),
    line(1, 6, 520, [['DELTA SEEN', 40], ['NONE SEEN', 240], ['NONE SEEN /LPF', 404]]),
    // A positive that matches, and a word that is NOT in the vocabulary.
    line(1, 7, 500, [['ZETA POS', 40], ['POSITIVE', 240], ['POSITIVE', 404]]),
    line(1, 8, 480, [['ETA WORD', 40], ['YELLOW', 240], ['YELLOW', 404]]),
  ]);
  const read = interpretQuest(layout);
  const byKey = (key: string) => read.observations.find(observation => observation.analyteKey === key);

  it('never invents a number: every qualitative row keeps value NULL and its printed text', () => {
    const qualitative = read.observations.filter(observation => observation.analyteKey !== '');
    expect(qualitative).toHaveLength(6);
    for (const observation of qualitative) {
      expect(observation.value).toBeNull();
      expect(typeof observation.valueText).toBe('string');
    }
    // The one numeric expectation in the page is the printed upper limit itself,
    // which is stored as the interval — never as the result.
    expect(byKey('gamma_seen')?.refHigh).toBe(5);
    expect(byKey('gamma_seen')?.refLow).toBeNull();
    expect(byKey('gamma_seen')?.value).toBeNull();
  });

  it('calls a match in range and states that the basis is the printed expectation', () => {
    expect(byKey('alpha_neg')?.refBasis).toMatch(/matches the expected value the report printed/i);
    expect(byKey('zeta_pos')?.refBasis).toMatch(/matches the expected value the report printed/i);
  });

  it('calls POSITIVE where the report prints NEGATIVE out of range, as the report’s convention', () => {
    const basis = byKey('beta_pos')?.refBasis ?? '';
    expect(basis).toMatch(/the report prints NEGATIVE as the expected result/i);
    expect(basis).toMatch(/not a diagnosis/);
  });

  it('lets NONE SEEN satisfy an upper limit, and ignores the per-field suffix', () => {
    expect(byKey('gamma_seen')?.refBasis).toMatch(/Nothing was seen/);
    expect(byKey('gamma_seen')?.refBasis).toMatch(/upper limit/i);
    expect(byKey('delta_seen')?.refBasis).toMatch(/matches the expected value the report printed/i);
    expect(byKey('delta_seen')?.refBasis).toMatch(/\/LPF/);
    // The printed expectation is kept verbatim, suffix and all.
    expect(byKey('delta_seen')?.refText).toBe('NONE SEEN /LPF');
  });

  it('keeps the printed field note in the row’s own text', () => {
    expect(byKey('gamma_seen')?.refText).toBe('< OR = 5 /HPF');
  });

  it('raises NO per-row warning for the rows the vocabulary resolved', () => {
    const warned = read.warnings.filter(warning => warning.code === 'non_numeric_result');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('ETA WORD');
    expect(warned[0]?.message).toMatch(/not one of the qualitative values this importer interprets/);
  });

  it('reports the resolved rows ONCE for the document instead', () => {
    expect(read.qualitativeRead).toBe(5);
    expect(read.qualitativeNote).toBe(
      '5 qualitative results were read from the values the report printed: negatives match negatives and “none seen” satisfies an upper limit.'
    );
  });
});

// ── Bounds, markers, legends and interpretation blocks ───────────────────────

describe('bounded results, markers and legend blocks', () => {
  const layout = layoutOf(1, [
    line(1, 1, 700, [['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 2, 600, HEADER_RUNS),
    // A bound whose whole region is inside the interval, and one that is not.
    line(1, 3, 580, [['ALPHA BOUND', 40], ['<3', 240], ['0-5', 404]]),
    line(1, 4, 560, [['BETA ABOVE', 40], ['>10', 320], ['0-5', 404]]),
    // A urinalysis grade: a lower bound, not a measurement.
    line(1, 5, 540, [['GAMMA GRADE', 40], ['2+', 320], ['NEGATIVE', 404]]),
    // A reference cell that is ONLY a marker.
    line(1, 6, 520, [['DELTA CALC', 40], ['5.0', 240], ['(calc)', 404]]),
    // A printed textual expectation carrying a per-field unit.
    line(1, 7, 500, [['EPSILON CELLS', 40], ['NONE SEEN', 240], ['NONE SEEN /HPF', 404]]),
    // An INTERPRETATION block: legend lines where a row's name would be.
    line(1, 8, 480, [['Legend Low: <10 ng/mL', 40]]),
    line(1, 9, 460, [['Legend Mid: 10 - 20 ng/mL', 40]]),
    line(1, 10, 440, [['Legend High: > or = 20 ng/mL', 40]]),
    line(1, 11, 420, [['ZETA AFTER', 40], ['4.0', 240], ['1.0-8.0', 404]]),
  ]);
  const read = interpretQuest(layout);
  const byKey = (key: string) => read.observations.find(observation => observation.analyteKey === key);

  it('stores a bound with the number the document printed and its printed text', () => {
    expect(byKey('alpha_bound')).toMatchObject({
      value: 3,
      valueText: '<3',
      refLow: 0,
      refHigh: 5,
      refText: '0-5',
      refSource: 'report',
    });
    expect(byKey('beta_above')).toMatchObject({ value: 10, valueText: '>10', refHigh: 5 });
    expect(byKey('gamma_grade')).toMatchObject({ value: 2, valueText: '2+', refText: 'NEGATIVE' });
  });

  it('stores no interval for a marker-only reference cell, and raises no range warning', () => {
    expect(byKey('delta_calc')).toMatchObject({
      value: 5,
      refLow: null,
      refHigh: null,
      refText: null,
      refSource: 'none',
    });
    expect(read.warnings.some(warning => warning.code === 'unparsable_range')).toBe(false);
    // The marker itself survives in the row's own printed text.
    expect(byKey('delta_calc')?.sourceLine).toContain('(calc)');
  });

  it('captures a printed textual expectation instead of calling it unparsable', () => {
    expect(byKey('epsilon_cells')).toMatchObject({ valueText: 'NONE SEEN', refText: 'NONE SEEN /HPF' });
    expect(read.warnings.some(warning => warning.code === 'unparsable_range')).toBe(false);
  });

  it('refuses every line of an interpretation block, and imports none of it', () => {
    expect(read.observations.some(observation => /legend/i.test(observation.printedName))).toBe(false);
    const refused = read.rejections.filter(rejection => /^Legend /i.test(rejection.text));
    expect(refused.map(rejection => rejection.text)).toEqual([
      'Legend Low: <10 ng/mL',
      'Legend Mid: 10 - 20 ng/mL',
      'Legend High: > or = 20 ng/mL',
    ]);
    expect(refused.every(rejection => rejection.reason === 'notice_line')).toBe(true);
    // The rows around the block are still read.
    expect(byKey('alpha_bound')).toBeDefined();
    expect(byKey('zeta_after')).toBeDefined();
  });
});

// ── A descriptive row is not a row that failed ───────────────────────────────

describe('a descriptive analyte in the table', () => {
  const layout = layoutOf(1, [
    line(1, 1, 760, [['SAMPLE, PERSON', 480], ['Report Status: Final', 20]]),
    line(1, 2, 730, [['DOB: Jan 1, 1970', 20], ['Specimen: SPEC0000', 230], ['Client #: 00000000', 430]]),
    line(1, 3, 700, [['SAMPLE CASE', 20], ['Collected: 02/03/2021 / 08:00 CDT', 230], ['Reported: 02/03/2021 / 09:00 CDT', 430]]),
    line(1, 4, 600, HEADER_RUNS),
    line(1, 5, 580, [['COLOR', 40], ['YELLOW', 240], ['YELLOW', 404]]),
    line(1, 6, 560, [['KETONES', 40], ['TRACE', 240], ['NEGATIVE', 404]]),
  ]);
  const read = interpretQuest(layout);
  const color = read.observations.find(observation => observation.printedName === 'COLOR');

  it('imports the row as text, with the report\'s own status kept as its flag', () => {
    expect(color?.value).toBeNull();
    expect(color?.valueText).toBe('YELLOW');
    expect(color?.printedFlag).toBe('In Range');
    expect(color?.refBasis).toMatch(/described rather than measured/i);
    expect(color?.refBasis).toMatch(/"In Range"/);
  });

  it('raises no warning for it: nothing was misunderstood', () => {
    expect(JSON.stringify(read.warnings)).not.toContain('COLOR');
  });

  it('does not count it as a qualitative result the vocabulary resolved', () => {
    expect(read.qualitativeRead).toBe(0);
    expect(read.qualitativeNote).toBeNull();
  });

  it('still warns for a MEASURED analyte printing a word it cannot score', () => {
    const ketones = read.warnings.filter(
      warning => warning.code === 'non_numeric_result' && warning.message.includes('KETONES')
    );
    expect(ketones).toHaveLength(1);
    expect(ketones[0]?.message).toMatch(/not one of the qualitative values this importer interprets/);
  });
});

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
    expect(parseQuestValueCell('1+')).toEqual({ value: null, valueText: '1+', unit: null });
    expect(parseQuestValueCell('NONE SEEN')).toEqual({ value: null, valueText: 'NONE SEEN', unit: null });
    expect(parseQuestValueCell('SEE NOTE:')).toEqual({ value: null, valueText: 'SEE NOTE:', unit: null });
    expect(parseQuestValueCell('YELLOW')).toEqual({ value: null, valueText: 'YELLOW', unit: null });
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
    expect(parseQuestReference('NONE SEEN /HPF')).toBeNull();
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

  it('returns null for a cell that is an annotation and nothing else', () => {
    expect(parseQuestReference('(calc)')).toBeNull();
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

describe('qualitative results', () => {
  it('counts an exact textual match as in range, and says that is the basis', () => {
    const basis = qualitativeBasisFor('YELLOW', 'YELLOW');
    expect(basis?.status).toBe('in_range');
    expect(basis?.note).toMatch(/TEXTUAL MATCH/);
  });

  it('leaves a mismatch unscored, with the reason recorded', () => {
    const basis = qualitativeBasisFor('1+', 'NEGATIVE');
    expect(basis?.status).toBe('unscored_non_numeric');
    expect(basis?.note).toMatch(/different text/);
  });

  it('leaves a result with no printed expected value unscored', () => {
    const basis = qualitativeBasisFor('TRACE', null);
    expect(basis?.status).toBe('unscored_non_numeric');
    expect(basis?.note).toMatch(/no expected value/);
  });

  it('has nothing to decide for a numeric result', () => {
    expect(qualitativeBasisFor('', 'NEGATIVE')).toBeNull();
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
    // A calculated interval, and a row that prints an interval but no value.
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
      {
        key: 'epsilon_note',
        name: 'EPSILON NOTE',
        on: '2021-02-03',
        value: null,
        valueText: 'SEE NOTE:',
        unit: null,
        low: 6,
        high: 22,
        refText: '6-22 (calc)',
        flag: 'In Range',
        source: 'report',
        method: 'deterministic',
      },
    ]);
  });

  it('records the textual basis for a qualitative match and says why a mismatch is unscored', () => {
    const match = read.observations.find(observation => observation.analyteKey === 'gamma_color');
    expect(match?.refBasis).toMatch(/TEXTUAL MATCH/);
    expect(qualitativeBasisFor('YELLOW', 'YELLOW')?.status).toBe('in_range');

    const mismatch = read.observations.find(observation => observation.analyteKey === 'color_two');
    expect(mismatch?.refBasis).toMatch(/different text/);
    expect(qualitativeBasisFor('YELLOW', 'NEGATIVE')?.status).toBe('unscored_non_numeric');
  });

  it('refuses the panel label as a panel header, never as an empty analyte', () => {
    const panel = read.rejections.find(rejection => rejection.reason === 'panel_header');
    expect(panel?.text).toBe('GAMMA PANEL');
    expect(read.panelHeaders).toBe(1);
    expect(read.observations.some(observation => observation.printedName.includes('PANEL'))).toBe(false);
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

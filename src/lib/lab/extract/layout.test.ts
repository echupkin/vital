// ── Geometry → structure ─────────────────────────────────────────────────────
//
// These tests build PDF TEXT ITEMS directly, with explicit x/y, so the column
// arithmetic can be checked against numbers a reviewer can read. Each one mirrors
// a shape the real documents print — most importantly the interleaved flag, where
// a value sits above its own name line and the report's marker sits beside the
// interval instead of beside the value.

import { describe, expect, it } from 'vitest';
import {
  BLOCK_REACH,
  LINE_TOLERANCE,
  buildLayout,
  groupLines,
  isFlagToken,
  type DocumentLayout,
} from '@/lib/lab/extract/layout';
import type { PdfGeometry, PdfTextItem } from '@/lib/lab/extract/pdf-items';

const SIZE = 9;
const CHAR = 0.52;

function item(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y, width: str.length * CHAR * SIZE, height: SIZE };
}

/** A run centred on `centre`, the way a table cell is printed. */
function centred(str: string, centre: number, y: number): PdfTextItem {
  const width = str.length * CHAR * SIZE;
  return item(str, centre - width / 2, y);
}

function geometryOf(items: PdfTextItem[]): PdfGeometry {
  return { pageCount: 1, pages: [{ page: 1, width: 612, height: 792, items }], creationDate: null };
}

/** Three date columns centred at 240 / 336 / 432, the step being 96. */
const COLUMNS = [240, 336, 432];
const HEADER_Y = 632;
const DATE_TEXTS = ['Jan 15, 2020', 'Jun 30, 2021', 'Mar 20, 2022'];

function headerRow(): PdfTextItem[] {
  return [item('Component', 56, HEADER_Y), ...DATE_TEXTS.map((text, index) => centred(text, COLUMNS[index], HEADER_Y))];
}

function blockFor(layout: DocumentLayout, name: string) {
  return layout.blocks.find(block => block.name === name);
}

describe('line grouping', () => {
  it('shares a line between runs whose baselines differ by less than the tolerance', () => {
    const lines = groupLines(1, [item('a', 10, 100), item('b', 30, 100 + LINE_TOLERANCE - 0.5)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('a');
  });

  it('separates runs further apart than the tolerance', () => {
    const lines = groupLines(1, [item('a', 10, 100), item('b', 30, 100 - LINE_TOLERANCE - 0.5)]);
    expect(lines).toHaveLength(2);
  });

  it('orders a line left to right regardless of the order items arrive in', () => {
    const lines = groupLines(1, [item('right', 200, 500), item('left', 10, 500)]);
    expect(lines[0].text).toBe('left right');
  });

  it('drops whitespace-only runs, which carry no text', () => {
    const lines = groupLines(1, [item('a', 10, 100), { str: '   ', x: 40, y: 100, width: 10, height: 0 }]);
    expect(lines).toHaveLength(1);
    expect(lines[0].items).toHaveLength(1);
  });
});

describe('the date-header row and its columns', () => {
  it('reads one column per printed date', () => {
    const layout = buildLayout(
      geometryOf([
        item('Result Trends', 36, 718),
        item('Sample Person', 36, 681),
        item('Date of Birth: Jan 1, 1970', 118, 681),
        ...headerRow(),
      ])
    );
    expect(layout.headers).toHaveLength(1);
    const columns = layout.headers[0].columns;
    expect(columns.map(column => column.date)).toEqual(['2020-01-15', '2021-06-30', '2022-03-20']);
    // Column bands meet at the midpoint of the gap between centres.
    expect(columns[0].centre).toBeCloseTo(COLUMNS[0], 0);
    expect(columns[0].left).toBeCloseTo(COLUMNS[0] - 48, 0);
    expect(columns[0].right).toBeCloseTo(COLUMNS[0] + 48, 0);
  });

  it('ignores a date that only appears inside a sentence', () => {
    const layout = buildLayout(
      geometryOf([item('Results found from Mar 3, 2019 - Nov 2, 2021.', 36, 700), ...headerRow()])
    );
    expect(layout.headers[0].columns).toHaveLength(3);
  });
});

describe('column assignment', () => {
  it('assigns each cell to the nearest column centre', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Alpha', 56, 618),
        item('Normal Range: 1.0 - 3.0 mg/dL', 56, 605),
        centred('2.0 mg/dL', COLUMNS[0] + 1.5, 605),
        centred('2.5 mg/dL', COLUMNS[1] - 1.5, 605),
        centred('2.9 mg/dL', COLUMNS[2], 605),
      ])
    );
    const block = blockFor(layout, 'Alpha');
    expect(block?.cells.map(cell => [cell.column, cell.text])).toEqual([
      [0, '2.0 mg/dL'],
      [1, '2.5 mg/dL'],
      [2, '2.9 mg/dL'],
    ]);
  });

  it('attaches the interleaved flag to the value it belongs to, not to a neighbour', () => {
    // The `MO%` shape: the flagged value is printed ABOVE its own name line, the
    // interval and the report's marker share the next line, and the other two
    // values sit beside the marker on that same line.
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Widget', 56, 618),
        centred('12.1 %', COLUMNS[0], 605), // value above its own name
        item('Normal Range: 4.0 - 12.0 %', 56, 592),
        centred('High', COLUMNS[0], 592), // marker beside the interval
        centred('9.3 %', COLUMNS[1], 592),
        centred('8.2 %', COLUMNS[2], 592),
      ])
    );
    const block = blockFor(layout, 'Widget');
    expect(block?.cells.map(cell => [cell.column, cell.text, cell.flag ?? null])).toEqual([
      [0, '12.1 %', 'High'],
      [1, '9.3 %', null],
      [2, '8.2 %', null],
    ]);
  });

  it('skips, with a warning, a cell no column can own', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Alpha', 56, 618),
        item('Normal Range: 1.0 - 3.0 mg/dL', 56, 605),
        centred('2.0 mg/dL', COLUMNS[0], 605),
        // Far to the right of every column centre.
        item('999 mg/dL', 600, 605),
      ])
    );
    expect(blockFor(layout, 'Alpha')?.cells).toHaveLength(1);
    expect(layout.warnings.map(warning => warning.code)).toContain('cell_out_of_columns');
  });

  it('reports a flag that sits in a column with no value', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Alpha', 56, 618),
        item('Normal Range: 1.0 - 3.0 mg/dL', 56, 605),
        centred('2.0 mg/dL', COLUMNS[0], 605),
        centred('High', COLUMNS[2], 592),
      ])
    );
    expect(layout.warnings.map(warning => warning.code)).toContain('flag_without_value');
  });

  it('keeps each block to its own band, so a value above a name is not stolen', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Alpha', 56, 618),
        item('Normal Range: 1.0 - 3.0 mg/dL', 56, 605),
        centred('2.0 mg/dL', COLUMNS[0], 605),
        // The next block's value is printed slightly ABOVE that block's own name.
        item('Beta', 56, 550),
        centred('7.0 mg/dL', COLUMNS[1], 550 - BLOCK_REACH + 1),
      ])
    );
    expect(blockFor(layout, 'Alpha')?.cells.map(cell => cell.text)).toEqual(['2.0 mg/dL']);
    expect(blockFor(layout, 'Beta')?.cells.map(cell => cell.text)).toEqual(['7.0 mg/dL']);
  });
});

describe('wrapped text', () => {
  it('reassembles a wrapped name when the interval line follows it', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Glycohemoglobin', 56, 618),
        item('(GHb),Total', 56, 605),
        item('Normal Range: 3.5 - 5.6 %', 56, 592),
        centred('5.7 %', COLUMNS[0], 592),
      ])
    );
    expect(blockFor(layout, 'Glycohemoglobin (GHb),Total')).toBeDefined();
    expect(layout.blocks).toHaveLength(1);
  });

  it('reassembles a unit wrapped onto the next line', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('WBC', 56, 618),
        item('Normal Range: 4.00 - 10.00', 56, 605),
        centred('6.39 K/ul', COLUMNS[0], 605),
        item('K/ul', 56, 592),
        item('MPV', 56, 566),
        item('Normal Range: 9.4 - 12.4 fL', 56, 553),
      ])
    );
    expect(blockFor(layout, 'WBC')?.rangeText).toBe('4.00 - 10.00 K/ul');
    expect(blockFor(layout, 'MPV')).toBeDefined();
  });

  it('reassembles an upper bound wrapped onto the next line', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Sodium', 56, 618),
        item('Normal Range: 135 -', 56, 605),
        centred('142 mm/L', COLUMNS[0], 605),
        item('145 mm/L', 56, 592),
      ])
    );
    expect(blockFor(layout, 'Sodium')?.rangeText).toBe('135 - 145 mm/L');
  });

  it('reassembles a unit broken as "M/" and "ul" without inserting a space', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('RBC', 56, 618),
        item('Normal Range: 4.10 - 5.70 M/', 56, 605),
        centred('5.33 M/ul', COLUMNS[0], 605),
        item('ul', 56, 592),
      ])
    );
    expect(blockFor(layout, 'RBC')?.rangeText).toBe('4.10 - 5.70 M/ul');
  });

  it('joins a value printed across two lines', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Filter Rate', 56, 618),
        item('Normal Range: >60.00', 56, 605),
        centred('86.85 mL/min/', COLUMNS[0], 592),
        centred('1.73m^2', COLUMNS[0], 592 - 13.4),
        item('mL/min/1.73m^2', 56, 592 - 2 * 13.4),
      ])
    );
    const block = blockFor(layout, 'Filter Rate');
    expect(block?.rangeText).toBe('>60.00 mL/min/1.73m^2');
    expect(block?.cells.map(cell => cell.text)).toEqual(['86.85 mL/min/1.73m^2']);
  });
});

describe('duplicate display names', () => {
  it('keeps both blocks, with their own intervals', () => {
    const layout = buildLayout(
      geometryOf([
        ...headerRow(),
        item('Protein Total', 56, 618),
        item('Normal Range: 6.1 - 8.3', 56, 605),
        centred('7.7 g/dl', COLUMNS[0], 605),
        item('g/dl', 56, 592),
        item('Protein Total', 56, 566),
        item('Normal Range: 6.7 - 8.8', 56, 553),
        centred('7.5 g/dl', COLUMNS[0], 553),
        item('g/dl', 56, 540),
      ])
    );
    const both = layout.blocks.filter(block => block.name === 'Protein Total');
    expect(both).toHaveLength(2);
    expect(both.map(block => block.rangeText)).toEqual(['6.1 - 8.3 g/dl', '6.7 - 8.8 g/dl']);
  });
});

describe('document furniture', () => {
  it('refuses every non-metric shape and records a reason for each', () => {
    const layout = buildLayout(
      geometryOf([
        item('Result Trends', 36, 718),
        item('Results limited to those after Apr 8, 2021.', 36, 700),
        item('Sample Person', 36, 681),
        item('Date of Birth: Jun 20, 1976', 118, 681),
        item('Mar 3, 2019 - Nov 2, 2021 (Table 1 of 1)', 48, 648),
        ...headerRow(),
        item('Fasting?', 56, 618),
        centred('Yes', COLUMNS[0], 618),
      ])
    );
    const reasons = layout.classified.map(line => line.reason).filter(Boolean);
    expect(reasons).toEqual([
      'document_title',
      'notice_line',
      'identity_line',
      'table_caption',
      'column_header',
      'non_metric_row',
    ]);
    // Nothing became an analyte row.
    expect(layout.blocks).toHaveLength(0);
  });

  it('warns when a page carries no text at all rather than leaving rows empty', () => {
    const layout = buildLayout({ pageCount: 1, pages: [{ page: 1, width: 612, height: 792, items: [] }], creationDate: null });
    expect(layout.warnings.map(warning => warning.code)).toEqual(['page_without_text']);
    expect(layout.blocks).toHaveLength(0);
  });
});

describe('flag tokens', () => {
  it('accepts the printed markers', () => {
    for (const flag of ['H', 'L', 'HH', 'LL', 'A', 'High', 'Low']) expect(isFlagToken(flag)).toBe(true);
  });

  it('does not claim a result-shaped token', () => {
    for (const token of ['Normal', '12.1', 'TRACE', 'Negative']) expect(isFlagToken(token)).toBe(false);
  });
});
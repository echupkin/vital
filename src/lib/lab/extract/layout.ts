// ── Geometry → structure ─────────────────────────────────────────────────────
//
// Turns positioned PDF text (./pdf-items.ts) into analyte BLOCKS: a printed name,
// its reference interval, and one value cell per date COLUMN.
//
// WHY THIS IS NOT A LINE PARSER. The lab's trend documents interleave values and
// flags in the text layer, and the same printed row is split across several
// baselines:
//
//     MO%                                              <- name line
//     Normal Range: 5.0 - 12.0 %        High           <- interval + flag, same line
//     (12.1 % sits ABOVE the name;  9.3 %  10.2 %  8.2 % sit BELOW it)
//
// A line-based regex would attach the `High` to the wrong value and would treat
// the four printed dates as one document date. So every decision here is made
// from x/y geometry:
//
//   1. items are grouped into LINES by baseline y;
//   2. the DATE-HEADER row is located, and one COLUMN CENTRE per printed date is
//      derived from it;
//   3. every item right of the name region is assigned to the NEAREST column
//      centre, within a documented tolerance;
//   4. left-of-column items (names, intervals, wrapped units) are walked in
//      reading order to delimit analyte blocks;
//   5. value cells are attributed to the block whose name line is nearest,
//      using a documented upward bias (a value is often printed slightly ABOVE
//      the name it belongs to).
//
// TOLERANCES, so a reviewer can reason about them instead of trusting them:
//
//   LINE_TOLERANCE = 4 points. Items whose baselines differ by less than this
//   share a line. The smallest row step seen in the real documents is ~13.3
//   points, and the largest within-row baseline skew is ~0.8, so 4 cannot merge
//   two printed rows and cannot split one.
//
//   COLUMN_ASSIGN = half the LOCAL column step. Columns are unevenly spaced
//   (the printed dates drift by a point or two), so a fixed point tolerance
//   would be wrong. Assigning to the nearest centre within half the gap to the
//   neighbouring centre guarantees a cell can never be nearer two columns than
//   one; a cell further than that from every centre is NOT guessed — it raises
//   `cell_out_of_columns` and is dropped.
//
//   BLOCK_REACH = 9 points. Value cells are attributed to the block whose name
//   line is nearest, after extending each block's top edge upward by 9 points.
//   The real documents print a value up to ~6.6 points ABOVE its own name
//   (eGFR) and the smallest row step is ~13.3, so 9 reaches every own-value
//   without ever reaching the block above.
//
// Anything the geometry does not support confidently becomes a warning, never a
// guess. Nothing here is redacted and nothing here is stored: this module is pure
// structure, and the caller decides what is safe to keep (see ./parse.ts).

import type { ExtractionRejectionReason, ExtractionWarning } from '../types';
import type { PdfGeometry, PdfTextItem } from './pdf-items';

/** Items whose baselines differ by less than this share one line. */
export const LINE_TOLERANCE = 4;

/** A block's top edge reaches this far above its name line, for its own cells. */
export const BLOCK_REACH = 9;

/**
 * How far beneath a cell a wrapped continuation may sit and still be joined to it
 * (`86.85 mL/min/` on one line, `1.73m^2` on the next). Larger than LINE_TOLERANCE
 * because the two halves are printed on two different baselines.
 */
export const WRAP_REACH = 20;

/** How much wider than a space two runs may be apart and still join into a cell. */
const JOIN_GAP = 2;

/** One printed line of a page. */
export interface LayoutLine {
  page: number;
  /** 1-based reading-order line number across the whole document. */
  lineNo: number;
  y: number;
  /** Items with non-blank text, left to right. */
  items: PdfTextItem[];
  /** The whole line's text, runs joined by a space where the gap warrants one. */
  text: string;
}

/** One printed date and the column of cells that belongs to it. */
export interface LayoutColumn {
  /** The date exactly as printed, e.g. "Mar 3, 2019". */
  dateText: string;
  /** ISO date (YYYY-MM-DD), or null when the printed text is not a real date. */
  date: string | null;
  /** x centre of the header cell, in PDF user space. */
  centre: number;
  /** Left edge of this column's band (midpoint to the previous column). */
  left: number;
  /** Right edge of this column's band (midpoint to the next column). */
  right: number;
}

/** The date-header row of one page and the columns it defines. */
export interface PageHeader {
  page: number;
  lineNo: number;
  y: number;
  columns: LayoutColumn[];
}

/** One cell of a result table: a value or a flag token, with its column. */
export interface LayoutCell {
  page: number;
  lineNo: number;
  y: number;
  x: number;
  centre: number;
  /** Index into the page's columns, or null when no column was near enough. */
  column: number | null;
  /** The cell's text, runs joined. */
  text: string;
  /** The report's flag token, once one has been attached to this value cell. */
  flag?: string;
}

/** One analyte block: a name, an interval, and its cells. */
export interface AnalyteBlock {
  page: number;
  /** The reading-order line number of the block's NAME line. */
  lineNo: number;
  /** The baseline y of the block's NAME line, in PDF user space. */
  nameY: number;
  /** The printed name, wrapped fragments joined with a space. */
  name: string;
  /** The interval as printed, label stripped ("5.0 - 12.0 %"), or null. */
  rangeText: string | null;
  /** One entry per value cell, in reading order. */
  cells: LayoutCell[];
  /** One entry per flag token, in reading order. */
  flags: LayoutCell[];
}

/** A line and the reason it was refused as a result row, when it was. */
export interface ClassifiedLine {
  page: number;
  lineNo: number;
  y: number;
  text: string;
  /** Null when the line contributes structure rather than being refused. */
  reason: ExtractionRejectionReason | null;
}

/** Everything the geometry yielded, before any value is interpreted. */
export interface DocumentLayout {
  pages: { page: number; width: number; height: number; itemCount: number; lineCount: number }[];
  headers: PageHeader[];
  blocks: AnalyteBlock[];
  lines: LayoutLine[];
  classified: ClassifiedLine[];
  warnings: ExtractionWarning[];
}

/** Canonical form of a unit fragment, for set membership. */
function normaliseUnit(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'u');
}

/**
 * Unit fragments that may arrive on a line of their own when the interval or the
 * unit above them wrapped. A fixed list, deliberately: a generic "short word"
 * rule would swallow analyte names like `MPV`, `RBC` or `Ca`.
 */
const UNIT_FRAGMENTS = new Set([
  '%',
  'ul',
  'l',
  'dl',
  'fl',
  'pl',
  'ml',
  'cl',
  'gl',
  'g',
  'mg',
  'pg',
  'ng',
  'ug',
  'meq/l',
  'mmol/l',
  'umol/l',
  'mol/l',
  'g/l',
  'g/dl',
  'g/dl',
  'mg/l',
  'mg/dl',
  'ng/ml',
  'ng/dl',
  'pg/ml',
  'ug/ml',
  'uiu/ml',
  'miu/ml',
  'u/ml',
  'u/l',
  'iu/l',
  'k/ul',
  'm/ul',
  'cells/ul',
  'mm/hr',
  'mmhg',
  'ratio',
  'index',
  'units',
  'ml/min',
  'ml/min/1.73m^2',
  'mm/l',
  'sec',
  'fL',
]);

function isUnitFragment(text: string): boolean {
  return UNIT_FRAGMENTS.has(normaliseUnit(text));
}

/** True when the last token of an interval body carries letters (a unit). */
function hasUnitToken(body: string): boolean {
  return /[a-z%][a-z0-9^\/.]*\s*$/i.test(body.trim());
}

/** True when an interval body is not finished (no upper bound printed yet). */
function hasOpenEnd(body: string): boolean {
  return /(?:[-–—−]|>=|<=|>|<|\bto\b)\s*$/i.test(body.trim());
}

/** Strip the printed `Normal Range:` label from an interval line. */
export function stripRangeLabel(text: string): string {
  return text.replace(/^\s*normal\s*range\s*:?\s*/i, '').trim();
}

/** Is this item pure whitespace? Whitespace-only runs carry no text. */
function isBlank(item: PdfTextItem): boolean {
  return item.str.trim() === '';
}

/**
 * Group a page's items into lines by baseline y, top to bottom.
 * Items are returned left to right within a line.
 */
export function groupLines(page: number, items: PdfTextItem[]): Omit<LayoutLine, 'lineNo'>[] {
  const usable = items.filter(item => !isBlank(item) && Number.isFinite(item.x) && Number.isFinite(item.y));
  const sorted = [...usable].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines: Omit<LayoutLine, 'lineNo'>[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) < LINE_TOLERANCE) {
      last.items.push(item);
      continue;
    }
    lines.push({ page, y: item.y, items: [item], text: '' });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = joinedText(line.items);
  }
  return lines;
}

/** Join positioned runs into one string, inserting a space across a real gap. */
export function joinedText(items: PdfTextItem[]): string {
  let text = '';
  let previousEnd = Number.NEGATIVE_INFINITY;
  let previousSize = 0;
  for (const item of items) {
    if (text !== '') {
      const gap = item.x - previousEnd;
      const space = Math.max(previousSize, item.height, 8) * 0.28;
      if (gap > space + JOIN_GAP) text += ' ';
    }
    text += item.str;
    previousEnd = item.x + item.width;
    previousSize = item.height;
  }
  return text.replace(/\s+/g, ' ').trim();
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse a printed date in the forms the documents use: `Mar 3, 2019`,
 * `Aug 31 2023`, `08/31/2023` and `2023-08-31`. Returns an ISO date or null —
 * a date-shaped string that is not a real calendar date is never accepted.
 */
export function parsePrintedDate(text: string): string | null {
  const trimmed = text.trim();
  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return isoDate(monthFirst[3], month, monthFirst[2]);
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) return isoDate(slash[3], slash[1], slash[2]);
  const dashed = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (dashed) return isoDate(dashed[1], dashed[2], dashed[3]);
  return null;
}

function isoDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The page's date-header row: the first line, top down, that carries at least one
 * standalone printed date in the RESULTS region of the page.
 *
 * The results region starts a third of the way across, which is what keeps the
 * patient line ("Date of Birth: Jun 20, 1976") and a document's own date range
 * out: their dates are inside longer runs, or sit at the left margin.
 */
function findHeaderLine(page: number, lines: Omit<LayoutLine, 'lineNo'>[], lineNumbers: number[], width: number): PageHeader | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const dates = line.items
      .map(item => ({ item, iso: parsePrintedDate(item.str), text: item.str.trim() }))
      .filter(entry => entry.iso !== null && entry.item.x >= width * 0.25);
    if (dates.length === 0) continue;
    // One lone date is only a header when the line also names the first column
    // ("Component", "Test", "Analyte", "Result") — otherwise it is a stray date.
    const namesFirstColumn = /component|analyte|^test\b|test name/i.test(line.text);
    if (dates.length < 2 && !namesFirstColumn) continue;
    const columns = dates.map(entry => ({
      dateText: entry.text,
      date: entry.iso,
      centre: entry.item.x + entry.item.width / 2,
      left: 0,
      right: 0,
    }));
    columns.sort((a, b) => a.centre - b.centre);
    // Each column's band reaches to the midpoint of the gap on each side. The
    // OUTER edges mirror the adjacent gap, so the first column's band does not
    // collapse and swallow the leftmost value cell as name text.
    for (let i = 0; i < columns.length; i++) {
      const gapRight =
        i + 1 < columns.length
          ? columns[i + 1].centre - columns[i].centre
          : i > 0
          ? columns[i].centre - columns[i - 1].centre
          : 2 * defaultStep(columns);
      const gapLeft = i > 0 ? columns[i].centre - columns[i - 1].centre : gapRight;
      columns[i].left = columns[i].centre - gapLeft / 2;
      columns[i].right = columns[i].centre + gapRight / 2;
    }
    return { page, lineNo: lineNumbers[index], y: line.y, columns };
  }
  return null;
}

/** The fallback column step when a page has fewer than two columns. */
function defaultStep(columns: { centre: number }[]): number {
  if (columns.length >= 2) return (columns[1].centre - columns[0].centre) / 2;
  return 70;
}

/** Which column a cell at `centre` belongs to, or null when none is near enough. */
function columnFor(columns: LayoutColumn[], centre: number): number | null {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTolerance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < columns.length; index++) {
    const distance = Math.abs(centre - columns[index].centre);
    const neighbours = [columns[index - 1], columns[index + 1]].filter(Boolean) as LayoutColumn[];
    const gap = neighbours.length
      ? Math.min(...neighbours.map(neighbour => Math.abs(columns[index].centre - neighbour.centre)))
      : defaultStep(columns) * 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
      bestTolerance = gap / 2;
    }
  }
  if (best < 0 || bestDistance > bestTolerance) return null;
  return best;
}

/**
 * A flag token, as a report prints it. `Normal` is deliberately absent: it is also
 * a printable qualitative RESULT, and treating it as a flag would attach a marker
 * to a value that never carried one.
 */
const FLAG_TOKEN = /^(?:h|l|hh|ll|a|aa|high|low|abnormal|critical|h\*|l\*)$/i;

/** Was this run a flag token rather than a value? */
export function isFlagToken(text: string): boolean {
  return FLAG_TOKEN.test(text.trim());
}

/**
 * Build the document layout.
 *
 * Pages are processed independently: a multi-page trend document repeats its
 * date-header row on every page and its columns are laid out per page, so column
 * geometry is never carried across a page boundary.
 */
export function buildLayout(geometry: PdfGeometry): DocumentLayout {
  const warnings: ExtractionWarning[] = [];
  const classified: ClassifiedLine[] = [];
  const headers: PageHeader[] = [];
  const blocks: AnalyteBlock[] = [];
  const allLines: LayoutLine[] = [];
  const pages: DocumentLayout['pages'] = [];

  let counter = 0;

  for (const page of geometry.pages) {
    const raw = groupLines(page.page, page.items);
    const lines: LayoutLine[] = raw.map(line => ({ ...line, lineNo: ++counter }));
    allLines.push(...lines);
    pages.push({
      page: page.page,
      width: page.width,
      height: page.height,
      itemCount: page.items.filter(item => !isBlank(item)).length,
      lineCount: lines.length,
    });

    if (lines.length === 0) {
      warnings.push({
        code: 'page_without_text',
        message:
          'This page has no extractable text at all, so it looks like a scan. OCR is not implemented, so nothing was read from it.',
        page: page.page,
        line: null,
      });
      continue;
    }

    const lineNumbers = lines.map(line => line.lineNo);
    const header = findHeaderLine(page.page, raw, lineNumbers, page.width);
    if (header) headers.push(header);

    const boundary = header ? nameRegionEdge(header.columns) : 0;
    const headerIndex = header ? lines.findIndex(line => line.lineNo === header.lineNo) : -1;

    const pageReasons = new Map<number, ExtractionRejectionReason | null>();
    lines.forEach((line, index) => {
      const aboveHeader = headerIndex < 0 ? true : index < headerIndex;
      const reason =
        header && line.lineNo === header.lineNo
          ? 'column_header'
          : classifyLine(line.text, aboveHeader);
      pageReasons.set(line.lineNo, reason);
      classified.push({ page: page.page, lineNo: line.lineNo, y: line.y, text: line.text, reason });
    });

    if (!header) {
      // No date-header row: nothing can be attributed to a column, so no block is
      // started on this page. The lines are still classified for the caller.
      for (const line of lines) {
        if (pageReasons.get(line.lineNo) === null) {
          const fallback: ExtractionRejectionReason = 'outside_table_region';
          pageReasons.set(line.lineNo, fallback);
          const record = classified.find(entry => entry.lineNo === line.lineNo && entry.page === page.page);
          if (record) record.reason = fallback;
        }
      }
      continue;
    }

    // Cells: everything right of the name region, attributed to a column.
    const cellsByLine = new Map<number, { values: LayoutCell[]; flags: LayoutCell[] }>();
    for (const line of lines) {
      if (line.lineNo <= header.lineNo) continue;
      if (pageReasons.get(line.lineNo)) continue;
      const grouped = groupRunCells(line, boundary, header.columns);
      if (grouped.values.length || grouped.flags.length) cellsByLine.set(line.lineNo, grouped);
      for (const cell of [...grouped.values, ...grouped.flags]) {
        if (cell.column === null) {
          warnings.push({
            code: 'cell_out_of_columns',
            message: `A result cell ("${cell.text}") sits too far from every column centre to be attributed to a date, so it was skipped rather than guessed.`,
            page: page.page,
            line: line.lineNo,
          });
        }
      }
    }

    // Blocks, from the left-of-column text only.
    const pageBlocks = collectBlocks(page.page, lines, pageReasons, classified);
    const bySuccession = assignCells(pageBlocks, cellsByLine, page.page, warnings);
    blocks.push(...bySuccession);
  }

  for (const page of pages) {
    if (page.itemCount === 0 && !warnings.some(warning => warning.code === 'page_without_text' && warning.page === page.page)) {
      warnings.push({
        code: 'page_without_text',
        message:
          'This page has no extractable text at all, so it looks like a scan. OCR is not implemented, so nothing was read from it.',
        page: page.page,
        line: null,
      });
    }
  }

  return { pages, headers, blocks, lines: allLines, classified, warnings };
}

/** The x at which the name region ends and the first column's band begins. */
function nameRegionEdge(columns: LayoutColumn[]): number {
  return columns[0].left;
}

/** Split one line's runs into value cells and flag tokens, grouped per column. */
function groupRunCells(
  line: LayoutLine,
  boundary: number,
  columns: LayoutColumn[]
): { values: LayoutCell[]; flags: LayoutCell[] } {
  const values: LayoutCell[] = [];
  const flags: LayoutCell[] = [];
  for (const item of line.items) {
    if (item.x < boundary) continue;
    const centre = item.x + item.width / 2;
    const cell: LayoutCell = {
      page: line.page,
      lineNo: line.lineNo,
      y: line.y,
      x: item.x,
      centre,
      column: columnFor(columns, centre),
      text: item.str.trim(),
    };
    if (cell.text === '') continue;
    (isFlagToken(cell.text) ? flags : values).push(cell);
  }
  return { values: mergeAdjacent(values, line), flags: mergeAdjacent(flags, line) };
}

/**
 * Join runs that landed in the same column on the same line into one cell, which
 * is how a value printed as `12.1` + `%` is read back as a single result.
 */
function mergeAdjacent(cells: LayoutCell[], line: LayoutLine): LayoutCell[] {
  const out: LayoutCell[] = [];
  for (const cell of cells) {
    const previous = out[out.length - 1];
    if (previous && previous.column !== null && previous.column === cell.column && previous.lineNo === line.lineNo) {
      previous.text = `${previous.text} ${cell.text}`.trim();
      continue;
    }
    out.push({ ...cell });
  }
  return out;
}

/** The left-of-column text of a line. */
function leftTextOf(line: LayoutLine, boundary: number): string {
  return joinedText(line.items.filter(item => item.x < boundary));
}

/**
 * Delimit analyte blocks from the left-of-column text, in reading order.
 *
 * A block starts at a line that is neither the interval line nor a continuation
 * of one. Names and wrapped units are folded in by the two rules documented at
 * the top of this file:
 *   * a line whose NEXT left-hand line is the interval line is part of the name;
 *   * a line after the interval line continues the interval when the interval is
 *     unfinished (ends in an operator, or ends in `/`) or has no unit yet and the
 *     line is a known unit fragment.
 */
function collectBlocks(
  page: number,
  lines: LayoutLine[],
  reasons: Map<number, ExtractionRejectionReason | null>,
  classified: ClassifiedLine[]
): AnalyteBlock[] {
  const headerIndex = lines.findIndex(line => reasons.get(line.lineNo) === 'column_header');
  if (headerIndex < 0) return [];
  const inside = lines.slice(headerIndex + 1);
  const boundary = blockBoundary(lines[headerIndex]);
  if (boundary === null) return [];

  const leftLines = inside
    .filter(line => !reasons.get(line.lineNo))
    .map(line => ({ line, left: leftTextOf(line, boundary) }))
    .filter(entry => entry.left !== '');

  const blocks: AnalyteBlock[] = [];
  let current: AnalyteBlock | null = null;
  let phase: 'name' | 'range' = 'name';

  for (let index = 0; index < leftLines.length; index++) {
    const { line, left } = leftLines[index];
    if (/^normal\s*range\b/i.test(left)) {
      if (current) {
        current.rangeText = stripRangeLabel(left) || null;
        phase = 'range';
      } else {
        reasons.set(line.lineNo, 'no_result');
        const record = classified.find(entry => entry.lineNo === line.lineNo && entry.page === page);
        if (record) record.reason = 'no_result';
      }
      continue;
    }
    const nextIsRange = index + 1 < leftLines.length && /^normal\s*range\b/i.test(leftLines[index + 1].left);
    if (current && phase === 'name' && nextIsRange) {
      current.name = `${current.name} ${left}`.trim();
      continue;
    }
    if (current && phase === 'range' && continuesRange(current.rangeText ?? '', left)) {
      current.rangeText = joinRangeContinuation(current.rangeText ?? '', left);
      continue;
    }
    current = { page, lineNo: line.lineNo, nameY: line.y, name: left, rangeText: null, cells: [], flags: [] };
    phase = 'name';
    blocks.push(current);
  }
  return blocks;
}

/** The name-region edge of the header line, recomputed from its own columns. */
function blockBoundary(headerLine: LayoutLine): number | null {
  const dates = headerLine.items
    .map(item => ({ item, iso: parsePrintedDate(item.str) }))
    .filter(entry => entry.iso !== null);
  if (dates.length === 0) return null;
  const centres = dates.map(entry => entry.item.x + entry.item.width / 2).sort((a, b) => a - b);
  const step = centres.length >= 2 ? (centres[1] - centres[0]) / 2 : 70;
  return centres[0] - step;
}

/** Does this left-hand line continue the printed interval above it? */
function continuesRange(rangeText: string, line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/\/$/.test(rangeText.trim())) return true;
  const body = stripRangeLabel(rangeText);
  if (hasOpenEnd(body)) return true;
  if (!hasUnitToken(body) && isUnitFragment(text)) return true;
  return false;
}

/**
 * Append a continuation line to an interval.
 *
 * A unit printed across a line break is one token, not two: `4.10 - 5.70 M/` and
 * `ul` reassemble to `4.10 - 5.70 M/ul`. Joining them with a space would leave a
 * unit the parser could no longer read.
 */
function joinRangeContinuation(rangeText: string, line: string): string {
  const body = rangeText.trim();
  const tail = line.trim();
  if (body.endsWith('/')) return `${body}${tail}`;
  return `${body} ${tail}`.trim();
}

/**
 * Attribute every cell to a block, and each flag to the value it sits beside.
 *
 * BLOCK BANDS. Blocks are delimited by their NAME lines, in reading order. A
 * block's band is (nameY of the next block + BLOCK_REACH, this nameY +
 * BLOCK_REACH]: extending every top edge upward by the same amount slides the
 * boundary between two blocks up to just above the lower block's name, which is
 * where a trend table prints the higher block's value. The bands are contiguous
 * and disjoint, so a cell lands in exactly one of them — no nearest-neighbour
 * scoring, and no way for two candidates to tie.
 *
 * FLAGS. A flag token is attached to the value in the same column of the same
 * block. There is at most one value per column per block, and a flag may sit a
 * line or two above or below it, so no distance test is needed or wanted.
 */
function assignCells(
  blocks: AnalyteBlock[],
  cellsByLine: Map<number, { values: LayoutCell[]; flags: LayoutCell[] }>,
  page: number,
  warnings: ExtractionWarning[]
): AnalyteBlock[] {
  if (blocks.length === 0) return blocks;
  const ordered = [...blocks].sort((a, b) => b.nameY - a.nameY || a.lineNo - b.lineNo);

  const cells: LayoutCell[] = [];
  const flags: LayoutCell[] = [];
  for (const grouped of cellsByLine.values()) {
    cells.push(...grouped.values.filter(cell => cell.column !== null));
    flags.push(...grouped.flags.filter(cell => cell.column !== null));
  }
  const joined = joinWrappedCells(cells);

  for (const cell of joined) {
    const owner = ownerBlock(ordered, cell);
    if (!owner) {
      warnings.push({
        code: 'cell_outside_block',
        message: `A result cell ("${cell.text}") sits outside every analyte row, so it was skipped rather than guessed into one.`,
        page,
        line: cell.lineNo,
      });
      continue;
    }
    const clash = owner.cells.find(existing => existing.column === cell.column);
    if (clash) {
      warnings.push({
        code: 'duplicate_cell_in_column',
        message: `Two value cells landed in the same date column of one analyte row ("${clash.text}" and "${cell.text}"); the later one was skipped rather than chosen between.`,
        page,
        line: cell.lineNo,
      });
      continue;
    }
    owner.cells.push(cell);
  }

  for (const flag of flags) {
    const owner = ownerBlock(ordered, flag);
    if (!owner) continue;
    const candidates = owner.cells.filter(cell => cell.column === flag.column);
    if (candidates.length === 0) {
      warnings.push({
        code: 'flag_without_value',
        message: `A printed flag ("${flag.text}") sits in a date column that carried no value, so it was not attached to anything.`,
        page,
        line: flag.lineNo,
      });
      continue;
    }
    const nearest = candidates.reduce((best, cell) =>
      Math.abs(cell.y - flag.y) < Math.abs(best.y - flag.y) ? cell : best
    );
    nearest.flag = nearest.flag ?? flag.text;
    owner.flags.push(flag);
  }

  for (const block of ordered) block.cells.sort((a, b) => (a.lineNo - b.lineNo) || (a.centre - b.centre));
  ordered.sort((a, b) => a.lineNo - b.lineNo);
  return ordered;
}

/** The block whose band contains a cell; bands are disjoint (see above). */
function ownerBlock(blocks: AnalyteBlock[], cell: LayoutCell): AnalyteBlock | null {
  for (let index = 0; index < blocks.length; index++) {
    const upper = blocks[index].nameY + BLOCK_REACH;
    const lower = index + 1 < blocks.length ? blocks[index + 1].nameY + BLOCK_REACH : Number.NEGATIVE_INFINITY;
    if (cell.y <= upper && cell.y > lower) return blocks[index];
  }
  return null;
}

/**
 * Join a value printed across two lines (`86.85 mL/min/` + `1.73m^2`).
 * Only a cell whose text ends in `/` may absorb the next cell in its column, and
 * only when that cell sits close beneath it.
 */
function joinWrappedCells(cells: LayoutCell[]): LayoutCell[] {
  const out: LayoutCell[] = [];
  const consumed = new Set<LayoutCell>();
  for (const cell of cells) {
    if (consumed.has(cell)) continue;
    if (/\/$/.test(cell.text.trim())) {
      const continuation = cells.find(
        other =>
          !consumed.has(other) &&
          other !== cell &&
          other.column === cell.column &&
          other.lineNo > cell.lineNo &&
          other.y < cell.y &&
          cell.y - other.y <= WRAP_REACH
      );
      if (continuation) {
        cell.text = `${cell.text}${continuation.text}`.replace(/\s+/g, ' ').trim();
        consumed.add(continuation);
      }
    }
    out.push(cell);
  }
  return out;
}

/**
 * Words no analyte line carries. Used to refuse document furniture that would
 * otherwise look like a name, and to refuse identity lines outright.
 */
const LETTERHEAD = /quest diagnostics|laboratory corporation|^labcorp\b|^client #|^req #|^for lab use|psc hold|ref physician|^\s*credentials:|^npi\b|\bnpi:|provider id|internal comments|^collection date|^\s*time:|^time:|bill type|insurance address|patient information|^signature line|^_+$|continued on the next page|end of requisition|ordering provider|^barcode #|^t:\s/i;
/** Document furniture that is not a result: page numbers, footers, bare dates. */
const FOOTER = /^page #|^page\s+\d+\s+of\s+\d+/i;
const IDENTITY = /date of birth|\bdob\b|\bssn\b|social security|^\s*patient\b|responsible party|\brelation\b|^insured\b|^relation\b/i;
const ORDER_ENTRY = /^\s*\d{2,6}\s*-\s+\S/;
const DATE_ONLY = /^[\d\s,./-]*\d[\d\s,./-]*$/;
/** The table's own header label, which names no analyte. */
const COLUMN_HEADER = /^components?(\s|$)/i;

/** A structural verdict on one printed line, or null when it carries structure. */
export function classifyLine(text: string, aboveHeader: boolean): ExtractionRejectionReason | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (/^result trends\b/i.test(trimmed)) return 'document_title';
  if (/^results limited to those after/i.test(trimmed) || /results found from/i.test(trimmed) || /^results?\s+(not\s+)?(limited|after|before)/i.test(trimmed)) return 'notice_line';
  if (/\(table\s+\d+\s+of\s+\d+\)/i.test(trimmed)) return 'table_caption';
  if (IDENTITY.test(trimmed)) return 'identity_line';
  if (LETTERHEAD.test(trimmed)) return 'letterhead_line';
  if (ORDER_ENTRY.test(trimmed)) return 'order_entry';
  if (FOOTER.test(trimmed)) return 'not_a_result_line';
  if (DATE_ONLY.test(trimmed)) return 'not_a_result_line';
  if (COLUMN_HEADER.test(trimmed)) return 'column_header';
  // A question-shaped label is a form field, not an analyte: "Fasting?  Yes  Yes"
  // carries cells that must not be read as results.
  if (trimmed.includes('?')) return 'non_metric_row';
  if (aboveHeader) return 'outside_table_region';
  return null;
}
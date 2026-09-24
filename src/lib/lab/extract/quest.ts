// ── The Quest Diagnostics results layout ─────────────────────────────────────
//
// A SECOND layout family, alongside the LabCorp trend matrix that ./layout.ts
// reads. Where a trend matrix prints DATES AS COLUMNS, a Quest results report
// prints an ordinary ONE ROW PER ANALYTE table and puts a value in whichever of
// two RESULT COLUMNS the report chose:
//
//     Test Name        In Range     Out Of Range     Reference Range     Lab
//     COLOR            YELLOW                        YELLOW              IG
//     SPECIFIC GRAVITY 1.017                        1.001-1.035
//     KETONES                           1+          NEGATIVE            IG
//
// THE COLUMN *IS* THE FLAG. There is no `High`/`Low` token anywhere in this
// layout: a value printed in the `Out Of Range` column is the report's own
// marker. The column's printed wording is therefore recorded verbatim as the
// observation's printed flag — and it is CORROBORATION ONLY. Status is decided
// from the printed INTERVAL (see ../status.ts), so a column label can never
// silently override an interval that says the value is inside it.
//
// WHAT IS GEOMETRY HERE. The header row is located by its own labels, and one x
// per column is taken from the header's OWN runs. Cells in this layout are
// LEFT-ALIGNED at the column's x (unlike the trend matrix, whose cells are
// centred), so a run is attributed to the nearest column whose x is within
// CELL_TOLERANCE of it; a run further away than that belongs to no column at all
// and is dropped rather than pulled into one. The name region is everything left
// of the midpoint between the `Test Name` label and the leftmost data column.
//
// WHY THE TABLE IS NOT READ LINE BY LINE. Three shapes print across two lines:
//   * a PANEL label (`IRON AND TOTAL IRON` / `BINDING CAPACITY`);
//   * a NAME that wraps (`SEX HORMONE BINDING` / `GLOBULIN`);
//   * a PAGE'S PATIENT BLOCK, repeated on every page.
// A label line carries no value, so it is held as a pending fragment and only
// resolved when the next value-bearing line arrives: if that line's name starts
// DEEPER than the fragment, the fragment is a wrapped name belonging to it;
// otherwise the fragment was a group label and is refused as `panel_header`.
// Nothing is guessed in either direction — an unresolved fragment is refused.
//
// PRIVACY. Every line walked produces either an observation or a recorded
// refusal, and every refusal's text goes through `redact`, which replaces a line
// carrying identity, contact or provider data wholesale. The patient block is
// refused as `identity_line`/`letterhead_line` and no identifier (name, DOB,
// phone, patient/health ID, specimen, requisition, physician, NPI, addresses)
// can reach a stored field: there is no field for one.
//
// NOTHING HERE IS A JUDGEMENT. A value, unit, interval or date is only ever what
// the document printed; anything unreadable stays null with the reason recorded.
//
// TWO KINDS OF CELL ARE NOT VALUES. A NOTICE token ("SEE NOTE:", "D:") is a
// pointer to a comment block or a legend, and a reference cell that is only a
// marker ("(calc)") is not an interval: neither may ever become a stored value
// or interval, and both are refused or left null rather than guessed at. A
// BOUNDED result (`<30`, `> OR = 60`, the urinalysis grade `2+`) IS stored — the
// number the document printed, its printed text verbatim and its bound — because
// a bound the reader cannot see is worse than a bound that is explicitly
// unscored; see ../status.ts for how a bounded value is scored.

import type {
  ExtractedObservation,
  ExtractionRejection,
  ExtractionRejectionReason,
  ExtractionWarning,
} from '../types';
import type { DocumentLayout, LayoutLine } from './layout';
import { joinedText } from './layout';
import type { PdfTextItem } from './pdf-items';
import { analyteKeyFor, confidenceOf, parseBoundedCell, parseRangeText, parseValueCell, redact, UNIT_TOKEN } from './parse';
import type { ParsedValue } from './parse';

/** The header labels, exactly as the reports print them. */
const TEST_NAME_HEADER = /^test\s*name$/i;
const IN_RANGE_HEADER = /^in\s*range$/i;
const OUT_OF_RANGE_HEADER = /^out\s*of\s*range$/i;
const SINGLE_RESULT_HEADER = /^result$/i;
const REFERENCE_HEADER = /^reference\s*range$/i;
const LAB_HEADER = /^lab$/i;

/**
 * How far a run's left edge may sit from a column's own x and still belong to it.
 * In this layout cells are left-aligned at the column's x, and the nearest other
 * thing on the page (the `Lab` code column) is over 160 points away, so 40
 * accepts every real cell and cannot reach across a column boundary.
 */
export const CELL_TOLERANCE = 40;

/** One column of a Quest results table, with the x its own header label printed. */
export interface QuestColumn {
  /** `in_range`/`out_of_range`/`result` carry values; `reference` carries the interval. */
  kind: 'in_range' | 'out_of_range' | 'result' | 'reference';
  /** The label exactly as printed, e.g. `In Range`. */
  label: string;
  /** The x of the header's own label; cells are left-aligned to it. */
  x: number;
}

/** The results-table header of one page. */
export interface QuestHeader {
  page: number;
  lineNo: number;
  y: number;
  /** x of the `Test Name` label: the name region's right edge is derived from it. */
  nameX: number;
  /** The value columns and the reference column, in printed order. */
  columns: QuestColumn[];
  /** The value columns, in printed order. Never empty. */
  resultColumns: QuestColumn[];
  /** The x of `Reference Range`, or null when a variant did not print one. */
  referenceX: number | null;
  /** The x of the `Lab` code column, when printed. Never read as a value. */
  labX: number | null;
}

/** The name-region boundary: everything left of this is a test name. */
export function nameBoundaryOf(header: QuestHeader): number {
  const first = Math.min(...header.resultColumns.map(column => column.x));
  return (header.nameX + first) / 2;
}

/**
 * The results-table header on one page, or null.
 *
 * Recognised when a single line carries a `Test Name` label, a `Reference Range`
 * label, and at least one value column (`In Range` + `Out Of Range`, or a lone
 * `Result` — the embedded referral-report variant the same documents contain).
 */
export function findQuestHeader(page: number, lines: LayoutLine[]): QuestHeader | null {
  for (const line of lines) {
    const labels = line.items
      .map(item => ({ item, text: item.str.replace(/\s+/g, ' ').trim() }))
      .filter(entry => entry.text !== '');
    const nameLabel = labels.find(entry => TEST_NAME_HEADER.test(entry.text));
    if (!nameLabel) continue;
    const referenceLabel = labels.find(entry => REFERENCE_HEADER.test(entry.text));
    if (!referenceLabel) continue;

    const resultColumns: QuestColumn[] = [];
    for (const entry of labels) {
      const kind = resultColumnKind(entry.text);
      if (kind) resultColumns.push({ kind, label: entry.text, x: entry.item.x });
    }
    if (resultColumns.length === 0) continue;
    resultColumns.sort((a, b) => a.x - b.x);
    // The reference label must sit to the right of the value columns: a line that
    // merely contains the words is not a header.
    if (referenceLabel.item.x <= resultColumns[resultColumns.length - 1].x) continue;

    const referenceColumn: QuestColumn = { kind: 'reference', label: referenceLabel.text, x: referenceLabel.item.x };
    const columns: QuestColumn[] = [...resultColumns, referenceColumn].sort((a, b) => a.x - b.x);

    const labLabel = labels.find(entry => LAB_HEADER.test(entry.text));
    return {
      page,
      lineNo: line.lineNo,
      y: line.y,
      nameX: nameLabel.item.x,
      columns,
      resultColumns,
      referenceX: referenceLabel.item.x,
      labX: labLabel ? labLabel.item.x : null,
    };
  }
  return null;
}

/** The value-column kind a printed label names, or null. */
function resultColumnKind(text: string): 'in_range' | 'out_of_range' | 'result' | null {
  if (IN_RANGE_HEADER.test(text)) return 'in_range';
  if (OUT_OF_RANGE_HEADER.test(text)) return 'out_of_range';
  if (SINGLE_RESULT_HEADER.test(text)) return 'result';
  return null;
}

/** The header of every page that carries one, in page order. */
export function questHeaders(layout: DocumentLayout): QuestHeader[] {
  const byPage = new Map<number, LayoutLine[]>();
  for (const line of layout.lines) {
    const bucket = byPage.get(line.page);
    if (bucket) bucket.push(line);
    else byPage.set(line.page, [line]);
  }
  const headers: QuestHeader[] = [];
  for (const page of layout.pages) {
    const header = findQuestHeader(page.page, byPage.get(page.page) ?? []);
    if (header) headers.push(header);
  }
  return headers;
}

/** True when this document is a Quest results report rather than a trend matrix. */
export function isQuestResultsLayout(layout: DocumentLayout): boolean {
  return questHeaders(layout).length > 0;
}

/** What the parser decided about a document whose layout this module reads. */
export const QUEST_KIND_REASON =
  'A results table with a Test Name / In Range / Out Of Range / Reference Range header and one row per analyte was found.';

// ── Printed values ───────────────────────────────────────────────────────────

/**
 * The report's own marker when it is appended to a value in the result column
 * (`44.7 L`). The COLUMN carries the flag in this layout too, but the token must
 * never be read as part of the number or as a unit.
 */
const TRAILING_FLAG = /(?:\s+)(?:h\*|l\*|hh|ll|h|l|aa|a|high|low)$/i;

/**
 * A token the report prints IN PLACE OF a result: a pointer to a note, a legend
 * letter, or a bare colon. These are NOT results, and a comment block or legend
 * laid out in the table's own columns must never have its token stored as a
 * value — the row is refused with a recorded reason instead.
 */
export const QUEST_NOTICE_TOKEN = /^(?:see\s+note:?|note:|d:|i:|:)$/i;

/**
 * Parse one result cell of this layout: a value printed in a result column.
 *
 * A trailing High/Low marker is stripped first, so `44.7 L` is the number 44.7
 * and not a unit of litres. A NOTICE/ANNOTATION token returns null: it is never
 * a value. A cell that carries a BOUND (`<30`, `>39`, `1+`) keeps the number the
 * document printed together with an explicit bound flag and the printed text
 * verbatim; everything else is the shared result-cell grammar.
 */
export function parseQuestValueCell(text: string): ParsedValue | null {
  const raw = text.trim();
  if (raw === '' || QUEST_NOTICE_TOKEN.test(raw)) return null;
  const withoutFlag = raw.replace(TRAILING_FLAG, '').trim();
  if (withoutFlag === '') return null;
  return (
    parseBoundedCell(withoutFlag) ??
    parseBoundedCell(raw) ??
    parseValueCell(withoutFlag) ??
    parseValueCell(raw)
  );
}

/** A printed reference cell of this layout. */
export interface QuestReference {
  refLow: number | null;
  refHigh: number | null;
  /** The cell EXACTLY as printed, including any `(calc)` suffix; null for a bare marker. */
  refText: string | null;
  /** The unit the cell carried inline, when it carried one. */
  unit: string | null;
  /**
   * `range` = an interval was read; `unit` = the cell was only a unit;
   * `text` = a printed expected value; `annotation` = the cell was nothing but a
   * marker such as `(calc)`, so there is no interval to read and none is
   * invented. An `annotation` is NOT a failure and raises no warning.
   */
  form: 'range' | 'unit' | 'text' | 'annotation';
}

/** A suffix the report appends to a calculated interval. Never a number, never a unit. */
const ANNOTATION = /\(?\b(?:calc|calculated)\b\)?/gi;
const UNIT_ONLY = new RegExp(String.raw`^${UNIT_TOKEN}$`);
/** A printed EXPECTATION that carries a per-field unit: `NONE SEEN /HPF`, `NONE SEEN /LPF`. */
const EXPECTATION_WITH_UNIT = new RegExp(String.raw`^([A-Za-z][A-Za-z ]*?)\s+(${UNIT_TOKEN})$`);

/**
 * Parse one reference cell.
 *
 * Understood forms, all taken from the documents:
 *   interval        `1.001-1.035`  `50-180 mcg/dL`  `0.40-4.50 mIU/L`
 *   one-sided       `<5.0 (calc)`  `> OR = 60 mL/min/1.73m2`  `< OR = 0.2 mg/dL`
 *   unit only       `mg/dL`  `%`  `uIU/mL`   (the interval is a footnote elsewhere)
 *   expected text   `NEGATIVE`  `YELLOW`  `CLEAR`
 *
 * The printed cell is kept verbatim in `refText`. Null means the cell matched no
 * known form: the caller records `unparsable_range` and stores no interval rather
 * than guessing one. A cell that is ONLY an annotation (`(calc)`) is a printed
 * marker, not a failure: it comes back as `form: 'annotation'` with `refText`
 * null, so no interval and no warning is invented for it.
 */
export function parseQuestReference(text: string): QuestReference | null {
  const printed = text.replace(/\s+/g, ' ').trim();
  if (printed === '') return null;

  // `(calc)` and friends annotate the interval; they are neither a bound nor a unit.
  const core = printed.replace(ANNOTATION, ' ').replace(/\s+/g, ' ').trim();
  // The reports print a comparator with a stranded `or`: `> OR = 60`, `< or = 18.4`.
  const normalised = core.replace(/([<>])\s*or\s*=/gi, '$1=').replace(/\s+/g, ' ').trim();

  if (normalised !== '') {
    const parsed = parseRangeText(normalised);
    if (parsed) {
      return { refLow: parsed.refLow, refHigh: parsed.refHigh, refText: printed, unit: parsed.unit, form: 'range' };
    }
    // A cell of nothing but a unit, with the interval printed in a footnote.
    if (!/\d/.test(core) && UNIT_ONLY.test(core) && parseValueCell(core) === null) {
      return { refLow: null, refHigh: null, refText: printed, unit: core, form: 'unit' };
    }
    // A qualitative EXPECTED VALUE: the report stating what it expects to see.
    const asResult = parseValueCell(core);
    if (asResult && asResult.value === null) {
      return { refLow: null, refHigh: null, refText: printed, unit: null, form: 'text' };
    }
    // The same, with the per-field unit printed beside it: `NONE SEEN /HPF`.
    const expectation = EXPECTATION_WITH_UNIT.exec(core);
    if (expectation) {
      const expected = parseValueCell(expectation[1]);
      if (expected && expected.value === null) {
        return { refLow: null, refHigh: null, refText: printed, unit: null, form: 'text' };
      }
    }
  }
  if (normalised === '' && /calc/i.test(printed)) {
    // A calculated row whose interval was printed on a footnote line. The marker
    // is recognised AS a marker — nothing here is an interval, and nothing is
    // invented to fill the gap.
    return { refLow: null, refHigh: null, refText: null, unit: null, form: 'annotation' };
  }
  return null;
}

// ── Qualitative results ──────────────────────────────────────────────────────

/** The verdict a textual result can be given, and the basis for it. */
export interface QualitativeBasis {
  status: 'in_range' | 'unscored_non_numeric';
  /** Says what the judgement rests on. Never a clinical claim. */
  note: string;
}

/** Compare two printed texts as this report's own spelling allows. */
function sameText(a: string, b: string): boolean {
  const clean = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/:$/, '').toUpperCase();
  return clean(a) === clean(b) && clean(a) !== '';
}

/**
 * Decide what a QUALITATIVE result can be said to be, given the reference cell.
 *
 * A non-numeric result cannot be charted against a numeric interval, so the only
 * thing it can be scored against is the text the report itself printed as the
 * expected value. When the two are the same text the row is counted `in_range`,
 * and the note says so — the basis is a textual match, not a measurement. When
 * they differ, or no expected value was printed, the row is `unscored_non_numeric`
 * with the reason recorded. Returns null for a numeric result: nothing to decide.
 */
export function qualitativeBasisFor(valueText: string, referenceText: string | null): QualitativeBasis | null {
  if (valueText.trim() === '') return null;
  if (referenceText === null || referenceText.trim() === '') {
    return {
      status: 'unscored_non_numeric',
      note: `The result was printed as text ("${valueText}") and the report printed no expected value to compare it with, so it is not scored.`,
    };
  }
  if (sameText(valueText, referenceText)) {
    return {
      status: 'in_range',
      note: `The basis for calling this row in range is a TEXTUAL MATCH: the result ("${valueText}") is the same text the report printed as the expected value ("${referenceText}"). No number is involved and nothing was measured.`,
    };
  }
  return {
    status: 'unscored_non_numeric',
    note: `The result was printed as text ("${valueText}") and the expected value the report printed ("${referenceText}") is different text, so the row cannot be scored and no number is invented for it.`,
  };
}

// ── Furniture and the patient block ──────────────────────────────────────────

/**
 * Lines the reports print around the table. The patient block is repeated on
 * EVERY page, so every one of these must be refused rather than read as a row.
 * Matched against a line that is ABOVE the table header, where a `SURNAME, GIVEN`
 * shape really is a person and never an analyte (the table itself prints names
 * like `BILIRUBIN, TOTAL`, which is why this test is not applied below the header).
 */
const BLOCK_LINE = [
  /^report\s+status\b/i,
  /patient\s+information|specimen\s+information|client\s+information/i,
  /^specimen\s*:/i,
  /^requisition\s*:/i,
  /^lab\s+ref\s*#/i,
  /^client\s*#/i,
  /^client\s+services\b/i,
  /^collected\s*:/i,
  /^received\s*:/i,
  /^reported\s*:/i,
  /^patient\s+id\s*:/i,
  /^health\s+id\s*:/i,
  /^dob\s*:/i,
  /^age\s*:/i,
  /^gender\s*:/i,
  /^fasting\s*:/i,
  /^phone\s*:/i,
  /^comments\s*:/i,
  /^physician\s+comments\s*:/i,
  /^performing\s+site\b/i,
  /^laboratory\s+director\b/i,
  /quest\s+diagnostics|trademark/i,
  /^page\s+\d+\s+of\s+\d+/i,
];

/** The "SURNAME, GIVEN" shape a patient block prints, and only there. */
const PERSON_NAME = /^[A-Z][A-Z'.-]+,\s*[A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+)?$/;
/** A street address, city/state/ZIP or a phone number, as the blocks print them. */
const CONTACT = [
  /\b\d{1,6}\s+[A-Z0-9][A-Za-z0-9 ]*\b(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE|CIR|CIRCLE|PKWY|HWY)\b/i,
  /^[A-Z \t]{3,},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/,
  /(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/,
];

/**
 * What an above-the-table line is stored as.
 *
 * Every line the pages print ABOVE the results header is part of the repeated
 * patient / specimen / client / provider block. Those lines mix a field label
 * with a person's name, address, phone or an accession number, and a label can
 * hide the identifier from any pattern (`Collected: <date> SURNAME, GIVEN`), so
 * the whole line is replaced rather than quoted. The refusal still records WHY
 * the line was refused (`identity_line` / `letterhead_line`); it just cannot
 * carry the identifier with it.
 */
export const QUEST_BLOCK_TEXT = '[redacted: patient, specimen or client block]';

/** Why a line that is NOT part of the table was refused. */
export function questFurnitureReason(text: string): ExtractionRejectionReason | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (/^page\s+\d+\s+of\s+\d+/i.test(trimmed)) return 'not_a_result_line';
  if (BLOCK_LINE.some(pattern => pattern.test(trimmed))) {
    if (/^patient\s+id|^health\s+id|^dob\s*:|^age\s*:|^gender\s*:|^fasting\s*:|^phone\s*:/i.test(trimmed)) {
      return 'identity_line';
    }
    if (/^comments\s*:|^physician\s+comments\s*:/i.test(trimmed)) return 'notice_line';
    return 'letterhead_line';
  }
  if (PERSON_NAME.test(trimmed)) return 'identity_line';
  if (CONTACT.some(pattern => pattern.test(trimmed))) return 'identity_line';
  return null;
}

/**
 * Lines above the table header that matched no known furniture shape. They are
 * still part of the patient/client block the page repeats, so they are refused as
 * letterhead rather than read as a row — and their text is redacted either way.
 */
function aboveHeaderReason(text: string): ExtractionRejectionReason {
  return questFurnitureReason(text) ?? 'letterhead_line';
}

// ── Cells ────────────────────────────────────────────────────────────────────

interface LineCells {
  /** The value printed in a result column, when one was. */
  value: { text: string; label: string; kind: QuestColumn['kind']; x: number } | null;
  /** True when more than one result column carried a cell: the row is ambiguous. */
  ambiguous: boolean;
  /** The reference cell, when one was printed. */
  reference: string | null;
}

/** The reference cell's own x, so a bare-unit cell keeps its printed column. */
function cellsOfLine(line: LayoutLine, header: QuestHeader, boundary: number): LineCells {
  const buckets = new Map<QuestColumn, string[]>();
  for (const item of line.items) {
    if (item.x < boundary) continue;
    const column = nearestColumn(header, item.x);
    if (!column) continue;
    const text = item.str.trim();
    if (text === '') continue;
    const bucket = buckets.get(column);
    if (bucket) bucket.push(text);
    else buckets.set(column, [text]);
  }

  const valueColumns = header.resultColumns.filter(column => buckets.has(column));
  const referenceColumn = header.columns.find(column => column.kind === 'reference');
  const referenceParts = referenceColumn ? buckets.get(referenceColumn) : undefined;

  return {
    value: valueColumns.length
      ? {
          text: (buckets.get(valueColumns[0]) as string[]).join(' ').trim(),
          label: valueColumns[0].label,
          kind: valueColumns[0].kind,
          x: valueColumns[0].x,
        }
      : null,
    ambiguous: valueColumns.length > 1,
    reference: referenceParts ? referenceParts.join(' ').trim() : null,
  };
}

/** The value column a run's left edge belongs to, or null when none is near enough. */
function nearestColumn(header: QuestHeader, x: number): QuestColumn | null {
  let best: QuestColumn | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const column of header.columns) {
    const distance = Math.abs(x - column.x);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= CELL_TOLERANCE ? best : null;
}

// ── Panel labels ─────────────────────────────────────────────────────────────

/**
 * Is this a panel/section label rather than an analyte with a missing value?
 * The reports print them as ALL-CAPS group labels carrying no value and no
 * interval, so that is exactly what is tested — anything else is refused as a
 * notice instead of being called a panel.
 */
export function isPanelLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (/[a-z]/.test(trimmed)) return false;
  return /[A-Z]/.test(trimmed);
}

// ── Dates ────────────────────────────────────────────────────────────────────

const COLLECTED_LABEL = /collected\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i;
const REPORTED_LABEL = /reported\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i;

/** One page's printed `Collected:` date. This is the OBSERVATION date. */
export function questCollectedDates(layout: DocumentLayout): Map<number, string> {
  return questFieldDates(layout, COLLECTED_LABEL);
}

/**
 * The document's own `Reported:` date.
 *
 * A document may carry more than one report (a page can be a second specimen's
 * report), so the LAST `Reported:` printed is used: it is the date the document
 * as a whole was produced. The date is only ever what the document printed —
 * nothing is inferred from the file name or the file's own timestamp here.
 */
export function questDocumentDate(layout: DocumentLayout): string | null {
  const dates = [...questFieldDates(layout, REPORTED_LABEL).entries()].sort((a, b) => a[0] - b[0]);
  return dates.length ? (dates[dates.length - 1][1] as string) : null;
}

/** A printed labelled date, per page: `Collected:` and `Reported:` live on one line. */
function questFieldDates(layout: DocumentLayout, label: RegExp): Map<number, string> {
  const dates = new Map<number, string>();
  for (const line of layout.lines) {
    const match = label.exec(line.text);
    if (!match) continue;
    const iso = isoFromSlashDate(match[1]);
    if (iso && !dates.has(line.page)) dates.set(line.page, iso);
  }
  return dates;
}

/** A printed `MM/DD/YYYY` → `YYYY-MM-DD`. A date-shaped string that is not a date stays null. */
function isoFromSlashDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, month, day, year] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(Number(year), m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── The walk ─────────────────────────────────────────────────────────────────

/** Everything a Quest-layout document yielded, in the shape ./parse.ts shares. */
export interface QuestInterpretation {
  observations: ExtractedObservation[];
  warnings: ExtractionWarning[];
  rejections: ExtractionRejection[];
  /** How many lines were refused as panel/section labels. */
  panelHeaders: number;
  /** Pages on which the results header was found. */
  tablePages: number[];
}

interface Fragment {
  line: LayoutLine;
  name: string;
  x: number;
}

/**
 * Read every page: locate the table, walk every printed line, and turn the rows
 * into observations. Anything the geometry does not support is refused with a
 * recorded reason — nothing is guessed into a row.
 */
export function interpretQuest(layout: DocumentLayout): QuestInterpretation {
  const observations: ExtractedObservation[] = [];
  const warnings: ExtractionWarning[] = [...layout.warnings];
  const rejections: ExtractionRejection[] = [];
  const tablePages: number[] = [];
  let panelHeaders = 0;

  const headers = new Map(questHeaders(layout).map(header => [header.page, header]));
  const collected = questCollectedDates(layout);
  const documentCollected = [...collected.entries()].sort((a, b) => a[0] - b[0])[0]?.[1] ?? null;

  interface Candidate {
    observation: ExtractedObservation;
    page: number;
    y: number;
    x: number;
  }
  const candidates: Candidate[] = [];

  const refuse = (line: LayoutLine, reason: ExtractionRejectionReason, text: string = redact(line.text)) => {
    if (reason === 'panel_header') panelHeaders += 1;
    rejections.push({ page: line.page, lineNo: line.lineNo, text, reason });
  };

  for (const page of layout.pages) {
    const pageLines = layout.lines
      .filter(line => line.page === page.page)
      .sort((a, b) => b.y - a.y || a.lineNo - b.lineNo);
    const header = headers.get(page.page);

    if (!header) {
      // No results table on this page: every line is refused, with its own reason.
      for (const line of pageLines) refuse(line, questFurnitureReason(line.text) ?? 'not_a_result_line');
      continue;
    }
    tablePages.push(page.page);
    const boundary = nameBoundaryOf(header);
    const resultOn = collected.get(page.page) ?? documentCollected;
    const pending: Fragment[] = [];

    const flushPending = () => {
      for (const fragment of pending) {
        refuse(fragment.line, isPanelLabel(fragment.name) ? 'panel_header' : 'notice_line');
      }
      pending.length = 0;
    };

    for (const line of pageLines) {
      if (line.lineNo === header.lineNo) {
        refuse(line, 'column_header');
        continue;
      }
      if (line.lineNo < header.lineNo) {
        // The repeated patient/client block, above the table on every page. Its
        // lines are refused as identity/letterhead furniture AND replaced whole,
        // so no name, address, phone or accession number can ride out with one.
        refuse(line, aboveHeaderReason(line.text), QUEST_BLOCK_TEXT);
        continue;
      }

      const furniture = questFurnitureReason(line.text);
      if (furniture && furniture !== 'empty') {
        if (pending.length) flushPending();
        refuse(line, furniture);
        continue;
      }

      const nameItems: PdfTextItem[] = line.items.filter(item => item.x < boundary);
      const name = joinedText(nameItems);
      const cells = cellsOfLine(line, header, boundary);

      if (name === '') {
        // Text in the columns but no test name: a footnote block laid out in the
        // table's own columns. It is not a result row.
        if (cells.value || cells.reference) refuse(line, 'not_a_result_line');
        else refuse(line, 'empty');
        continue;
      }

      if (!cells.value && cells.reference === null) {
        // A group label, a note, or a name that wrapped onto this line.
        const x = nameItems.length ? nameItems[0].x : line.items[0]?.x ?? 0;
        const previous = pending[pending.length - 1];
        if (previous && x <= previous.x) flushPending();
        pending.push({ line, name, x });
        continue;
      }

      if (!cells.value) {
        // A printed interval with no value beside it: there is no result to store.
        if (pending.length) flushPending();
        refuse(line, 'no_result');
        continue;
      }

      if (QUEST_NOTICE_TOKEN.test(cells.value.text.trim())) {
        // The result column carried a NOTICE/ANNOTATION token ("SEE NOTE:", "D:")
        // — a pointer to a comment block or a legend, never a result. The row is
        // refused whole; the token is never stored as a value.
        if (pending.length) flushPending();
        refuse(line, 'notice_line');
        continue;
      }

      const nameX = nameItems.length ? nameItems[0].x : 0;
      const held = pending.length === 1 ? pending[0] : null;
      let printedName = name;
      if (held && isPanelLabel(held.name) && nameX > held.x && held.x > header.nameX) {
        // ONE held ALL-CAPS fragment, printed right of the `Test Name` column and
        // shallower than this line: the two are the halves of one wrapped name
        // (`SEX HORMONE BINDING` / `GLOBULIN`). A fragment printed flush with the
        // `Test Name` column is a PANEL label, and two or more held fragments are
        // a wrapped panel label — neither is ever merged into a row's name.
        printedName = `${held.name} ${name}`.trim();
        pending.length = 0;
      } else if (pending.length) {
        flushPending();
      }

      if (!resultOn) {
        warnings.push({
          code: 'unparsable_value',
          message: `The row "${printedName}" sits on a page whose printed collection date could not be read, so it was not stored against an invented date.`,
          page: line.page,
          line: line.lineNo,
        });
        continue;
      }
      if (cells.ambiguous) {
        warnings.push({
          code: 'duplicate_cell_in_column',
          message: `Two result columns carried a cell for "${printedName}", so the row was skipped rather than choosing between them.`,
          page: line.page,
          line: line.lineNo,
        });
        continue;
      }

      const parsedValue = parseQuestValueCell(cells.value.text);
      if (!parsedValue) {
        warnings.push({
          code: 'unparsable_value',
          message: `A result cell ("${cells.value.text}") of "${printedName}" matched no known result form, so it was skipped rather than guessed.`,
          page: line.page,
          line: line.lineNo,
        });
        continue;
      }
      if (parsedValue.value === null && (parsedValue.valueText ?? '').trim() === '') {
        // A row with NO usable value is refused, never stored: an empty value
        // beside a printed interval is a legend or a comment, not a result.
        if (pending.length) flushPending();
        refuse(line, 'notice_line');
        continue;
      }

      const reference = cells.reference === null ? null : parseQuestReference(cells.reference);
      // A cell that is only a marker (`(calc)`) carries no interval, so nothing is
      // stored for it and no `unparsable_range` warning is raised: the marker is
      // kept in the row's own text instead.
      const annotationOnly = reference !== null && reference.form === 'annotation';
      if (cells.reference !== null && reference === null) {
        warnings.push({
          code: 'unparsable_range',
          message: `The reference cell printed for "${printedName}" ("${cells.reference}") matched no known form, so it was left unread and no interval is stored for the row.`,
          page: line.page,
          line: line.lineNo,
        });
      }
      const intervalReference = annotationOnly ? null : reference;

      const qualitative = parsedValue.value === null
        ? qualitativeBasisFor(parsedValue.valueText ?? '', intervalReference ? intervalReference.refText : null)
        : null;
      if (qualitative) {
        warnings.push({
          code: 'non_numeric_result',
          message: `"${printedName}" printed a non-numeric result ("${parsedValue.valueText}"). ${qualitative.note}`,
          page: line.page,
          line: line.lineNo,
        });
      }

      // The COLUMN the value was printed in is the report's own marker. A single
      // `Result` column prints no in/out distinction, so it records no flag.
      const printedFlag = cells.value.kind === 'result' ? null : cells.value.label;

      // No interval may be claimed from a marker-only cell, so such a row is
      // stored with `refText` null and `refSource` `none` — the marker survives
      // in the row's own printed text (`sourceLine`), which is the note for it.
      const referenceUnit = intervalReference ? intervalReference.unit : null;
      const refText = reference ? reference.refText : cells.reference;

      candidates.push({
        page: line.page,
        y: line.y,
        x: cells.value.x,
        observation: {
          lineNo: 0,
          analyteKey: analyteKeyFor(printedName),
          printedName,
          resultOn,
          value: parsedValue.value,
          valueText: parsedValue.valueText,
          unit: parsedValue.unit ?? referenceUnit ?? null,
          refLow: intervalReference ? intervalReference.refLow : null,
          refHigh: intervalReference ? intervalReference.refHigh : null,
          refText,
          refSource: cells.reference === null || annotationOnly ? 'none' : 'report',
          refBasis: qualitative ? qualitative.note : null,
          printedFlag,
          category: null,
          extractionMethod: 'deterministic',
          confidence: confidenceOf({
            name: printedName,
            hasValue: parsedValue.value !== null || parsedValue.valueText !== null,
            unit: parsedValue.unit ?? referenceUnit ?? null,
            range: intervalReference ? intervalReference.refText : annotationOnly ? null : cells.reference,
          }),
          sourceLine: redact(
            [printedName, cells.value.text, cells.reference ?? ''].filter(part => part !== '').join(' | ')
          ),
        },
      });
    }

    flushPending();
  }

  candidates.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  candidates.forEach((candidate, index) => {
    candidate.observation.lineNo = index + 1;
    observations.push(candidate.observation);
  });

  return { observations, warnings, rejections, panelHeaders, tablePages };
}

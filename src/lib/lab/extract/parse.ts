// ── Interpretation: cells, intervals, flags, aliases, kind and dates ─────────
//
// Turns the structural blocks from ./layout.ts into observations, and reads the
// document-level facts around them. Everything here is conservative in the same
// way: a token is understood only if it matches a form that was actually seen in
// the documents, and anything else becomes a warning or a recorded refusal —
// never a guess, never a 0, never an invented unit, interval or date.
//
// WHERE THE VALUES COME FROM. A trend document prints one value per date COLUMN,
// so a block yields as many observations as it has value cells. Each observation
// carries the column's own date (`resultOn`); the document date is a separate
// fact about the file (`documentDate`) and is never used as a result date.
//
// PRIVACY. The documents also carry a name, date of birth, home address, phone
// number, an SSN field and the physician's name and NPI. `hasPii`/`redact` are
// applied to every line that could reach storage, so an identity line is
// replaced wholesale rather than quoted. `source_line` is built from an analyte
// row's own text and is redacted defensively as well.

import type {
  ExtractedObservation,
  ExtractionRejection,
  ExtractionResult,
  ExtractionWarning,
  LabDocumentKind,
  LabRefSource,
} from '../types';
import type { DocumentLayout } from './layout';
import { descriptiveNote, isDescriptiveAnalyte } from '../qualitative';
import { parsePrintedDate, stripRangeLabel } from './layout';

/** The parser's own version, written into `lab_reports.extraction`. */
export const PARSER_VERSION = 'lab-extract/2';

/** A decimal number with optional thousands separators. */
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const COMPARATOR = String.raw`<=|>=|<|>`;
/**
 * A unit token. A leading `/` is allowed because reports print per-field units
 * that way (`< OR = 5 /HPF`, `NONE SEEN /LPF`).
 */
export const UNIT_TOKEN = String.raw`\/?[A-Za-z%µ][A-Za-z0-9%µ^/.\-]*`;

/**
 * A comparator a printed RESULT cell carries when the report BOUNDED the value
 * instead of measuring it (`<30`, `<=200`, `>39`, `>=40`), or the urinalysis
 * grade `+` a report appends to a count (`1+`, `2+`).
 *
 * A `+` grade is a LOWER bound: the result is that grade or more and nothing is
 * known above it. It is listed here rather than among the qualitative words
 * because a bounded result is not a measurement and must never be charted as
 * one — see `scoreResult` in ../status.ts, which leaves every bounded value
 * unscored unless the whole bound region is provably inside the interval.
 */
export type PrintedBound = '<' | '<=' | '>' | '>=' | '+';

/** A parsed result cell. At least one of `value`/`valueText` is non-null. */
export interface ParsedValue {
  value: number | null;
  /** The printed string, whenever the result is not a plain number. */
  valueText: string | null;
  /** The unit exactly as printed, or null. Never invented, never copied. */
  unit: string | null;
  /**
   * The comparator the cell carried, when it carried one. Set only by
   * `parseBoundedCell` (the Quest path); a plain number leaves it undefined, so
   * the trend-matrix path is untouched. A value that carries a bound is ALWAYS
   * labelled by it in `valueText` as well — the printed text is the evidence.
   */
  bound?: PrintedBound | null;
}

/**
 * Parse one result cell.
 *
 * Understood forms, all taken from the documents:
 *   plain           `12.3`  `1.03`  `2,000`
 *   with a unit     `12.1 %`  `161 mg/dL`  `3.73 ratio`  `5.33 M/ul`
 *   a compound unit `86.85 mL/min/1.73m^2`
 *   bounded         `<0.5`  `<=200`  `>39`  `>=40`
 *   qualitative     `NEGATIVE`  `Negative`  `TRACE`  `+`
 *
 * A bounded or qualitative result keeps its printed text in `valueText` and
 * leaves `value` null: there is no number to chart, and inventing one would be
 * the whole of the mistake this parser exists to avoid.
 */
export function parseValueCell(text: string): ParsedValue | null {
  const raw = text.trim();
  if (!raw) return null;

  const plain = new RegExp(String.raw`^([+-]?${NUM})(?:\s*(${UNIT_TOKEN}))?$`).exec(raw);
  if (plain) {
    const value = toNumber(plain[1]);
    if (value === null) return null;
    return { value, valueText: null, unit: plain[2] ? plain[2].trim() : null };
  }

  const bounded = new RegExp(String.raw`^(${COMPARATOR})\s*(${NUM})(?:\s*(${UNIT_TOKEN}))?$`).exec(raw);
  if (bounded) {
    return {
      value: null,
      valueText: `${bounded[1].trim()}${bounded[2].trim()}`,
      unit: bounded[3] ? bounded[3].trim() : null,
    };
  }

  const qualitative =
    /^(?:negative|non-?reactive|reactive|positive|trace|present|absent|not\s+detected|not\s+done|see\s+note:?|none\s+seen|none|\bn\.?d\.?\b|clear|cloudy|yellow|amber|straw|small|moderate|large|\d\+{1,2}|\+{1,4}|tntc|tnp|few|many|occasional)$/i.exec(
      raw
    );
  if (qualitative) {
    // Preserved exactly as printed: the report's own spelling is the evidence.
    return { value: null, valueText: raw, unit: null };
  }

  return null;
}

/**
 * Parse a result cell that carries a BOUND rather than a measurement.
 *
 * Understood forms, all taken from the documents:
 *   upper   `<30`  `<=200`  `< OR = 0.2 mg/dL`
 *   lower   `>39`  `>=40`   `> OR = 60 mL/min/1.73m2`
 *   grade   `1+`  `2+`     (urinalysis: the printed grade or more)
 *
 * THE PRINTED TEXT IS KEPT VERBATIM in `valueText`, including the report's own
 * stranded `OR =` spelling, and any unit stays in `unit`. The number is the one
 * the document PRINTED — nothing is inferred from it and no endpoint is
 * invented. Returns null for anything that is not one of these forms, so a
 * caller can fall back to the shared grammar without a bound being half-read.
 */
export function parseBoundedCell(text: string): ParsedValue | null {
  const raw = text.trim();
  if (raw === '') return null;

  const comparator = new RegExp(
    String.raw`^((?:<=|>=|<|>)(?:\s*or\s*=)?)\s*(${NUM})(?:\s*(${UNIT_TOKEN}))?$`,
    'i'
  ).exec(raw);
  if (comparator) {
    const value = toNumber(comparator[2]);
    if (value === null) return null;
    const unit = comparator[3] ? comparator[3].trim() : null;
    // The unit is split off; everything before it is the printed bound verbatim.
    const valueText = unit ? raw.slice(0, raw.length - comparator[3].length).trim() : raw;
    return { value, valueText, unit, bound: normaliseBound(comparator[1]) };
  }

  const grade = new RegExp(String.raw`^(${NUM})\+\s*(${UNIT_TOKEN})?$`).exec(raw);
  if (grade) {
    const value = toNumber(grade[1]);
    if (value === null) return null;
    const unit = grade[2] ? grade[2].trim() : null;
    const valueText = unit ? raw.slice(0, raw.length - grade[2].length).trim() : raw;
    return { value, valueText, unit, bound: '+' };
  }

  return null;
}

/** `< OR =` is the report's spelling of `<=`; everything else is read as written. */
function normaliseBound(token: string): PrintedBound {
  const compact = token.replace(/\s+/g, '').replace(/or/i, '');
  if (compact.startsWith('<')) return compact.endsWith('=') ? '<=' : '<';
  return compact.endsWith('=') ? '>=' : '>';
}

/** A printed reference interval. */
export interface ParsedRange {
  refLow: number | null;
  refHigh: number | null;
  /** The interval exactly as printed, including a one-sided operator. */
  refText: string;
  refSource: LabRefSource;
  /** The unit printed with the interval, or null. */
  unit: string | null;
}

/**
 * Parse a printed reference interval.
 *
 * Understood forms — one-sided (`>40 mg/dL`, `<100 mg/dL`, `<= 200`, `>= 40`)
 * and two-sided with any printed separator (`140 - 200 mg/dL`, `70-99`,
 * `70 – 99`, `70 to 99`, `0.00 - 4.44 ratio`), each optionally carrying a unit.
 *
 * The printed text is kept verbatim in `refText`, so a one-sided interval is not
 * flattened into a bound it never had.
 */
export function parseRangeText(text: string): ParsedRange | null {
  const raw = stripRangeLabel(text).trim();
  if (!raw) return null;

  const oneSided = new RegExp(String.raw`^(${COMPARATOR})\s*(${NUM})\s*(${UNIT_TOKEN})?$`).exec(raw);
  if (oneSided) {
    const bound = toNumber(oneSided[2]);
    if (bound === null) return null;
    const isUpper = oneSided[1].startsWith('<');
    return {
      refLow: isUpper ? null : bound,
      refHigh: isUpper ? bound : null,
      refText: raw,
      refSource: 'report',
      unit: oneSided[3] ? oneSided[3].trim() : null,
    };
  }

  const twoSided = new RegExp(
    String.raw`^(${NUM})\s*(?:-|–|—|−|to)\s*(${NUM})\s*(${UNIT_TOKEN})?$`,
    'i'
  ).exec(raw);
  if (twoSided) {
    const low = toNumber(twoSided[1]);
    const high = toNumber(twoSided[2]);
    if (low === null || high === null) return null;
    return {
      refLow: low,
      refHigh: high,
      refText: raw,
      refSource: 'report',
      unit: twoSided[3] ? twoSided[3].trim() : null,
    };
  }

  return null;
}

function toNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * The report's own flag tokens. Exactly the markers a report prints; `Normal` is
 * deliberately NOT here, because it is also a printed qualitative RESULT and
 * calling it a flag would attach a marker to a value that never carried one.
 */
const FLAG = /^(?:h|l|hh|ll|a|aa|high|low|abnormal|critical|h\*|l\*)$/i;

/** Normalise a printed flag token for storage, or return null. */
export function parseFlag(text: string): string | null {
  const raw = text.trim();
  if (!raw || !FLAG.test(raw)) return null;
  return raw;
}

// ── Analyte keys ─────────────────────────────────────────────────────────────

/**
 * The alias map, keyed by the printed name with every non-alphanumeric removed.
 *
 * Only aliases the documents actually print are listed. An unrecognised name is
 * NOT dropped: it falls back to a slug of the printed name, so a new analyte
 * still gets a stable key and still appears.
 */
const ALIASES: Record<string, string> = {
  sgptalt: 'alt',
  'sgpt(alt)': 'alt',
  sgotast: 'ast',
  'sgot(ast)': 'ast',
  glycohemoglobinghbtotal: 'hba1c',
  'glycohemoglobin(ghb),total': 'hba1c',
  glycohemoglobin: 'hba1c',
  hba1c: 'hba1c',
  chd: 'cholesterol_hdl_ratio',
  'cholesterol/hdlratio': 'cholesterol_hdl_ratio',
  eag: 'estimated_average_glucose',
  estimatedaverageglucose: 'estimated_average_glucose',
  nepercent: 'neutrophils_pct',
  lypercent: 'lymphocytes_pct',
  mopercent: 'monocytes_pct',
  eopercent: 'eosinophils_pct',
  bapercent: 'basophils_pct',
  neabsolute: 'neutrophils_abs',
  lyabsolute: 'lymphocytes_abs',
  moabsolute: 'monocytes_abs',
  eoabsolute: 'eosinophils_abs',
  baabsolute: 'basophils_abs',
  // The differential rows print their own symbols: the lookup key keeps `%` and
  // `#`, because they are what distinguishes a percentage from an absolute count.
  'ne%': 'neutrophils_pct',
  'ly%': 'lymphocytes_pct',
  'mo%': 'monocytes_pct',
  'eo%': 'eosinophils_pct',
  'ba%': 'basophils_pct',
  'ne#': 'neutrophils_abs',
  'ly#': 'lymphocytes_abs',
  'mo#': 'monocytes_abs',
  'eo#': 'eosinophils_abs',
  'ba#': 'basophils_abs',
  wbc: 'wbc',
  rbc: 'rbc',
  hgb: 'hemoglobin',
  hct: 'hematocrit',
  hematocrit: 'hematocrit',
  plt: 'platelets',
  plateletcount: 'platelets',
  mpv: 'mpv',
  mcv: 'mcv',
  mch: 'mch',
  mchc: 'mchc',
  rdw: 'rdw',
  cholesterol: 'cholesterol_total',
  'cholesterol,total': 'cholesterol_total',
  triglycerides: 'triglycerides',
  hdlcholesterol: 'hdl',
  hdl: 'hdl',
  ldlcholesterol: 'ldl',
  ldl: 'ldl',
  sodium: 'sodium',
  potassium: 'potassium',
  chloride: 'chloride',
  eco2: 'co2',
  co2: 'co2',
  glucose: 'glucose',
  bun: 'bun',
  creatinine: 'creatinine',
  creatininekinase: 'creatinine_kinase',
  creatinineserum: 'creatinine',
  egfr: 'egfr',
  'bilirubintotal': 'bilirubin_total',
  alkalinephosphatase: 'alkaline_phosphatase',
  'proteintotal': 'protein_total',
  albumin: 'albumin',
  globulintotal: 'globulin',
  agratio: 'albumin_globulin_ratio',
  'a/gratio': 'albumin_globulin_ratio',
  aniongap: 'anion_gap',
  ca: 'calcium',
  calcium: 'calcium',
  phos: 'phosphate',
  magnesium: 'magnesium',
  ast: 'ast',
  alt: 'alt',
};

/** The key the alias map looks up: the printed name, punctuation removed. */
function aliasLookupKey(printedName: string): string {
  return printedName.toLowerCase().replace(/[^a-z0-9%#]/g, '');
}

/**
 * The canonical key for an analyte. The printed name is preserved separately and
 * is never replaced by the key.
 */
export function analyteKeyFor(printedName: string): string {
  const key = aliasLookupKey(printedName);
  const alias = ALIASES[key];
  if (alias) return alias;
  const slug = printedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown';
}

// ── Privacy ──────────────────────────────────────────────────────────────────

/**
 * The `SURNAME, GIVEN` shape a patient block prints. Kept as its own name because
 * it is the ONE identity shape that is also a printed TABLE name: a results table
 * prints analytes and panels like `BILIRUBIN, TOTAL` and `URINALYSIS, COMPLETE`.
 */
const PERSON_NAME_SHAPE = /^[A-Z]{2,},\s*[A-Z]{2,}\b/;

/**
 * Patterns for the identity, contact and provider fields a lab document carries.
 * Deliberately broad: a false positive costs one redacted diagnostic line, a
 * false negative would put a person's address in a database.
 */
const PII_PATTERNS: RegExp[] = [
  /date of birth|\bdob\b|\bssn\b|social security|maiden name/i,
  /\bpatient\b|responsible party|\brelation\b|\binsured\b|\bguarantor\b/i,
  /\bphysician\b|\bprovider\b|\bnpi\b|\bcredentials\b|\bmd\b|\bphysician id\b/i,
  // Specimen, requisition and accession identifiers identify a person's record
  // just as surely as a name does, so a line carrying one is redacted whole.
  /\bhealth\s*id\b|\bpatient\s*id\b|\bspecimen\b|\brequisition\b|\blab\s*ref\s*#|\bclient\s*#|\baccession\b/i,
  /(?:^|[^\d(])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?:[^\d]|$)/, // phone
  /(?:^|\D)\d{3}-\d{2}-\d{4}(?:\D|$)/, // SSN
  /\b\d{1,6}\s+[A-Z][A-Za-z]*(?:\s+[A-Z0-9][A-Za-z0-9]*)*\s+(?:AVE|AVENUE|ST|STREET|RD|ROAD|BLVD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE|CIR|CIRCLE|TRAIL|PKWY|HWY)\b/i,
  /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/, // state + ZIP
  PERSON_NAME_SHAPE, // SURNAME, GIVEN
  /\b[A-F0-9]{8,}-[A-F0-9]{8,}\b/, // accession / reference identifier
];

/** True when a line carries identity, contact or provider data. */
export function hasPii(text: string): boolean {
  return PII_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * The identity patterns that still apply INSIDE a results table, where the
 * `SURNAME, GIVEN` shape is a printed test or panel name (`BILIRUBIN, TOTAL`,
 * `URINALYSIS, COMPLETE`) rather than a person. Everything else in
 * `PII_PATTERNS` — a date of birth, a phone number, an address, a specimen or
 * requisition identifier, a provider name — is identity wherever it appears, so a
 * table label is only kept when this returns false for it.
 */
const TABLE_PII_PATTERNS = PII_PATTERNS.filter(pattern => pattern !== PERSON_NAME_SHAPE);

/** True when a line carries identity that is never a table row's own text. */
export function hasTablePii(text: string): boolean {
  return TABLE_PII_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Make a line safe to keep. A line carrying identity data is replaced wholesale:
 * quoting "most of" an address or an SSN is not a partial leak, it is a leak.
 * Everything is also length-bounded, because a diagnostic record is not a place
 * to store a paragraph.
 */
export function redact(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (hasPii(trimmed)) return '[redacted: identity or provider details]';
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

// ── Document-level facts ─────────────────────────────────────────────────────

/** Printed labels that carry the date the document itself was produced. */
const DATE_LABELS = [
  /(?:collection|collected|report(?:ed)?|result|specimen|draw|drawn|service|test)\s*date\s*[:#]?\s*/i,
  /date\s*of\s*service\s*[:#]?\s*/i,
  /printed\s*on\s*[:#]?\s*/i,
];

/**
 * Detect the date the DOCUMENT was produced, or null.
 *
 * Precedence, exactly as documented: an explicit printed field, else the file's
 * own creation date, else the date in the filename, else null. A date is never
 * taken from a result cell — that is an observation date, not a document date —
 * and never invented. A label with an empty value ("Collection Date:") is not a
 * date and is skipped rather than filled in.
 */
export function detectDocumentDate(input: {
  text: string;
  filename: string | null;
  creationDate: string | null;
}): string | null {
  const flattened = input.text.replace(/\s+/g, ' ');
  for (const label of DATE_LABELS) {
    const match = label.exec(flattened);
    if (!match) continue;
    const tail = flattened.slice(match.index + match[0].length, match.index + match[0].length + 40);
    const token = /(\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{2})/.exec(tail);
    if (token) {
      const parsed = parsePrintedDate(token[1]) ?? parsePrintedDate(token[1].replace(/\b(\d{2})\b$/, match => `20${match}`));
      if (parsed) return parsed;
    }
  }

  if (input.creationDate) return input.creationDate;

  if (input.filename) {
    const dateInName = /(\d{4}[-_.]\d{1,2}[-_.]\d{1,2}|[A-Za-z]{3,9}\.?\s*\d{1,2},?\s*\d{4}|\d{1,2}[-_]\d{1,2}[-_]\d{4})/.exec(input.filename);
    if (dateInName) {
      const candidate = parsePrintedDate(dateInName[1].replace(/[_.]/g, '-'));
      if (candidate) return candidate;
    }
  }

  return null;
}

/**
 * The panel a document covers, when its FILE NAME states one.
 *
 * The LabCorp trend exports are named `<kind> - <panel> - <date>`
 * (`Result Trends - Lipid Panel - Sep 14, 2026.PDF`), and a trend document prints
 * no panel heading anywhere in its text: the panel it covers is only ever what
 * the file's own name states. The shape is read strictly — three ` - ` separated
 * parts, the last carrying a four-digit year — and anything else yields null
 * rather than a guess. A document that prints its own panel headings (a Quest
 * results report) never needs this.
 */
export function detectPanelFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const stem = filename.replace(/\.[A-Za-z0-9]+$/, '').trim();
  const parts = stem
    .split(/\s+-\s+/)
    .map(part => part.trim())
    .filter(part => part !== '');
  if (parts.length < 3) return null;
  if (!/\d{4}/.test(parts[parts.length - 1])) return null;
  const panel = parts.slice(1, -1).join(' - ');
  if (panel === '') return null;
  // A file name is text a person typed: it is only kept as a panel when it
  // carries none of the identity a document itself prints.
  if (hasTablePii(panel)) return null;
  return panel;
}

/** The laboratory, only when the document names itself. */
export function detectLabName(text: string): string | null {
  if (/quest\s+diagnostics/i.test(text)) return 'Quest Diagnostics';
  if (/laboratory\s+corporation|labcorp/i.test(text)) return 'LabCorp';
  if (/\bquest\b/i.test(text)) return 'Quest';
  return null;
}

/** How many Profiles/Tests entries a document lists. */
export function countOrderEntries(text: string): number {
  return text.split('\n').filter(line => /^\s*\d{2,6}\s*-\s+\S/.test(line)).length;
}

/**
 * Decide what a PDF is.
 *
 * `order` is a real, recognised outcome, not a failure: a requisition lists the
 * tests that were ordered and prints no values at all, so it can never produce a
 * result and must say so rather than import an empty set or raise an error.
 */
export function detectDocumentKind(
  text: string,
  layout: DocumentLayout
): { kind: LabDocumentKind; reason: string } {
  const hasResultsTable = layout.headers.length > 0 || /normal\s*range\s*:/i.test(text);
  const orderSignal = /profiles\s*\/\s*tests/i.test(text) || countOrderEntries(text) >= 3;

  if (hasResultsTable) {
    return { kind: 'results', reason: 'A results table with a date-header row was found.' };
  }
  if (orderSignal) {
    return {
      kind: 'order',
      reason: 'A Profiles/Tests list with no values and no reference intervals — an order form, not a result.',
    };
  }
  return {
    kind: 'unknown',
    reason: 'Neither a results table nor an order form was recognised.',
  };
}

// ── Blocks → observations ────────────────────────────────────────────────────

/** How the confidence score is built. Four fields, a quarter each. */
export const CONFIDENCE_FIELDS = 4;

export interface InterpretedDocument {
  observations: ExtractedObservation[];
  warnings: ExtractionWarning[];
  rejections: ExtractionRejection[];
}

/**
 * Turn the layout into observations, warnings and recorded refusals.
 *
 * One observation per value cell of every surviving block, each carrying the
 * date of the COLUMN it sits under.
 *
 * `options.panel` is the panel the DOCUMENT covers, when its own file name states
 * one (see `detectPanelFromFilename`): a trend document prints panel headings
 * nowhere in its text, so every row of it belongs to that one panel. A document
 * that prints its own headings does not go through here at all.
 */
export function interpretLayout(
  layout: DocumentLayout,
  columnsByPage: Map<number, { date: string | null; dateText: string }[]>,
  options: { panel?: string | null } = {}
): InterpretedDocument {
  const panel = options.panel ?? null;
  const observations: ExtractedObservation[] = [];
  const warnings: ExtractionWarning[] = [...layout.warnings];
  const rejections: ExtractionRejection[] = [];

  for (const line of layout.classified) {
    if (!line.reason) continue;
    rejections.push({ page: line.page, lineNo: line.lineNo, text: redact(line.text), reason: line.reason });
  }

  interface Candidate {
    observation: ExtractedObservation;
    page: number;
    y: number;
    x: number;
  }
  const candidates: Candidate[] = [];

  for (const block of layout.blocks) {
    const columns = columnsByPage.get(block.page);
    if (!columns || columns.length === 0) continue;
    const printedName = block.name.replace(/\s+/g, ' ').trim();
    if (!printedName) continue;

    const range = block.rangeText ? parseRangeText(block.rangeText) : null;
    if (block.rangeText && !range) {
      warnings.push({
        code: 'unparsable_range',
        message: `The reference interval printed for "${printedName}" ("${block.rangeText}") matched no known form, so it was left unread.`,
        page: block.page,
        line: block.lineNo,
      });
    }
    if (range && range.refLow !== null && range.refHigh !== null && range.refLow > range.refHigh) {
      warnings.push({
        code: 'interval_reversed',
        message: `The reference interval printed for "${printedName}" ("${range.refText}") has its lower bound above its upper bound, so it was kept as printed and flagged.`,
        page: block.page,
        line: block.lineNo,
      });
    }

    const sourceLine = redact(
      [printedName, range ? range.refText : block.rangeText, block.cells.map(cell => cell.text).join('  ')]
        .filter((part): part is string => Boolean(part))
        .join(' | ')
    );

    for (const cell of block.cells) {
      const column = cell.column === null ? null : columns[cell.column];
      const columnDate = column?.date ?? null;
      if (!columnDate) {
        warnings.push({
          code: 'unparsable_value',
          message: `A cell ("${cell.text}") sits in a column whose printed date could not be read, so it was not stored against an invented date.`,
          page: block.page,
          line: cell.lineNo,
        });
        continue;
      }
      const parsed = parseValueCell(cell.text);
      if (!parsed) {
        warnings.push({
          code: 'unparsable_value',
          message: `A cell ("${cell.text}") of "${printedName}" matched no known result form, so it was skipped rather than guessed.`,
          page: block.page,
          line: cell.lineNo,
        });
        continue;
      }
      // A DESCRIPTIVE analyte prints a word because there is no number to print
      // (COLOR, APPEARANCE). The row is kept as text and carries no warning: the
      // result is a description the report intended, not a value that went unread.
      const descriptiveRow = parsed.value === null && isDescriptiveAnalyte(printedName);
      if (parsed.value === null && !descriptiveRow) {
        warnings.push({
          code: 'non_numeric_result',
          message: `"${printedName}" printed a non-numeric result ("${parsed.valueText}") for one date; it is kept as printed and cannot be charted against a range.`,
          page: block.page,
          line: cell.lineNo,
        });
      }

      candidates.push({
        page: block.page,
        y: cell.y,
        x: cell.centre,
        observation: {
          lineNo: 0,
          analyteKey: analyteKeyFor(printedName),
          printedName,
          panel,
          resultOn: columnDate,
          value: parsed.value,
          valueText: parsed.valueText,
          unit: parsed.unit,
          refLow: range ? range.refLow : null,
          refHigh: range ? range.refHigh : null,
          refText: range ? range.refText : block.rangeText,
          refSource: range ? range.refSource : block.rangeText ? 'report' : 'none',
          refBasis: descriptiveRow ? descriptiveNote(parsed.valueText, null) : null,
          printedFlag: cell.flag ? parseFlag(cell.flag) : null,
          category: null,
          extractionMethod: 'deterministic',
          confidence: confidenceOf({
            name: printedName,
            hasValue: parsed.value !== null || parsed.valueText !== null,
            unit: parsed.unit,
            range: range ? range.refText : block.rangeText,
          }),
          sourceLine,
        },
      });
    }
  }

  candidates.sort((a, b) => (a.page - b.page) || (b.y - a.y) || (a.x - b.x));
  candidates.forEach((candidate, index) => {
    candidate.observation.lineNo = index + 1;
    observations.push(candidate.observation);
  });

  return { observations, warnings, rejections };
}

/**
 * A simple completeness score in [0,1]: a quarter for each of the printed name,
 * the value, the unit and the interval. NOT statistical and NOT clinical — it
 * says how much of the row was readable, nothing about the result.
 */
export function confidenceOf(parts: {
  name: string | null;
  hasValue: boolean;
  unit: string | null;
  range: string | null;
}): number {
  let score = 0;
  if (parts.name && parts.name.trim() !== '') score += 1 / CONFIDENCE_FIELDS;
  if (parts.hasValue) score += 1 / CONFIDENCE_FIELDS;
  if (parts.unit && parts.unit.trim() !== '') score += 1 / CONFIDENCE_FIELDS;
  if (parts.range && parts.range.trim() !== '') score += 1 / CONFIDENCE_FIELDS;
  return Math.round(score * 100) / 100;
}

/** Build the note a stored report carries for a document that is not results. */
export function noteForKind(kind: LabDocumentKind, reason: string): string | null {
  if (kind === 'results') return null;
  return reason;
}

/** Assemble the result object once the observations are known. */
export function assembleResult(input: {
  interpreted: InterpretedDocument;
  kind: LabDocumentKind;
  kindReason: string;
  documentDate: string | null;
  labName: string | null;
  pageCount: number;
  sourceSha256: string;
  sourceBytes: number;
  pass: ExtractionResult['pass'];
  /** True when the interpreted pass produced no observation at all. */
  observationsEmpty: boolean;
}): ExtractionResult {
  const warnings = [...input.interpreted.warnings];
  if (input.observationsEmpty && input.kind === 'results') {
    warnings.push({
      code: 'no_observations',
      message: 'A results table was found but no observation could be read from it.',
      page: null,
      line: null,
    });
  }
  if (!input.documentDate) {
    warnings.push({
      code: 'document_date_absent',
      message: 'No date the document itself was produced was printed anywhere, so none is stored.',
      page: null,
      line: null,
    });
  }
  if (!input.labName) {
    warnings.push({
      code: 'lab_name_absent',
      message: 'No laboratory named itself in the document text, so no lab name is stored.',
      page: null,
      line: null,
    });
  }
  return {
    parserVersion: PARSER_VERSION,
    kind: input.kind,
    pageCount: input.pageCount,
    documentDate: input.documentDate,
    labName: input.labName,
    pass: input.pass,
    observations: input.interpreted.observations,
    warnings,
    rejections: input.interpreted.rejections,
    sourceSha256: input.sourceSha256,
    sourceBytes: input.sourceBytes,
    notes: noteForKind(input.kind, input.kindReason),
  };
}
// ── Lab report types ─────────────────────────────────────────────────────────
//
// The shapes the lab pipeline shares: what a PDF is read into and what is stored
// for it. The stored shapes mirror db/migrations/0004-lab-reports.sql.
//
// THE MODEL, in one paragraph. A lab "Result Trends" document is a TREND MATRIX,
// not a single report: one table header carries several DATES AS COLUMNS and each
// analyte row holds one cell per date. One uploaded document therefore yields
// MANY observations per analyte, so every observation carries its own result
// date (`resultOn`) and never the document's date. Line-based reading cannot do
// this — values and flags are interleaved on the page — so the extractor reads
// PDF text WITH GEOMETRY and assigns each cell to a column by its x position.
//
// NOTHING HERE IS A JUDGEMENT. A field that could not be read is `null`, never 0
// and never a plausible guess: a unit, an interval and a date are only ever what
// the document printed. No high/low/optimal status is computed anywhere in this
// module, and `category` is left null until a later gate assigns one.
//
// Types only: no runtime code, so this module is safe to import from anywhere.

/** What the parser decided an uploaded PDF is. Mirrors the CHECK in 0004. */
export type LabDocumentKind =
  /** A results table: analytes with values and usually a printed interval. */
  | 'results'
  /** An order form: a Profiles/Tests list with no values. Yields no results. */
  | 'order'
  /** Neither: unreadable, a scan, or a layout we do not recognise. */
  | 'unknown';

/** Where a reference interval came from. Mirrors the column's CHECK in 0004. */
export type LabRefSource = 'report' | 'reference_table' | 'manual' | 'none';

/** Which pass produced a row. Mirrors the column's CHECK in 0004. */
export type LabExtractionMethod = 'deterministic' | 'model' | 'manual';

/** Which pass produced the observations of a document. */
export type LabExtractionPass = 'deterministic' | 'model' | 'none';

/**
 * A coarse grouping for an analyte, used to lay results out in the UI later.
 * Assigned by a later gate; the extractor leaves it null rather than guessing
 * one from a name.
 */
export type LabCategory =
  | 'chemistry'
  | 'hematology'
  | 'lipid'
  | 'thyroid'
  | 'hormone'
  | 'vitamin'
  | 'urine'
  | 'inflammatory'
  | 'cardiac'
  | 'other';

/** A report row as stored in `lab_reports`. Timestamps are ISO strings. */
export interface LabReport {
  id: string;
  /** What the parser decided this PDF is. */
  kind: LabDocumentKind;
  /** ISO date (YYYY-MM-DD) the document was produced, or null when none was printed. */
  documentDate: string | null;
  labName: string | null;
  sourceFilename: string;
  sourceSha256: string;
  sourceBytes: number;
  pageCount: number | null;
  /** `{ parserVersion, kind, pass, counts, warnings }` — bounded metadata, never the PDF. */
  extraction: Record<string, unknown>;
  notes: string | null;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** An analyte result as stored in `lab_results`. Timestamps are ISO strings. */
export interface LabResult {
  id: string;
  reportId: string;
  /** 1-based reading-order position of the observation. Unique per report. */
  lineNo: number;
  analyteKey: string;
  printedName: string;
  /** ISO date (YYYY-MM-DD) of the COLUMN this value belongs to. */
  resultOn: string;
  value: number | null;
  valueText: string | null;
  /** The unit EXACTLY as printed. No conversion at rest. */
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  /** The interval exactly as printed, e.g. ">40 mg/dL". */
  refText: string | null;
  refSource: LabRefSource;
  refBasis: string | null;
  printedFlag: string | null;
  category: LabCategory | null;
  extractionMethod: LabExtractionMethod;
  confidence: number | null;
  sourceLine: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * ONE OBSERVATION read out of a PDF, ready to be written as a `LabResult`.
 *
 * It carries everything `LabResult` carries except the columns the database
 * supplies (`id`, `reportId`, the timestamps), so storing a row is a copy and not
 * a transformation. `sourceLine` is the analyte row's own text — the extractor
 * redacts identity lines, so no name, date of birth, address, phone or SSN can
 * appear in it.
 */
export interface ExtractedObservation {
  /** 1-based reading-order position. Unique per document; see 0004. */
  lineNo: number;
  analyteKey: string;
  printedName: string;
  /** ISO date (YYYY-MM-DD) of the column this value belongs to. */
  resultOn: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  refSource: LabRefSource;
  refBasis: string | null;
  printedFlag: string | null;
  category: LabCategory | null;
  extractionMethod: LabExtractionMethod;
  /** Simple completeness score in [0,1]. NOT statistical, NOT clinical. */
  confidence: number | null;
  sourceLine: string | null;
}

/** Why the extractor raised a warning. */
export type ExtractionWarningCode =
  /** A page carried no extractable text at all — it is probably a scan. */
  | 'page_without_text'
  /** The document produced no observations at all. */
  | 'no_observations'
  /** No date-header row was found, so nothing could be aligned to a column. */
  | 'no_column_header'
  /** A result cell sat too far from every column centre to assign confidently. */
  | 'cell_out_of_columns'
  /** A result cell fell outside every analyte row's vertical band. */
  | 'cell_outside_block'
  /** A cell could not be parsed as a value in any known form. */
  | 'unparsable_value'
  /** A printed interval could not be read in any known form. */
  | 'unparsable_range'
  /** A printed interval had its lower bound above its upper bound. */
  | 'interval_reversed'
  /** A result is not a plain number, so it cannot be charted against a range. */
  | 'non_numeric_result'
  /** A flag token sat in a column that carried no value. */
  | 'flag_without_value'
  /** Two value cells landed in the same column of one analyte block. */
  | 'duplicate_cell_in_column'
  /** No document date was found anywhere. Nothing is invented to fill it. */
  | 'document_date_absent'
  /** No laboratory named itself in the document text. */
  | 'lab_name_absent'
  /** The deterministic pass found no complete analyte rows; a model pass was offered. */
  | 'deterministic_pass_empty'
  /** The optional model pass ran and some of its candidate rows failed validation. */
  | 'model_rows_dropped';

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  /** Shown to a reader: says what was seen, never a judgement about a value. */
  message: string;
  /** 1-based page the warning came from, when it came from one page. */
  page: number | null;
  /** 1-based reading-order line, when the warning came from one line. */
  line: number | null;
}

/** Why a line was refused as an analyte row. Every refusal records one. */
export type ExtractionRejectionReason =
  /** The date-header row itself ("Component  Mar 3, 2019  …"). */
  | 'column_header'
  /** The document's own title ("Result Trends"). */
  | 'document_title'
  /** A coverage/limitation notice ("Results limited to those after …"). */
  | 'notice_line'
  /** The table caption ("Mar 3, 2019 - Nov 2, 2021 (Table 1 of 1)"). */
  | 'table_caption'
  /** The patient identity line (carries a name, DOB, address or SSN). */
  | 'identity_line'
  /** The laboratory or provider letterhead. */
  | 'letterhead_line'
  /** A Profiles/Tests entry from an order form ("6399 - CBC … [BLOOD]"). */
  | 'order_entry'
  /** A row a person filled in rather than a result ("Fasting?  Yes  Yes  Yes"). */
  | 'non_metric_row'
  /** Neither a numeric value nor a printable qualitative result was present. */
  | 'no_result'
  /** A date, signature, page-number or footer line rather than a result row. */
  | 'not_a_result_line'
  /** A panel/section group label (ALL-CAPS, no value, no interval) — not an analyte. */
  | 'panel_header'
  /** Arrived before the date-header row, so it belongs to no table. */
  | 'outside_table_region'
  /** Blank once normalised. */
  | 'empty';

/** A line that was read and deliberately NOT turned into a row. */
export interface ExtractionRejection {
  /** 1-based page the line came from. */
  page: number;
  /** 1-based reading-order line number across the whole document. */
  lineNo: number;
  /** The line's own text, redacted: an identity line is replaced, never quoted. */
  text: string;
  reason: ExtractionRejectionReason;
}

/** Everything one PDF yielded: the observations, the dates, the lab and the caveats. */
export interface ExtractionResult {
  /** The parser's own version, stored with the report in `extraction`. */
  parserVersion: string;
  /** What the parser decided the document is. */
  kind: LabDocumentKind;
  /** Pages in the PDF. */
  pageCount: number;
  /** ISO date the document was produced, or null when nothing printed one. */
  documentDate: string | null;
  /** The lab, only when it named itself explicitly. Otherwise null. */
  labName: string | null;
  /** Which pass produced `observations`. */
  pass: LabExtractionPass;
  observations: ExtractedObservation[];
  warnings: ExtractionWarning[];
  rejections: ExtractionRejection[];
  /** SHA-256 of the bytes this was extracted from, lowercase hex. */
  sourceSha256: string;
  sourceBytes: number;
  /** A short human note about the document. Never identity data. */
  notes: string | null;
}
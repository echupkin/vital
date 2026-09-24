// ── Lab upload draft + commit validation (pure, server-side) ─────────────────
//
// The rules that decide whether an owner-reviewed payload may be written, kept
// out of the route handlers so they are testable without a request, a database
// or the filesystem.
//
// TWO DECISIONS WORTH STATING PLAINLY:
//
//   * AN ORDER FORM IS NOT AN IMPORT. A requisition lists tests that were
//     ordered; it has no values. Committing one is refused outright with a
//     message that says so, rather than writing a report with no observations.
//
//   * ALL OR NOTHING. The whole payload is validated before anything is written.
//     One malformed row rejects the entire import; there is no partial import,
//     because a silently short result set is worse than a refused one.

import type {
  ExtractedObservation,
  ExtractionResult,
  ExtractionWarning,
  LabDocumentKind,
  LabExtractionMethod,
  LabExtractionPass,
  LabRefSource,
  LabCategory,
} from './types';
import { MAX_PRINTED_FLAG_LENGTH } from './types';
import { resolveAnalyte } from './analytes';
import type { NewReportInput } from '@/lib/db/lab-store';

/** The draft returned by an upload. NOT persisted: the owner reviews it first. */
export interface LabDraft {
  kind: LabDocumentKind;
  documentDate: string | null;
  labName: string | null;
  filename: string;
  sha256: string;
  bytes: number;
  pageCount: number;
  pass: LabExtractionPass;
  /** The distinct result dates the document yielded, oldest first. */
  detectedDates: string[];
  /** The parsed observations, as the owner will review them. */
  rows: ExtractedObservation[];
  warnings: ExtractionWarning[];
  notes: string | null;
  /** Always false for a draft; the commit route is what persists. */
  persisted: false;
}

/** Build the reviewable draft from an extraction result. Pure. */
export function buildDraft(
  extraction: ExtractionResult,
  filename: string,
  sha256: string,
  bytes: number
): LabDraft {
  const dates = new Set<string>();
  for (const row of extraction.observations) dates.add(row.resultOn);
  return {
    kind: extraction.kind,
    documentDate: extraction.documentDate,
    labName: extraction.labName,
    filename,
    sha256,
    bytes,
    pageCount: extraction.pageCount,
    pass: extraction.pass,
    detectedDates: [...dates].sort(),
    rows: extraction.observations,
    warnings: extraction.warnings,
    notes: extraction.notes,
    persisted: false,
  };
}

/** One reviewed row as the client sends it back. */
export interface CommitRow {
  lineNo?: number;
  printedName?: string;
  analyteKey?: string;
  resultOn?: string;
  value?: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  refText?: string | null;
  refSource?: LabRefSource;
  refBasis?: string | null;
  printedFlag?: string | null;
  category?: LabCategory | null;
  extractionMethod?: LabExtractionMethod;
  confidence?: number | null;
  sourceLine?: string | null;
}

export interface CommitPayload {
  kind?: LabDocumentKind;
  documentDate?: string | null;
  labName?: string | null;
  sourceFilename?: string;
  sourceSha256?: string;
  sourceBytes?: number;
  pageCount?: number | null;
  extraction?: Record<string, unknown>;
  notes?: string | null;
  results?: CommitRow[];
}

export type CommitValidation =
  | { ok: true; report: NewReportInput; results: ExtractedObservation[] }
  | { ok: false; status: number; error: string };

const REF_SOURCES: readonly LabRefSource[] = ['report', 'reference_table', 'manual', 'none'];
const EXTRACTION_METHODS: readonly LabExtractionMethod[] = ['deterministic', 'model', 'manual'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrNull(value: unknown, max: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  return value.length > max ? undefined : value;
}

/**
 * Validate an owner-reviewed commit payload.
 *
 * Returns the report and rows to insert, or a status and a message. The status
 * distinguishes the caller's mistakes: 400 for a malformed payload, 409 for an
 * order form (a recognised document that simply is not an import), 422 for a
 * payload that is well-formed but incomplete.
 */
export function validateCommitPayload(body: unknown): CommitValidation {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'The request body must be a JSON object.' };
  }
  const payload = body as CommitPayload;

  if (payload.kind === 'order') {
    return {
      ok: false,
      status: 409,
      error:
        'This is a lab order, not results — nothing was imported. An order form lists tests that were requested and carries no values, so it has no observations to store.',
    };
  }
  if (payload.kind !== 'results') {
    return {
      ok: false,
      status: 400,
      error: `Only a results document can be committed; this payload is kind "${String(
        payload.kind ?? 'missing'
      )}".`,
    };
  }

  if (!isIsoDate(payload.documentDate)) {
    return {
      ok: false,
      status: 422,
      error:
        'The report needs its document date (YYYY-MM-DD). The document printed none, so supply one explicitly rather than leaving it to be invented.',
    };
  }

  if (typeof payload.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sourceSha256.trim().toLowerCase())) {
    return { ok: false, status: 400, error: 'sourceSha256 must be a 64-character lowercase hex SHA-256.' };
  }

  if (typeof payload.sourceFilename !== 'string' || payload.sourceFilename.trim().length === 0) {
    return { ok: false, status: 400, error: 'sourceFilename is required.' };
  }

  const sourceBytes = finiteOrNull(payload.sourceBytes);
  if (sourceBytes === undefined || sourceBytes === null || sourceBytes <= 0) {
    return { ok: false, status: 400, error: 'sourceBytes must be a positive number.' };
  }

  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return {
      ok: false,
      status: 422,
      error: 'A results document must carry at least one observation; nothing was imported.',
    };
  }

  const pageCount = finiteOrNull(payload.pageCount);
  if (pageCount === undefined) {
    return { ok: false, status: 400, error: 'pageCount must be a number or null.' };
  }

  const results: ExtractedObservation[] = [];
  const seenLineNos = new Set<number>();

  for (let index = 0; index < payload.results.length; index += 1) {
    const row = payload.results[index];
    const at = `results[${index}]`;
    if (!row || typeof row !== 'object') {
      return { ok: false, status: 400, error: `${at} must be an object.` };
    }

    const printedName = typeof row.printedName === 'string' ? row.printedName.trim() : '';
    if (printedName.length === 0) {
      return { ok: false, status: 400, error: `${at}.printedName is required and must not be empty.` };
    }

    if (!isIsoDate(row.resultOn)) {
      return {
        ok: false,
        status: 400,
        error: `${at}.resultOn must be a result date in YYYY-MM-DD form; every observation carries its own date.`,
      };
    }

    const value = finiteOrNull(row.value);
    if (value === undefined) {
      return { ok: false, status: 400, error: `${at}.value must be a finite number or null.` };
    }
    const valueText = stringOrNull(row.valueText, 64);
    if (valueText === undefined) {
      return { ok: false, status: 400, error: `${at}.valueText must be a string of at most 64 characters or null.` };
    }
    if (value === null && valueText === null) {
      return {
        ok: false,
        status: 400,
        error: `${at} carries neither a numeric value nor printed text; a result must say something.`,
      };
    }

    const unit = stringOrNull(row.unit, 40);
    if (unit === undefined) {
      return { ok: false, status: 400, error: `${at}.unit must be a string of at most 40 characters or null.` };
    }

    const refLow = finiteOrNull(row.refLow);
    const refHigh = finiteOrNull(row.refHigh);
    if (refLow === undefined || refHigh === undefined) {
      return { ok: false, status: 400, error: `${at}.refLow and ${at}.refHigh must be finite numbers or null.` };
    }

    const refText = stringOrNull(row.refText, 80);
    if (refText === undefined) {
      return { ok: false, status: 400, error: `${at}.refText must be a string of at most 80 characters or null.` };
    }

    const hasInterval = refLow !== null || refHigh !== null;
    const refSource: LabRefSource =
      row.refSource === undefined
        ? hasInterval
          ? 'report'
          : 'none'
        : row.refSource;
    if (!REF_SOURCES.includes(refSource)) {
      return { ok: false, status: 400, error: `${at}.refSource must be one of ${REF_SOURCES.join(', ')}.` };
    }

    const extractionMethod: LabExtractionMethod = row.extractionMethod ?? 'deterministic';
    if (!EXTRACTION_METHODS.includes(extractionMethod)) {
      return {
        ok: false,
        status: 400,
        error: `${at}.extractionMethod must be one of ${EXTRACTION_METHODS.join(', ')}.`,
      };
    }

    const confidence = finiteOrNull(row.confidence);
    if (confidence === undefined || (confidence !== null && (confidence < 0 || confidence > 1))) {
      return { ok: false, status: 400, error: `${at}.confidence must be a number in [0,1] or null.` };
    }

    const printedFlag = stringOrNull(row.printedFlag, MAX_PRINTED_FLAG_LENGTH);
    if (printedFlag === undefined) {
      return {
        ok: false,
        status: 400,
        error: `${at}.printedFlag must be a string of at most ${MAX_PRINTED_FLAG_LENGTH} characters or null.`,
      };
    }

    const sourceLine = stringOrNull(row.sourceLine, 200);
    if (sourceLine === undefined) {
      return { ok: false, status: 400, error: `${at}.sourceLine must be a string of at most 200 characters or null.` };
    }

    const resolvedKey =
      typeof row.analyteKey === 'string' && row.analyteKey.trim().length > 0
        ? row.analyteKey.trim()
        : resolveAnalyte(printedName).key;

    const lineNo =
      row.lineNo === undefined || row.lineNo === null
        ? index + 1
        : typeof row.lineNo === 'number' && Number.isInteger(row.lineNo) && row.lineNo > 0
          ? row.lineNo
          : null;
    if (lineNo === null) {
      return { ok: false, status: 400, error: `${at}.lineNo must be a positive integer.` };
    }
    if (seenLineNos.has(lineNo)) {
      return { ok: false, status: 400, error: `${at}.lineNo ${lineNo} is used twice; reading positions must be unique.` };
    }
    seenLineNos.add(lineNo);

    results.push({
      lineNo,
      analyteKey: resolvedKey,
      printedName,
      resultOn: row.resultOn,
      value,
      valueText,
      unit,
      refLow,
      refHigh,
      refText,
      refSource,
      refBasis: typeof row.refBasis === 'string' ? row.refBasis : null,
      printedFlag,
      category: (row.category as LabCategory | null) ?? null,
      extractionMethod,
      confidence,
      sourceLine,
    });
  }

  const report: NewReportInput = {
    kind: 'results',
    documentDate: payload.documentDate,
    labName: typeof payload.labName === 'string' ? payload.labName : null,
    sourceFilename: payload.sourceFilename,
    sourceSha256: payload.sourceSha256.trim().toLowerCase(),
    sourceBytes,
    pageCount,
    extraction: payload.extraction && typeof payload.extraction === 'object' ? payload.extraction : {},
    notes: typeof payload.notes === 'string' ? payload.notes : null,
  };

  return { ok: true, report, results };
}

/** True when the bytes start with the PDF magic number (%PDF-). */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}
// ── Lab upload: the review-before-commit rules (pure, client-safe) ────────────
//
// The decisions an upload turns into an honest screen — and, once the owner has
// read it, the JSON body that goes to `/api/lab/reports/commit` — live here as
// pure functions, so they can be tested without a browser, a DOM or a network.
// The route's own validation (`@/lib/lab/commit`) is the authority on what may be
// STORED; this module decides what may be SENT and what the reader is told before
// anything is.
//
// FOUR DECISIONS WORTH STATING PLAINLY:
//
//   * A DOCUMENT DATE IS NEVER INVENTED. When the parser found none the field is
//     empty and the commit is refused until the owner supplies one; there is no
//     fallback to today, to the file's mtime or to a result's own date.
//
//   * AN ORDER FORM IS A DEAD END, NOT AN IMPORT. It is recognised and shown as
//     such. There is no commit payload for it at all, which is why the review UI
//     renders no commit button for one.
//
//   * A SCAN IS REPORTED, NOT GUESSED AT. A page with no text layer yields an
//     `unknown` document with a `page_without_text` warning; that is a distinct
//     message ("OCR is not implemented"), not a silent empty result.
//
//   * EXCLUDED ROWS ARE NEVER SENT. Not "sent and ignored" — absent from the
//     payload the route receives.
//
// This module imports no server code: `@/lib/lab/types` is types only,
// `analytes.ts` is data only, `status.ts` is pure, and `commit.ts` is imported
// for its TYPES only (erased at compile time).

import type {
  ExtractionWarning,
  LabCategory,
  LabExtractionMethod,
  LabRefSource,
} from './types';
import type { LabDraft, CommitPayload, CommitRow } from './commit';
import { ANALYTES, analyteByKey } from './analytes';
import { bandForObservation, scoreResult, type ResolvedInterval, type ResultStatus, type StatusTone } from './status';
import { DEFAULT_LAB_MAX_BYTES } from './config';

// ── The editable review row ─────────────────────────────────────────────────

/**
 * One draft row as the owner edits it. Numeric fields are held as TEXT so a
 * half-typed value is representable; they are parsed on the way out
 * (`toCommitRow`) and never coerced to a number while the reader is typing.
 */
export interface ReviewRow {
  lineNo: number;
  /** Whether the row is committed. Excluded rows are never sent. */
  include: boolean;
  printedName: string;
  analyteKey: string;
  resultOn: string;
  /** Numeric value as text, or `''` when there is none. */
  value: string;
  /** The printed string whenever the result is not a plain number. */
  valueText: string;
  unit: string;
  refLow: string;
  refHigh: string;
  /** The interval exactly as printed, e.g. ">40 mg/dL". */
  refText: string;
  refSource: LabRefSource;
  printedFlag: string | null;
  category: LabCategory | null;
  extractionMethod: LabExtractionMethod;
  confidence: number | null;
  /** The analyte row's own text. Already redacted by the extractor. */
  sourceLine: string | null;
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : value;
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Turn the draft the API returned into editable rows; everything is included. */
export function rowsFromDraft(draft: LabDraft): ReviewRow[] {
  return draft.rows.map(row => ({
    lineNo: row.lineNo,
    include: true,
    printedName: row.printedName,
    analyteKey: row.analyteKey,
    resultOn: row.resultOn,
    value: numberText(row.value),
    valueText: text(row.valueText),
    unit: text(row.unit),
    refLow: numberText(row.refLow),
    refHigh: numberText(row.refHigh),
    refText: text(row.refText),
    refSource: row.refSource,
    printedFlag: row.printedFlag,
    category: row.category,
    extractionMethod: row.extractionMethod,
    confidence: row.confidence,
    sourceLine: row.sourceLine,
  }));
}

/** Parse a text field as a finite number, or null. `''` and junk are null. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a text field as trimmed text, or null when blank. */
export function parseText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ── The analyte registry, as a select ───────────────────────────────────────

/** Every registered analyte as an option, sorted by display name. */
export function analyteOptions(): { value: string; label: string }[] {
  return [...ANALYTES]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(analyte => ({ value: analyte.key, label: `${analyte.displayName} · ${analyte.key}` }));
}

/** The display name for a key: the registry's, or the key itself. */
export function displayNameForKey(analyteKey: string): string {
  return analyteByKey(analyteKey)?.displayName ?? analyteKey;
}

// ── Status, computed from the row as it stands ──────────────────────────────

export interface ReviewProfile {
  dateOfBirth: string | null;
  sex: 'male' | 'female' | null;
}

export interface RowStatus {
  status: ResultStatus;
  /** The human label. Never colour, never a verdict word. */
  label: string;
  tone: StatusTone;
  interval: ResolvedInterval;
  /** A short label for where the interval came from, for the source badge. */
  sourceLabel: string;
  notes: string[];
  /** Why a fallback band could not be chosen, when one could not. */
  bandReason: 'no_bands' | 'sex_unset' | 'age_unknown' | 'no_band_for_age_sex' | null;
  /** A warning about the row itself, or null. */
  warning: string | null;
}

/** Where an interval came from, in the reader's words. */
export function intervalSourceLabel(origin: ResolvedInterval['origin']): string {
  switch (origin) {
    case 'report':
      return 'Printed on report';
    case 'reference_table':
      return 'General reference interval';
    case 'manual':
      return 'Entered manually';
    case 'none':
      return 'None';
  }
}

function warningForRow(row: ReviewRow, bandReason: RowStatus['bandReason']): string | null {
  if (!row.include) return null;
  if (row.value.trim() === '' && row.valueText.trim() === '') {
    return 'This row carries neither a numeric value nor printed text, so it cannot be committed. Give it a value or exclude it.';
  }
  if (!analyteByKey(row.analyteKey)) {
    return 'This analyte is not in the reference registry, so no fallback band exists for it. It is shown with whatever interval the report printed.';
  }
  if (bandReason === 'sex_unset') {
    return 'The only reference bands for this analyte are sex-specific and the profile has no sex set, so the result is left unscored rather than banded by an assumption. Set Sex in Settings → Account to score it.';
  }
  if (bandReason === 'age_unknown') {
    return 'The reference bands for this analyte depend on age and the profile has no date of birth, so the result is left unscored rather than banded by an assumption.';
  }
  return null;
}

/**
 * Score one row against its printed interval or the registry fallback band.
 * PURE, and the same engine the server uses, so the review screen and the stored
 * series cannot disagree about a verdict.
 */
export function statusForRow(row: ReviewRow, profile: ReviewProfile): RowStatus {
  const registered = analyteByKey(row.analyteKey);
  const selection = registered
    ? bandForObservation(registered.bands, profile, row.resultOn)
    : { band: null, reason: 'no_bands' as const };

  const scored = scoreResult({
    value: parseNumber(row.value),
    valueText: parseText(row.valueText),
    refLow: parseNumber(row.refLow),
    refHigh: parseNumber(row.refHigh),
    printedFlag: row.printedFlag,
    band: selection.band,
  });

  return {
    status: scored.status,
    label: scored.label,
    tone: scored.tone,
    interval: scored.interval,
    sourceLabel: intervalSourceLabel(scored.interval.origin),
    notes: scored.notes,
    bandReason: selection.reason,
    warning: warningForRow(row, selection.reason),
  };
}

// ── Build the commit payload ────────────────────────────────────────────────

/** One review row → the row shape the commit route accepts. */
export function toCommitRow(row: ReviewRow): CommitRow {
  return {
    lineNo: row.lineNo,
    printedName: row.printedName.trim(),
    analyteKey: row.analyteKey,
    resultOn: row.resultOn,
    value: parseNumber(row.value),
    valueText: parseText(row.valueText),
    unit: parseText(row.unit),
    refLow: parseNumber(row.refLow),
    refHigh: parseNumber(row.refHigh),
    refText: parseText(row.refText),
    refSource: row.refSource,
    refBasis: null,
    printedFlag: row.printedFlag,
    category: row.category,
    extractionMethod: row.extractionMethod,
    confidence: row.confidence,
    sourceLine: row.sourceLine,
  };
}

/**
 * Build the commit body from the draft and the owner's edits.
 *
 * EXCLUDED ROWS ARE OMITTED ENTIRELY. The document date is taken verbatim from
 * the argument, never from the draft and never from a result's own date.
 */
export function buildCommitPayload(
  draft: LabDraft,
  rows: ReviewRow[],
  documentDate: string | null
): CommitPayload {
  return {
    kind: draft.kind,
    documentDate: documentDate ?? null,
    labName: draft.labName,
    sourceFilename: draft.filename,
    sourceSha256: draft.sha256,
    sourceBytes: draft.bytes,
    pageCount: draft.pageCount,
    extraction: {
      pass: draft.pass,
      warnings: draft.warnings,
      notes: draft.notes,
    },
    notes: draft.notes,
    results: rows.filter(row => row.include).map(toCommitRow),
  };
}

// ── Validate the review before sending ──────────────────────────────────────

/** The date form a document date must take. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Which control the UI should mark, when a review is refused. */
export type ReviewErrorField = 'document-date' | 'rows';

export type ReviewValidation =
  | { ok: true; payload: CommitPayload; includedCount: number }
  | { ok: false; field: ReviewErrorField; error: string };

/**
 * Validate an owner-reviewed screen before the commit body is sent.
 *
 * The rules mirror the route's own (`validateCommitPayload`) so a refusal is
 * shown as a specific field, not as a raw 400 after a round trip. An order form
 * never reaches here: the UI offers no commit button for one.
 */
export function validateReview(
  draft: LabDraft,
  rows: ReviewRow[],
  documentDate: string | null
): ReviewValidation {
  if (!isIsoDate(documentDate)) {
    return {
      ok: false,
      field: 'document-date',
      error:
        'A document date is required. The document printed none, so enter the date the report was produced — it is never guessed from the file or from a result.',
    };
  }

  const included = rows.filter(row => row.include);
  if (included.length === 0) {
    return {
      ok: false,
      field: 'rows',
      error: 'Every row is excluded, so there is nothing to import. Include at least one observation.',
    };
  }

  for (const row of included) {
    if (row.printedName.trim() === '') {
      return {
        ok: false,
        field: 'rows',
        error: `Row ${row.lineNo}: the printed name is required.`,
      };
    }
    if (!isIsoDate(row.resultOn)) {
      return {
        ok: false,
        field: 'rows',
        error: `Row ${row.lineNo}: the result date must be a real date in YYYY-MM-DD form.`,
      };
    }
    if (parseNumber(row.value) === null && parseText(row.valueText) === null) {
      return {
        ok: false,
        field: 'rows',
        error: `Row ${row.lineNo}: give it a value or printed text, or exclude it — a result must say something.`,
      };
    }
  }

  return { ok: true, payload: buildCommitPayload(draft, rows, documentDate), includedCount: included.length };
}

// ── Client-side file checks (mirror the route's) ────────────────────────────

export type UploadProblemCode =
  | 'not_pdf'
  | 'too_large'
  | 'empty'
  | 'scan'
  | 'order_form'
  | 'unreadable'
  | 'duplicate'
  | 'network'
  | 'unknown';

export interface UploadProblem {
  code: UploadProblemCode;
  /** The sentence shown to the reader. Says what was seen, never a guess. */
  message: string;
  /** True when the reader could pick another file and it is worth retrying. */
  retryable: boolean;
}

/** The largest accepted upload; the default when the server has not told us. */
export const FALLBACK_MAX_BYTES = DEFAULT_LAB_MAX_BYTES;

/** A short human size, e.g. "15 MB". Exported so the UI and the copy agree. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * Check a chosen file BEFORE the upload, mirroring the route's own checks so a
 * doomed upload is refused in the browser with the same reason.
 */
export function checkUploadFile(
  file: { name: string; type?: string | null; size: number },
  maxBytes: number = FALLBACK_MAX_BYTES
): UploadProblem | null {
  const looksPdf =
    (file.type ?? '').toLowerCase() === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf');
  if (!looksPdf) {
    return {
      code: 'not_pdf',
      message: `"${file.name}" is not a PDF. Only a PDF lab report can be read here.`,
      retryable: true,
    };
  }
  if (file.size === 0) {
    return { code: 'empty', message: 'That file is empty, so there is nothing to read.', retryable: true };
  }
  if (file.size > maxBytes) {
    return {
      code: 'too_large',
      message: `That file is ${formatBytes(file.size)}, larger than the ${formatBytes(
        maxBytes
      )} limit. Raise VITAL_LAB_MAX_BYTES to accept it.`,
      retryable: true,
    };
  }
  return null;
}

// ── Reading the upload response ─────────────────────────────────────────────

/** The draft, once the server accepted the upload. */
export interface UploadAccepted {
  outcome: 'review';
  draft: LabDraft;
}

/** The response was a problem, with the sentence to show. */
export interface UploadRefused {
  outcome: 'problem';
  problem: UploadProblem;
}

export type UploadOutcome = UploadAccepted | UploadRefused;

interface UploadResponseBody {
  draft?: LabDraft;
  duplicate?: boolean;
  message?: string;
  error?: string;
}

/**
 * Decide what the upload response means, from the payload and the status code.
 *
 * The document's KIND decides the outcome, not just the status code: an order
 * form and a scan both arrive as 201 with a draft, and they are two very
 * different answers — "nothing can be imported" versus "OCR is not implemented".
 */
export function evaluateUploadResponse(status: number, body: unknown): UploadOutcome {
  const payload = (body ?? {}) as UploadResponseBody;

  if (payload.draft) {
    const draft = payload.draft;
    if (draft.kind === 'order') {
      return {
        outcome: 'problem',
        problem: {
          code: 'order_form',
          message:
            'This is a lab order, not results — nothing can be imported. An order form lists tests that were requested and carries no values.',
          retryable: false,
        },
      };
    }
    if (draft.kind === 'unknown') {
      const scan = draft.warnings.some((warning: ExtractionWarning) => warning.code === 'page_without_text');
      if (scan) {
        return {
          outcome: 'problem',
          problem: {
            code: 'scan',
            message:
              'This document has no text layer, so it looks like a scan; OCR is not implemented, so nothing can be read from it.',
            retryable: true,
          },
        };
      }
      // An `unknown` document with readable text is a LAYOUT we do not support,
      // not a broken file. Say what was actually read, and never imply the file
      // is corrupt. The retry hint the screen appends carries the "nothing was
      // imported" sentence, so this message does not repeat it.
      const pages =
        draft.pageCount > 0 ? `${draft.pageCount} page${draft.pageCount === 1 ? '' : 's'}` : 'an unreadable page count';
      const lab = draft.labName ? ` from ${draft.labName}` : '';
      return {
        outcome: 'problem',
        problem: {
          code: 'unreadable',
          message:
            `This looks like a lab report${lab}, and ${pages} of readable text were found in it, but its layout is not one this importer supports yet — so no result table could be read and no row was guessed at. Please send this document to the maintainer so its layout can be added.`,
          retryable: true,
        },
      };
    }
    return { outcome: 'review', draft };
  }

  if (payload.duplicate) {
    return {
      outcome: 'problem',
      problem: {
        code: 'duplicate',
        message:
          payload.message ??
          'This exact document is already imported (its SHA-256 matches a stored report), so it was not imported twice.',
        retryable: false,
      },
    };
  }

  if (status === 415) {
    return {
      outcome: 'problem',
      problem: {
        code: 'not_pdf',
        message: payload.error ?? 'The uploaded file is not a PDF (it does not start with %PDF-).',
        retryable: true,
      },
    };
  }
  if (status === 413) {
    return {
      outcome: 'problem',
      problem: { code: 'too_large', message: payload.error ?? 'The uploaded file is larger than the limit.', retryable: true },
    };
  }
  if (status === 400 || status === 422) {
    return {
      outcome: 'problem',
      problem: {
        code: 'unreadable',
        message: payload.error ?? 'That document could not be read. Nothing was imported.',
        retryable: true,
      },
    };
  }
  if (status >= 500) {
    return {
      outcome: 'problem',
      problem: {
        code: 'unreadable',
        message:
          payload.error ??
          'The server could not read that document. Nothing was imported; try another PDF.',
        retryable: true,
      },
    };
  }
  return {
    outcome: 'problem',
    problem: {
      code: 'unknown',
      message: payload.error ?? `The upload was refused (HTTP ${status}).`,
      retryable: true,
    },
  };
}

// ── What a successful commit reports ────────────────────────────────────────

/** The counts a commit response actually stored, for the success line. */
export interface CommitSummary {
  /** How many documents the import touched. 1 for a single upload. */
  documents: number;
  observations: number;
  analytes: number;
  /** The earliest result date stored, or null. */
  firstOn: string | null;
  lastOn: string | null;
}

/**
 * Summarise a commit response from the API's OWN numbers — never a hardcoded
 * string. Returns null when the payload does not carry a report, so the caller
 * can say the import succeeded without inventing counts.
 */
export function summariseCommit(body: unknown): CommitSummary | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as { report?: { resultCount?: unknown }; results?: unknown };
  const report = payload.report;
  if (!report || !Array.isArray(payload.results)) return null;

  const results = payload.results as Array<{ resultOn?: unknown; analyteKey?: unknown }>;
  const dates = results
    .map(row => (typeof row.resultOn === 'string' ? row.resultOn : null))
    .filter((on): on is string => on !== null)
    .sort();
  const analytes = new Set(
    results.map(row => (typeof row.analyteKey === 'string' ? row.analyteKey : null)).filter(Boolean)
  );

  return {
    documents: 1,
    observations: results.length,
    analytes: analytes.size,
    firstOn: dates[0] ?? null,
    lastOn: dates[dates.length - 1] ?? null,
  };
}

/** The date range as one string, honest about missing ends. */
export function formatDateRange(firstOn: string | null, lastOn: string | null): string {
  if (firstOn && lastOn) return firstOn === lastOn ? firstOn : `${firstOn} to ${lastOn}`;
  if (firstOn) return `from ${firstOn}`;
  if (lastOn) return `through ${lastOn}`;
  return 'no dated results';
}
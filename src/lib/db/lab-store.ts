// ── Lab report store: Postgres (SERVER ONLY) ─────────────────────────────────
//
// The database half of the lab module. Every function takes its `client` as a
// parameter — the pool in production, an injected fake in the offline tests —
// so the SQL and the row mapping can be exercised without a live database (see
// lab-store.test.ts). This mirrors the convention of `analyst-store.ts`.
//
// WHAT IS STORED. One uploaded lab PDF (lab_reports) and its observations
// (lab_results). The parser redacts identity lines before a row exists, and
// `insertReport` ASSERTS that guarantee before writing: a `source_line` that
// carries identity, contact or provider data (or the redaction marker itself)
// is refused outright. That is the one backstop against a parser regression.
//
// ONE TRANSACTION PER WRITE. A report and all of its observations are written
// together or not at all: a half-imported document would look like a real
// result set with silently missing analytes.
//
// THE COLLISION RULE. Two observations sharing (`analyte_key`, `result_on`) are
// BOTH kept — different assays and different labs legitimately produce the same
// analyte on the same day. The series read model returns them as separate points
// and reports a `collisions` count so the UI can say so; it never silently picks
// one.

import type { ExtractedObservation, LabReport, LabResult } from '@/lib/lab/types';
import { redact } from '@/lib/lab/extract/parse';
import {
  analyteByKey,
  displayNameFor,
  resolveAnalyte,
  type AnalyteCategory,
} from '@/lib/lab/analytes';
import {
  bandForObservation,
  scoreResult,
  type ResultStatus,
  type StatusTone,
  type ResolvedInterval,
} from '@/lib/lab/status';
import { getPool, type PoolLike } from './pool';

/** A connection (or pool) that can run one query. */
export type SqlClient = PoolLike;

/** The version of the APPLICATION RECORD SHAPE stored in these tables. */
export const LAB_SCHEMA_VERSION = 1;

const REPORT_COLUMNS = `
  id, kind,
  to_char(document_date, 'YYYY-MM-DD') AS document_date,
  lab_name, source_filename, source_sha256, source_bytes, page_count,
  extraction, notes, schema_version, revision, created_at, updated_at
`;

const RESULT_COLUMNS = `
  id, report_id, line_no, analyte_key, printed_name,
  to_char(result_on, 'YYYY-MM-DD') AS result_on,
  value, value_text, unit, ref_low, ref_high, ref_text, ref_source, ref_basis,
  printed_flag, category, extraction_method, confidence, source_line,
  revision, created_at, updated_at
`;

const INSERT_REPORT = `
  INSERT INTO lab_reports
    (kind, document_date, lab_name, source_filename, source_sha256, source_bytes,
     page_count, extraction, notes, schema_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
  RETURNING ${REPORT_COLUMNS}
`;

const INSERT_RESULT = `
  INSERT INTO lab_results
    (report_id, line_no, analyte_key, printed_name, result_on, value, value_text,
     unit, ref_low, ref_high, ref_text, ref_source, ref_basis, printed_flag,
     category, extraction_method, confidence, source_line)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  RETURNING ${RESULT_COLUMNS}
`;

const SELECT_REPORTS = `
  SELECT r.id, r.kind,
         to_char(r.document_date, 'YYYY-MM-DD') AS document_date,
         r.lab_name, r.source_filename, r.source_sha256, r.source_bytes, r.page_count,
         r.extraction, r.notes, r.schema_version, r.revision, r.created_at, r.updated_at,
         count(l.id)::int AS result_count,
         count(DISTINCT l.analyte_key)::int AS analyte_count,
         count(DISTINCT l.result_on)::int AS date_count,
         to_char(min(l.result_on), 'YYYY-MM-DD') AS first_result_on,
         to_char(max(l.result_on), 'YYYY-MM-DD') AS last_result_on
    FROM lab_reports r
    LEFT JOIN lab_results l ON l.report_id = r.id
   GROUP BY r.id
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT $1
`;

const SELECT_REPORT = `
  SELECT ${REPORT_COLUMNS}
    FROM lab_reports
   WHERE id = $1
`;

const SELECT_REPORT_BY_SHA = `
  SELECT ${REPORT_COLUMNS}
    FROM lab_reports
   WHERE source_sha256 = $1
`;

const SELECT_RESULTS = `
  SELECT ${RESULT_COLUMNS}
    FROM lab_results
   WHERE report_id = $1
   ORDER BY line_no ASC
`;

const SELECT_ALL_RESULTS = `
  SELECT ${RESULT_COLUMNS}
    FROM lab_results
   ORDER BY analyte_key ASC, result_on ASC, line_no ASC
`;

const DELETE_REPORT = `DELETE FROM lab_reports WHERE id = $1 RETURNING id`;

const DELETE_RESULTS = `DELETE FROM lab_results WHERE report_id = $1 RETURNING id`;

const BUMP_REPORT_REVISION = `
  UPDATE lab_reports
     SET revision = revision + 1,
         updated_at = now()
   WHERE id = $1
  RETURNING ${REPORT_COLUMNS}
`;

const UPDATE_RESULT = `
  UPDATE lab_results
     SET value             = $2,
         value_text        = $3,
         unit              = $4,
         ref_low           = $5,
         ref_high          = $6,
         ref_text          = $7,
         ref_source        = $8,
         ref_basis         = $9,
         printed_name      = COALESCE($10, printed_name),
         analyte_key       = COALESCE($11, analyte_key),
         extraction_method = 'manual',
         revision          = revision + 1,
         updated_at        = now()
   WHERE id = $1
   RETURNING ${RESULT_COLUMNS}
`;

// ── Row mapping ─────────────────────────────────────────────────────────────

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function jsonOrEmpty(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** A database row → the stored report shape. Never throws. */
export function toLabReport(row: Record<string, unknown>): LabReport {
  return {
    id: String(row.id),
    kind: (row.kind as LabReport['kind']) ?? 'unknown',
    documentDate: stringOrNull(row.document_date),
    labName: stringOrNull(row.lab_name),
    sourceFilename: typeof row.source_filename === 'string' ? row.source_filename : '',
    sourceSha256: typeof row.source_sha256 === 'string' ? row.source_sha256 : '',
    sourceBytes: numberOrZero(row.source_bytes),
    pageCount: numberOrNull(row.page_count),
    extraction: jsonOrEmpty(row.extraction),
    notes: stringOrNull(row.notes),
    schemaVersion: numberOrZero(row.schema_version) || LAB_SCHEMA_VERSION,
    revision: numberOrZero(row.revision) || 1,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** A database row → the stored observation shape. Never throws. */
export function toLabResult(row: Record<string, unknown>): LabResult {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    lineNo: numberOrZero(row.line_no),
    analyteKey: typeof row.analyte_key === 'string' ? row.analyte_key : 'unknown',
    printedName: typeof row.printed_name === 'string' ? row.printed_name : '',
    resultOn: typeof row.result_on === 'string' ? row.result_on : '',
    value: numberOrNull(row.value),
    valueText: stringOrNull(row.value_text),
    unit: stringOrNull(row.unit),
    refLow: numberOrNull(row.ref_low),
    refHigh: numberOrNull(row.ref_high),
    refText: stringOrNull(row.ref_text),
    refSource: (row.ref_source as LabResult['refSource']) ?? 'none',
    refBasis: stringOrNull(row.ref_basis),
    printedFlag: stringOrNull(row.printed_flag),
    category: (row.category as LabResult['category']) ?? null,
    extractionMethod: (row.extraction_method as LabResult['extractionMethod']) ?? 'deterministic',
    confidence: numberOrNull(row.confidence),
    sourceLine: stringOrNull(row.source_line),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** A row's revision, which `LabResult` does not carry. Exposed to the reader. */
export function resultRevision(row: Record<string, unknown>): number {
  return numberOrZero(row.revision) || 1;
}

// ── PII assertion ───────────────────────────────────────────────────────────

/**
 * Refuse a batch whose `source_line` is not already in redacted form.
 *
 * The extractor redacts every row's line before it can become an observation
 * (`redact(line) === line` is therefore the invariant), so a line that the
 * redactor would still change means the parser regressed and the write is
 * stopped rather than persisting a leak. The redaction marker itself is
 * accepted: it carries no data.
 */
export function assertNoPii(rows: Array<{ sourceLine?: string | null; printedName?: string | null }>): void {
  for (const row of rows) {
    const line = row.sourceLine ?? '';
    if (line === '') continue;
    if (redact(line) !== line) {
      throw new Error(
        'Refusing to store an observation whose source line is not in redacted form. The extractor must redact identity, contact and provider details before a row exists.'
      );
    }
  }
}

// ── Transactions ────────────────────────────────────────────────────────────

interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release?: () => void;
}

interface ConnectablePool extends PoolLike {
  connect: () => Promise<TxClient>;
}

function isConnectable(client: PoolLike): client is ConnectablePool {
  return typeof (client as { connect?: unknown }).connect === 'function';
}

/**
 * Run `fn` inside one transaction.
 *
 * A pool has to hand out a single connection for the whole transaction, so the
 * BEGIN/COMMIT/ROLLBACK run on that one client. The offline tests inject a fake
 * that has no `connect`, in which case the statements run on the fake itself —
 * the fake records the BEGIN and COMMIT so the transaction can still be
 * asserted.
 */
export async function withTransaction<T>(client: SqlClient, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  const tx: SqlClient = isConnectable(client) ? await connectAndBegin(client) : client;
  if (!isConnectable(client)) await tx.query('BEGIN');
  try {
    const result = await fn(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    if (isConnectable(client) && typeof (tx as TxClient).release === 'function') {
      (tx as TxClient).release?.();
    }
  }
}

async function connectAndBegin(pool: ConnectablePool): Promise<SqlClient> {
  const client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

// ── Write path ──────────────────────────────────────────────────────────────

/** The report fields a caller supplies; the database owns id and timestamps. */
export interface NewReportInput {
  kind: LabReport['kind'];
  documentDate: string | null;
  labName: string | null;
  sourceFilename: string;
  sourceSha256: string;
  sourceBytes: number;
  pageCount: number | null;
  extraction: Record<string, unknown>;
  notes: string | null;
  schemaVersion?: number;
}

/** One observation to write. A copy of `ExtractedObservation`, plus nothing. */
export type NewObservationInput = ExtractedObservation;

export interface StoredReport {
  report: LabReport;
  results: LabResult[];
}

/**
 * Insert a report and its observations in ONE transaction.
 *
 * Nothing partial is ever written: a failure rolls the whole document back.
 */
export async function insertReport(
  client: SqlClient,
  report: NewReportInput,
  results: NewObservationInput[]
): Promise<StoredReport> {
  assertNoPii(results);
  return withTransaction(client, async tx => {
    const inserted = await tx.query(INSERT_REPORT, [
      report.kind,
      report.documentDate,
      report.labName,
      report.sourceFilename,
      report.sourceSha256,
      report.sourceBytes,
      report.pageCount,
      JSON.stringify(report.extraction ?? {}),
      report.notes,
      report.schemaVersion ?? LAB_SCHEMA_VERSION,
    ]);
    const reportRow = inserted.rows[0];
    if (!reportRow) throw new Error('The report insert returned no row.');
    const stored = toLabReport(reportRow);

    const storedResults: LabResult[] = [];
    for (const observation of results) {
      const row = await insertObservation(tx, stored.id, observation);
      storedResults.push(row);
    }
    return { report: stored, results: storedResults };
  });
}

async function insertObservation(
  tx: SqlClient,
  reportId: string,
  observation: NewObservationInput
): Promise<LabResult> {
  const inserted = await tx.query(INSERT_RESULT, [
    reportId,
    observation.lineNo,
    observation.analyteKey,
    observation.printedName,
    observation.resultOn,
    observation.value,
    observation.valueText,
    observation.unit,
    observation.refLow,
    observation.refHigh,
    observation.refText,
    observation.refSource,
    observation.refBasis,
    observation.printedFlag,
    observation.category,
    observation.extractionMethod,
    observation.confidence,
    observation.sourceLine,
  ]);
  const row = inserted.rows[0];
  if (!row) throw new Error('The observation insert returned no row.');
  return toLabResult(row);
}

/**
 * Replace a report's observations with a fresh parse, in ONE transaction.
 * This is how a parser improvement is applied to an already-stored document.
 */
export async function replaceResults(
  client: SqlClient,
  reportId: string,
  results: NewObservationInput[]
): Promise<LabResult[]> {
  assertNoPii(results);
  return withTransaction(client, async tx => {
    await tx.query(DELETE_RESULTS, [reportId]);
    const stored: LabResult[] = [];
    for (const observation of results) {
      stored.push(await insertObservation(tx, reportId, observation));
    }
    await tx.query(BUMP_REPORT_REVISION, [reportId]);
    return stored;
  });
}

/**
 * A manual correction to one observation.
 *
 * Sets `extraction_method = 'manual'` and bumps the row's `revision`; the caller
 * cannot opt out of either, so a corrected row is always distinguishable from a
 * parsed one. Returns null when there is no such row.
 */
export interface ResultPatch {
  value?: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  refText?: string | null;
  refSource?: LabResult['refSource'];
  refBasis?: string | null;
  printedName?: string | null;
  analyteKey?: string | null;
}

export async function updateResult(
  client: SqlClient,
  id: string,
  patch: ResultPatch
): Promise<LabResult | null> {
  const result = await client.query(UPDATE_RESULT, [
    id,
    patch.value ?? null,
    patch.valueText ?? null,
    patch.unit ?? null,
    patch.refLow ?? null,
    patch.refHigh ?? null,
    patch.refText ?? null,
    patch.refSource ?? 'manual',
    patch.refBasis ?? null,
    patch.printedName ?? null,
    patch.analyteKey ?? null,
  ]);
  const row = result.rows[0];
  return row ? toLabResult(row) : null;
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface ReportSummary extends LabReport {
  resultCount: number;
  analyteCount: number;
  dateCount: number;
  firstResultOn: string | null;
  lastResultOn: string | null;
}

export function toReportSummary(row: Record<string, unknown>): ReportSummary {
  return {
    ...toLabReport(row),
    resultCount: numberOrZero(row.result_count),
    analyteCount: numberOrZero(row.analyte_count),
    dateCount: numberOrZero(row.date_count),
    firstResultOn: stringOrNull(row.first_result_on),
    lastResultOn: stringOrNull(row.last_result_on),
  };
}

/** Every stored report, newest first, with its counts and result date range. */
export async function listReports(client: SqlClient, limit = 200): Promise<ReportSummary[]> {
  const result = await client.query(SELECT_REPORTS, [limit]);
  return result.rows.map(toReportSummary);
}

/** One report, or null when there is no such row. */
export async function getReport(client: SqlClient, id: string): Promise<LabReport | null> {
  const result = await client.query(SELECT_REPORT, [id]);
  const row = result.rows[0];
  return row ? toLabReport(row) : null;
}

/** One report's observations, in reading order. */
export async function listResults(client: SqlClient, reportId: string): Promise<LabResult[]> {
  const result = await client.query(SELECT_RESULTS, [reportId]);
  return result.rows.map(toLabResult);
}

/** The report already stored for a content hash, or null. */
export async function findReportBySha(client: SqlClient, sha256: string): Promise<LabReport | null> {
  const result = await client.query(SELECT_REPORT_BY_SHA, [sha256.trim().toLowerCase()]);
  const row = result.rows[0];
  return row ? toLabReport(row) : null;
}

/** Delete a report. Its observations go with it (the foreign key cascades). */
export async function deleteReport(client: SqlClient, id: string): Promise<boolean> {
  const result = await client.query(DELETE_REPORT, [id]);
  return result.rows.length > 0;
}

// ── The series read model ───────────────────────────────────────────────────

export interface SeriesPoint {
  resultId: string;
  reportId: string;
  resultOn: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  printedFlag: string | null;
  /** The interval that was scored against, and where it came from. */
  interval: ResolvedInterval;
  status: ResultStatus;
  statusLabel: string;
  tone: StatusTone;
  /** Disclosures for this point: flag disagreement, band flags, the rule note. */
  notes: string[];
  extractionMethod: LabResult['extractionMethod'];
}

export interface AnalyteSeries {
  analyteKey: string;
  displayName: string;
  /** The registry's category, or 'Other' for an unrecognised analyte. */
  category: AnalyteCategory;
  unit: string | null;
  /** The registry entry, when one matched. Null for an unrecognised name. */
  registered: boolean;
  /** Observations ordered by result date, then reading order. */
  points: SeriesPoint[];
  /** The earliest observation with a numeric value, and its date. */
  first: { value: number; on: string } | null;
  /** The latest observation with a numeric value, and its date. */
  last: { value: number; on: string } | null;
  /** last - first, or null when either is missing. */
  delta: number | null;
  /** How many (analyte_key, result_on) pairs hold more than one row. */
  collisions: number;
  /** Anything the reader must know about this analyte's series. */
  warnings: string[];
}

export interface LabSeries {
  analytes: AnalyteSeries[];
  totalObservations: number;
  /** (analyte_key, result_on) pairs holding more than one row, across all analytes. */
  collisions: number;
}

/** The owner's facts that choose a band. Never inferred from a document. */
export interface SeriesProfile {
  dateOfBirth: string | null;
  sex: 'male' | 'female' | null;
}

/**
 * Build the series read model: per analyte, its observations oldest first with
 * their intervals and computed status, plus the earliest and latest values and
 * the delta.
 *
 * DE-DUPLICATION RULE: two rows sharing (`analyte_key`, `result_on`) are BOTH
 * kept and returned as separate points. Different assays and different labs
 * legitimately produce the same analyte on the same day, so the UI is told the
 * pair collides (`collisions`) rather than being handed a silently chosen row.
 */
export async function getSeries(
  client: SqlClient,
  profile: SeriesProfile | null = null
): Promise<LabSeries> {
  const result = await client.query(SELECT_ALL_RESULTS);
  const rows = result.rows.map(toLabResult);

  const byKey = new Map<string, LabResult[]>();
  for (const row of rows) {
    const bucket = byKey.get(row.analyteKey);
    if (bucket) bucket.push(row);
    else byKey.set(row.analyteKey, [row]);
  }

  const analytes: AnalyteSeries[] = [];
  let totalCollisions = 0;

  for (const [analyteKey, analyteRows] of byKey) {
    const registered = analyteByKey(analyteKey);
    const points: SeriesPoint[] = analyteRows.map(row => {
      const selection = registered
        ? bandForObservation(registered.bands, profile, row.resultOn)
        : { band: null, reason: 'no_bands' as const };
      const scored = scoreResult({
        value: row.value,
        valueText: row.valueText,
        refLow: row.refLow,
        refHigh: row.refHigh,
        printedFlag: row.printedFlag,
        band: selection.band,
      });
      const notes = [...scored.notes];
      if (!registered) {
        notes.push(
          'This analyte is not in the reference registry, so no fallback band exists for it. It is shown with whatever interval the report printed.'
        );
      } else if (scored.interval.origin === 'none' && selection.reason === 'sex_unset') {
        notes.push(
          'The only reference bands for this analyte are sex-specific and the profile has no sex set, so the result is left unscored rather than banded by an assumption.'
        );
      } else if (scored.interval.origin === 'none' && selection.reason === 'age_unknown') {
        notes.push(
          'The reference bands for this analyte depend on age and the profile has no date of birth, so the result is left unscored rather than banded by an assumption.'
        );
      }
      return {
        resultId: row.id,
        reportId: row.reportId,
        resultOn: row.resultOn,
        value: row.value,
        valueText: row.valueText,
        unit: row.unit,
        printedFlag: row.printedFlag,
        interval: scored.interval,
        status: scored.status,
        statusLabel: scored.label,
        tone: scored.tone,
        notes,
        extractionMethod: row.extractionMethod,
      };
    });

    points.sort((a, b) =>
      a.resultOn === b.resultOn ? a.resultId.localeCompare(b.resultId) : a.resultOn < b.resultOn ? -1 : 1
    );

    const numeric = points.filter((point): point is SeriesPoint & { value: number } => point.value !== null);
    const first = numeric.length > 0 ? { value: numeric[0]!.value, on: numeric[0]!.resultOn } : null;
    const lastEntry = numeric.length > 0 ? numeric[numeric.length - 1]! : null;
    const last = lastEntry ? { value: lastEntry.value, on: lastEntry.resultOn } : null;
    const delta = first && last ? last.value - first.value : null;

    const pairs = new Map<string, number>();
    for (const point of points) pairs.set(point.resultOn, (pairs.get(point.resultOn) ?? 0) + 1);
    const collisions = [...pairs.values()].filter(count => count > 1).length;
    totalCollisions += collisions;

    const warnings: string[] = [];
    if (collisions > 0) {
      warnings.push(
        `${collisions} result date${collisions === 1 ? '' : 's'} carr${
          collisions === 1 ? 'ies' : 'y'
        } more than one observation for this analyte. Both are kept — different assays or labs legitimately report the same analyte on the same day — and no single row was chosen.`
      );
    }
    if (!registered) {
      warnings.push('This analyte is not in the reference registry; no fallback band exists for it.');
    }

    const names = analyteRows.map(row => row.printedName).filter(name => name.trim().length > 0);
    const displayName = registered
      ? registered.displayName
      : displayNameFor(analyteKey, names[0] ?? null);

    analytes.push({
      analyteKey,
      displayName,
      category: registered?.category ?? ('Other' as AnalyteCategory),
      unit: registered?.unit ?? analyteRows[0]?.unit ?? null,
      registered: registered !== null,
      points,
      first,
      last,
      delta,
      collisions,
      warnings,
    });
  }

  analytes.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { analytes, totalObservations: rows.length, collisions: totalCollisions };
}

/** Resolve a printed name to a stored `analyte_key`, for the commit path. */
export function keyForPrintedName(printedName: string): { key: string; fallback: boolean } {
  const resolution = resolveAnalyte(printedName);
  return { key: resolution.key, fallback: resolution.fallback };
}

/**
 * The pool for this process, or null when no database is configured.
 * The one connection path: nothing here opens a second pool.
 */
export function storeClient(env: NodeJS.ProcessEnv = process.env): SqlClient | null {
  return getPool(env);
}
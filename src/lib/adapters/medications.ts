// ── Medications Adapter (Health Auto Export) ────────────
//
// SERVER-SIDE ONLY. Reads HAE_API_URL / HAE_API_KEY from the process environment
// and fetches a bounded window from GET /api/medications, normalized into typed
// records. It is never imported by a component: the client bundle must never
// receive the read token (see `index.ts`).
//
// This is a READ-ONLY adapter. Three rules it does not bend:
//
//   * Health data never goes to the database. Nothing here is persisted — no
//     Postgres table, no row, no migration — only returned in-process.
//   * A response body and the credential are never logged.
//   * `displayText` is free text as the person entered it. It is preserved
//     verbatim as the display value; a grouping key is derived ONLY from the
//     leading medication-name portion, and a dose/strength is never parsed out
//     of the label or invented where the source does not state one.
//
// The HTTP client, config resolution, timeout and `HaeError` kinds all live in
// `hae.ts`; the TTL cache + single-flight policy lives in `cache.ts`. This module
// reuses both rather than re-deriving either.

import { addDays, dayKey } from '../analytics/windows';
import { liveCache } from './cache';
import { haeGetArray, type MetricWindow, type RequestDeps } from './hae';

/**
 * The zone a record's day is attributed in when the caller passes none (tests).
 * Every real read passes the profile's timezone, the zone the rest of the app
 * cuts its calendar days in. The source records `scheduledDate` as an instant;
 * a null one is not attributable to any day (see `MedicationRecord`).
 */
export const MEDICATION_DAY_TIMEZONE = 'UTC';

/** The path on the HAE server. Distinct from the metric/workout endpoints. */
export const MEDICATIONS_PATH = '/api/medications';

/** Shown only when `displayText` is empty, so the key is never blank. */
export const UNKNOWN_MEDICATION_KEY = 'unknown medication';

// ── Upstream record shape (only the fields actually present) ──

export interface RawMedicationCoding {
  code?: string;
  system?: string;
  version?: string;
}

export interface RawMedicationRecord {
  _id?: string;
  /** Free text as entered (e.g. "Carvedilol 6.25mg Oral tablet"). Never parsed. */
  displayText?: string;
  /** Number of units. */
  dosage?: number;
  /** ISO instant of the scheduled dose — can be null on a real record. */
  scheduledDate?: string | null;
  start?: string;
  end?: string;
  /** 'Taken' | 'Skipped'. */
  status?: string;
  isArchived?: boolean;
  codings?: RawMedicationCoding[];
  createdAt?: string;
  updatedAt?: string;
}

// ── Normalized shapes ───────────────────────────────────

export type MedicationStatus = 'Taken' | 'Skipped' | 'Unknown';

export interface MedicationCoding {
  code: string;
  system: string;
  version: string;
}

export interface MedicationRecord {
  id: string;
  /**
   * The full original free-text label, exactly as the source holds it. This is
   * the display value; it is never rewritten or had its dose parsed out.
   */
  displayText: string;
  /**
   * Grouping key = the leading medication-name portion of `displayText` only.
   * "Carvedilol 6.25mg Oral tablet" → "Carvedilol";
   * "Losartan Potassium 50mg, …" → "Losartan Potassium". A dose/strength is
   * never invented where the source states none.
   */
  groupingKey: string;
  /** Units of the dose, or null when the source omits it. */
  dosage: number | null;
  status: MedicationStatus;
  /** ISO instant of the scheduled dose, or null when the source omits it. */
  scheduledDate: string | null;
  /**
   * Calendar day (YYYY-MM-DD, UTC) the record is attributable to, or null when
   * `scheduledDate` is null. A null here is an explicit "not attributable to a
   * day": the record is still returned, never dropped.
   */
  dayKey: string | null;
  start: string | null;
  end: string | null;
  isArchived: boolean;
  codings: MedicationCoding[];
}

// ── Pure helpers (no I/O) ───────────────────────────────

/**
 * Derive the grouping key from the leading medication-name portion of a label.
 *
 * The name ends where the first digit appears (the start of a dose/strength), or
 * at the end of the string when the label states no strength at all. Trailing
 * separators left over at that boundary are trimmed. No strength is fabricated:
 * something the label does not say never appears in the key.
 */
export function medicationGroupingKey(displayText: string | null | undefined): string {
  const text = (displayText ?? '').trim();
  if (!text) return UNKNOWN_MEDICATION_KEY;
  const match = /\d/.exec(text);
  const name = match ? text.slice(0, match.index) : text;
  const trimmed = name.trim().replace(/[\s,;:.–—-]+$/, '').trim();
  return trimmed || text;
}

function normalizeStatus(status: unknown): MedicationStatus {
  return status === 'Taken' || status === 'Skipped' ? status : 'Unknown';
}

function normalizeDosage(dosage: unknown): number | null {
  return typeof dosage === 'number' && Number.isFinite(dosage) ? dosage : null;
}

function normalizeCoding(coding: RawMedicationCoding): MedicationCoding | null {
  const code = typeof coding.code === 'string' ? coding.code : '';
  if (!code) return null;
  return {
    code,
    system: typeof coding.system === 'string' ? coding.system : '',
    version: typeof coding.version === 'string' ? coding.version : '',
  };
}

/** Convert one upstream record. A null `scheduledDate` survives as a null day. */
export function toMedicationRecord(
  raw: RawMedicationRecord,
  timezone: string = MEDICATION_DAY_TIMEZONE
): MedicationRecord {
  const displayText = typeof raw.displayText === 'string' ? raw.displayText : '';
  const scheduledDate =
    typeof raw.scheduledDate === 'string' && raw.scheduledDate.length > 0
      ? raw.scheduledDate
      : null;
  const codings = Array.isArray(raw.codings)
    ? raw.codings.map(normalizeCoding).filter((c): c is MedicationCoding => c !== null)
    : [];

  return {
    id: typeof raw._id === 'string' ? raw._id : '',
    displayText,
    groupingKey: medicationGroupingKey(displayText),
    dosage: normalizeDosage(raw.dosage),
    status: normalizeStatus(raw.status),
    scheduledDate,
    dayKey: scheduledDate ? dayKey(scheduledDate, timezone) : null,
    start: typeof raw.start === 'string' ? raw.start : null,
    end: typeof raw.end === 'string' ? raw.end : null,
    isArchived: raw.isArchived === true,
    codings,
  };
}

/** The span the attributable records actually cover, or null when none are. */
export interface MedicationCoverage {
  from: string;
  to: string;
}

function coveredSpan(records: MedicationRecord[]): MedicationCoverage | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const r of records) {
    if (!r.scheduledDate) continue;
    if (from === null || r.scheduledDate < from) from = r.scheduledDate;
    if (to === null || r.scheduledDate > to) to = r.scheduledDate;
  }
  return from !== null && to !== null ? { from, to } : null;
}

// ── Windowed read ───────────────────────────────────────

export interface MedicationReadResult {
  records: MedicationRecord[];
  /** The bounds the upstream request was sent with (echoed back). */
  window: MetricWindow;
  /**
   * The span the returned records actually cover, derived from their
   * `scheduledDate`s, or null when the window yielded nothing attributable.
   */
  covered: MedicationCoverage | null;
}

function medicationQuery(window: MetricWindow): string {
  const params = new URLSearchParams();
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface MedicationReadDeps extends RequestDeps {
  /** IANA zone each record's day is attributed in: the profile's timezone. */
  timezone?: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The upstream bounds are UTC calendar days. Outside UTC, a local day straddles
 * two of them, so the request is widened by a day on each side and the records
 * are then trimmed to the requested local days.
 */
function upstreamWindowFor(window: MetricWindow, timezone: string): MetricWindow {
  if (timezone === 'UTC') return window;
  return {
    from: window.from && DAY_KEY.test(window.from) ? addDays(window.from, -1) : window.from,
    to: window.to && DAY_KEY.test(window.to) ? addDays(window.to, 1) : window.to,
  };
}

function inLocalWindow(record: MedicationRecord, window: MetricWindow): boolean {
  if (record.dayKey === null) return true;
  if (window.from && DAY_KEY.test(window.from) && record.dayKey < window.from) return false;
  if (window.to && DAY_KEY.test(window.to) && record.dayKey >= window.to) return false;
  return true;
}

/**
 * GET /api/medications — a bounded window of records, newest first.
 *
 * An empty window is an honest empty: it returns zero records, never an error.
 * Any real failure (HTTP error, timeout, non-array body) throws a `HaeError`.
 * Nothing is logged, and nothing is written anywhere.
 */
export async function fetchMedications(
  window: MetricWindow = {},
  deps: MedicationReadDeps = {}
): Promise<MedicationReadResult> {
  const timezone = deps.timezone ?? MEDICATION_DAY_TIMEZONE;
  const raw = await haeGetArray<RawMedicationRecord>(
    `${MEDICATIONS_PATH}${medicationQuery(upstreamWindowFor(window, timezone))}`,
    deps
  );
  const records = raw
    .map(r => toMedicationRecord(r, timezone))
    .filter(r => timezone === 'UTC' || inLocalWindow(r, window));
  return { records, window, covered: coveredSpan(records) };
}

// ── Cached entry point ──────────────────────────────────

export interface MedicationDeps extends MedicationReadDeps {
  /** Skip the process-wide cache (tests, and an explicit refresh). */
  bypassCache?: boolean;
}

/** One cache entry per requested window and attribution zone. */
export function medicationsCacheKey(
  window: MetricWindow = {},
  timezone: string = MEDICATION_DAY_TIMEZONE
): string {
  return `medications:${timezone}:${window.from ?? ''}:${window.to ?? ''}`;
}

/**
 * Read a medication window through the process-wide TTL cache with single-flight:
 * concurrent callers for the same window share one upstream pass, and a
 * TTL-lapsed entry is served stale while it refreshes in the background.
 */
export async function loadMedications(
  window: MetricWindow = {},
  deps: MedicationDeps = {}
): Promise<MedicationReadResult> {
  const key = medicationsCacheKey(window, deps.timezone);
  if (deps.bypassCache) {
    const fresh = await fetchMedications(window, deps);
    liveCache.clear(key);
    return fresh;
  }
  return liveCache.getOrLoad(key, () => fetchMedications(window, deps));
}

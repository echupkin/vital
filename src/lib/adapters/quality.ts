// ── Data quality: problems in what the export delivered ─
//
// Vital can only show what reached the export server, and the server stores
// exactly what the phone sent. These checks look for the ways that goes wrong
// in practice, all of them seen on real data:
//
//   * Overlapping exports. The same activity stored twice at different time
//     groupings: an hourly total beside the finer records it already contains
//     (a manual export at "1 hour" over days the automation had sent sample by
//     sample). The server merges records only when timestamp and source match,
//     so Vital's daily sums count that activity twice.
//   * Duplicate readings. A weigh-in, say, stored once as it was taken and
//     again as an hourly copy: the record count doubles.
//   * Missing days. A metric the watch records every day is absent on days the
//     watch clearly was in use, so an export left it out.
//   * A late start. A metric (food, typically) begins long after everything
//     else: its history was never exported.
//   * A stalled automation. Nothing new has arrived for well over a day.
//
// Every check runs on the records as the server returned them, before Vital
// aggregates them per day: once two exports are summed into one daily value
// the overlap cannot be seen any more. The checks report and explain; they
// never change the export server. Overlapping exports and duplicate readings
// Vital corrects itself, by leaving the repeated records out of its own totals
// (`findRedundant`, on unless the reader turned it off): those checks then say
// what was corrected. Every other finding carries the steps that fix it.
//
// Pure and deterministic; no I/O.

import { getMetric } from '../metrics/registry';
import { addDays, diffDays, formatDayKeyLong } from '../analytics/windows';
import type { DayAggregation } from './normalize';

export type QualitySeverity = 'problem' | 'warning' | 'info';
export type QualityCheckId = 'overlapping-exports' | 'duplicate-readings' | 'missing-days' | 'late-start' | 'stale';
/** Checks whose findings Vital can correct itself, by leaving the repeated records out (see `findRedundant`). */
export const CORRECTABLE_CHECKS = ['overlapping-exports', 'duplicate-readings'] as const satisfies readonly QualityCheckId[];
export type CorrectableCheck = (typeof CORRECTABLE_CHECKS)[number];

export interface DayRange {
  from: string;
  to: string;
  days: number;
}

export interface QualityFinding {
  check: QualityCheckId;
  severity: QualitySeverity;
  title: string;
  /** What was found, with the numbers. */
  detail: string;
  /** Registry metric ids affected. */
  metrics: string[];
  /** Affected days, merged into runs, newest first (capped). */
  ranges: DayRange[];
  affectedDays: number;
  /** What to do about it, in order. */
  remedy: string[];
  /** Vital can correct this itself, and the reader turned that off: offer to turn it back on. */
  correctable?: boolean;
}

export interface QualityCheckResult {
  id: QualityCheckId;
  label: string;
  /**
   * flagged: something to fix; note: found, but only more than RECENT_DAYS ago;
   * corrected: found, and Vital leaves the repeated records out of its totals.
   */
  outcome: 'pass' | 'flagged' | 'note' | 'corrected';
  /** Set on a correctable check: whether the correction is on. */
  correcting?: boolean;
  summary: string;
}

export interface DataQualityReport {
  checks: QualityCheckResult[];
  findings: QualityFinding[];
}

export const QUALITY_CHECK_LABEL: Record<QualityCheckId, string> = {
  'overlapping-exports': 'Overlapping exports (double counting)',
  'duplicate-readings': 'Duplicate readings',
  'missing-days': 'Missing days',
  'late-start': 'History that starts late',
  stale: 'New data arriving',
};

const HOUR_MS = 3_600_000;
/** Metrics the watch records every day it is worn: the yardstick for missing days. */
export const DAILY_METRICS = ['step_count', 'active_energy', 'basal_energy_burned', 'heart_rate', 'distance_walking_running'];
/**
 * The ones checked for gaps. Heart rate is left out: it marks the days the
 * watch was worn, and a day carried by the phone alone has none.
 */
const GAP_METRICS = DAILY_METRICS.filter(id => id !== 'heart_rate');
/** Metrics a person logs: missing days are normal, a late start is worth a note. */
const LOGGED_METRICS = ['dietary_energy', 'dietary_protein'];
/** A day counts as "the watch was in use" when at least this many daily metrics have data. */
const DEVICE_DAY_MIN_METRICS = 2;
/** Hours on a day that must overlap before the day is flagged. */
const OVERLAP_MIN_HOURS = 2;
/** Share of a day's stored total that must be double before the day is flagged. */
const OVERLAP_MIN_SHARE = 0.15;
/** Finer records an hour must hold besides the on-the-hour one before it can be a total and its contents. */
const OVERLAP_MIN_FINE = 2;
/** How much larger than the largest finer record an hourly total must be. */
const OVERLAP_TOTAL_OVER_PART = 1.5;
/** Finer records adding up to between these multiples of the hourly total are that hour, counted twice. */
const OVERLAP_RATIO = { min: 0.5, max: 2.5 };
/** A reading within this share of the hourly copy beside it is the same reading. */
const DUPLICATE_TOLERANCE = 0.005;
const STALE_HOURS = 36;
const LATE_START_DAYS = { daily: 14, logged: 30 };
const MAX_RANGES = 6;
/**
 * Findings whose every affected day is older than this are notes, not
 * problems: the recent figures — the trends, baselines and body goal people
 * act on — are not affected by a gap or overlap half a year back.
 */
export const RECENT_DAYS = 90;

// ── Local hours ─────────────────────────────────────────
//
// An hourly total sits on a whole hour of the phone's local time. The zone's
// offset is looked up once per UTC hour rather than once per record: the
// heavy series run to tens of thousands of records.

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetMinutes(ms: number, tz: string): number {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    offsetFormatters.set(tz, f);
  }
  const name = f.formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

function localClock(tz: string) {
  const cache = new Map<number, number>();
  return (ms: number): number => {
    const utcHour = Math.floor(ms / HOUR_MS);
    let offset = cache.get(utcHour);
    if (offset === undefined) {
      offset = offsetMinutes(ms, tz);
      cache.set(utcHour, offset);
    }
    return ms + offset * 60_000;
  };
}

// ── Per-metric scan of the raw records ──────────────────

export interface ScanRecord {
  date: string;
  value: number;
  source: string;
}

/**
 * The part of a metric's records the checks need, packed into typed arrays.
 * The live load keeps this — a few megabytes for a year of history, against
 * the hundreds it drops — so the checks can run after the data is served
 * instead of holding up the load.
 */
export interface CompactRecords {
  /** Record instants, ms since the epoch. */
  ms: Float64Array;
  value: Float64Array;
  /** Index into `sources`. */
  source: Uint32Array;
  sources: string[];
}

export function compactRecords(records: ScanRecord[]): CompactRecords {
  return compactFrom(records, r => r.value);
}

/**
 * Pack raw records straight from the server, reading each value with
 * `valueOf`, without building an intermediate object per record.
 */
export function compactFrom<T extends { date: string; source?: string }>(records: T[], valueOf: (r: T) => number): CompactRecords {
  const ms = new Float64Array(records.length);
  const value = new Float64Array(records.length);
  const source = new Uint32Array(records.length);
  const ids = new Map<string, number>();
  let n = 0;
  for (const r of records) {
    const t = Date.parse(r.date);
    const v = valueOf(r);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const src = r.source ?? '';
    let id = ids.get(src);
    if (id === undefined) ids.set(src, (id = ids.size));
    ms[n] = t;
    value[n] = v;
    source[n] = id;
    n++;
  }
  return { ms: ms.subarray(0, n), value: value.subarray(0, n), source: source.subarray(0, n), sources: [...ids.keys()] };
}

export interface MetricScan {
  metricId: string;
  aggregation: DayAggregation;
  /** Days whose finer records sit inside hours that also carry an hourly total. */
  overlapDays: Map<string, { hours: number; doubled: number; total: number }>;
  /** Days with a reading stored a second time as an hourly copy. */
  duplicateDays: Map<string, number>;
  /** Records the correction leaves out: the finer records of the flagged days, or the copies. */
  redundantRecords: number;
  /** Newest record instant, ms. */
  newest: number | null;
}

/** A scan with nothing to look at but how recent the metric is (averaged metrics such as heart rate). */
export function recencyScan(metricId: string, aggregation: DayAggregation, newest: number | null): MetricScan {
  return { metricId, aggregation, overlapDays: new Map(), duplicateDays: new Map(), redundantRecords: 0, newest };
}

const DAY_MS = 86_400_000;

/** A local day index (days since the epoch, on the local clock) as a day key. */
function dayOfIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

interface HourBucket {
  /** Index of the one on-the-hour record; -1 none yet, -2 more than one. */
  aligned: number;
  fineCount: number;
  fineSum: number;
  fineMax: number;
  /** Finer readings, kept only for per-reading metrics (few records). */
  fineValues: number[] | null;
}

export interface RedundantRecords {
  overlapDays: MetricScan['overlapDays'];
  duplicateDays: MetricScan['duplicateDays'];
  /**
   * 1 for each record (by index into the packed arrays) that only repeats
   * another: on a flagged day, the finer records inside an hour that also
   * holds their hourly total; for a reading, the on-the-hour copy.
   */
  drop: Uint8Array;
  /** How many records `drop` marks. */
  count: number;
}

/**
 * Find the records that repeat others because two time groupings overlap.
 *
 * Records are grouped by source and local clock hour. An hour holding one
 * record exactly on the hour plus finer records is suspicious; it is an
 * overlap when the finer records add up to roughly that hourly value (they
 * are the same activity, sent twice). Summed metrics are checked for double
 * counting, per-reading metrics (weight, body fat) for copies.
 *
 * The data-quality scan reports what this finds, and the live load leaves the
 * marked records out when the correction is on (see `quality-correct.ts`), so
 * what is corrected is exactly what is reported. For a summed metric the
 * hourly total stays and the finer records go, and only on flagged days: a
 * stray hour is not enough to change a day. For a reading the copy goes; it
 * sits at the start of the hour, before the original, so the day's latest
 * reading is unchanged.
 *
 * Buckets are keyed by number and days by a local day index, so the scan does
 * no per-record string or timezone formatting: the zone's offset is looked up
 * once per UTC hour.
 */
export function findRedundant(aggregation: DayAggregation, data: CompactRecords, tz: string): RedundantRecords {
  const { ms, value, source } = data;
  const n = ms.length;
  const found: RedundantRecords = { overlapDays: new Map(), duplicateDays: new Map(), drop: new Uint8Array(n), count: 0 };
  // Averaged metrics (heart rate and the like) are checked only for how recent they are.
  if (aggregation === 'mean' || n === 0) return found;

  const local = localClock(tz);
  const sourceCount = Math.max(1, data.sources.length);
  const hours = new Map<number, HourBucket>();
  const dayTotals = new Map<number, number>();
  const at = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const t = local(ms[i]);
    at[i] = t;
    const key = Math.floor(t / HOUR_MS) * sourceCount + source[i];
    let hour = hours.get(key);
    if (!hour) hours.set(key, (hour = { aligned: -1, fineCount: 0, fineSum: 0, fineMax: -Infinity, fineValues: aggregation === 'latest' ? [] : null }));
    if (t % HOUR_MS === 0) {
      hour.aligned = hour.aligned === -1 ? i : -2;
    } else {
      hour.fineCount++;
      hour.fineSum += value[i];
      if (value[i] > hour.fineMax) hour.fineMax = value[i];
      hour.fineValues?.push(value[i]);
    }
    if (aggregation === 'sum') {
      const day = Math.floor(t / DAY_MS);
      dayTotals.set(day, (dayTotals.get(day) ?? 0) + value[i]);
    }
  }

  const overlap = new Map<number, { hours: number; doubled: number; total: number; keys: number[] }>();
  for (const [key, hour] of hours) {
    if (hour.aligned < 0 || hour.fineCount === 0) continue;
    const hourly = value[hour.aligned];
    const day = Math.floor(at[hour.aligned] / DAY_MS);
    if (aggregation === 'sum') {
      // An hourly total is the sum of several records and larger than any one
      // of them. Two one-minute samples, one of which happens to start on the
      // hour, are not a total and its contents.
      if (hourly <= 0 || hour.fineCount < OVERLAP_MIN_FINE) continue;
      if (hourly < hour.fineMax * OVERLAP_TOTAL_OVER_PART) continue;
      const ratio = hour.fineSum / hourly;
      if (ratio < OVERLAP_RATIO.min || ratio > OVERLAP_RATIO.max) continue;
      const entry = overlap.get(day) ?? { hours: 0, doubled: 0, total: dayTotals.get(day) ?? 0, keys: [] };
      entry.hours++;
      entry.doubled += Math.min(hour.fineSum, hourly);
      entry.keys.push(key);
      overlap.set(day, entry);
    } else if (aggregation === 'latest') {
      const scale = Math.max(Math.abs(hourly), 1e-9);
      if (hour.fineValues!.some(v => Math.abs(v - hourly) / scale <= DUPLICATE_TOLERANCE)) {
        const dayKey = dayOfIndex(day);
        found.duplicateDays.set(dayKey, (found.duplicateDays.get(dayKey) ?? 0) + 1);
        found.drop[hour.aligned] = 1;
        found.count++;
      }
    }
  }

  // A day is flagged only when the overlap is a real share of it, not a stray hour.
  const doubledHours = new Set<number>();
  for (const [day, { keys, ...entry }] of overlap) {
    if (entry.hours >= OVERLAP_MIN_HOURS && entry.total > 0 && entry.doubled / entry.total >= OVERLAP_MIN_SHARE) {
      found.overlapDays.set(dayOfIndex(day), entry);
      for (const k of keys) doubledHours.add(k);
    }
  }
  // The finer records inside those hours are the ones counted twice.
  if (doubledHours.size > 0) {
    for (let i = 0; i < n; i++) {
      if (at[i] % HOUR_MS === 0) continue;
      if (doubledHours.has(Math.floor(at[i] / HOUR_MS) * sourceCount + source[i])) {
        found.drop[i] = 1;
        found.count++;
      }
    }
  }
  return found;
}

/** Look at one metric's records for overlapping time groupings (see `findRedundant`). */
export function scanCompact(metricId: string, aggregation: DayAggregation, data: CompactRecords, tz: string): MetricScan {
  const scan = recencyScan(metricId, aggregation, null);
  const { ms } = data;
  for (let i = 0; i < ms.length; i++) if (scan.newest === null || ms[i] > scan.newest) scan.newest = ms[i];
  const found = findRedundant(aggregation, data, tz);
  scan.overlapDays = found.overlapDays;
  scan.duplicateDays = found.duplicateDays;
  scan.redundantRecords = found.count;
  return scan;
}

/** The same scan from plain records (tests, small inputs). */
export function scanMetricRecords(metricId: string, aggregation: DayAggregation, records: ScanRecord[], tz: string): MetricScan {
  return scanCompact(metricId, aggregation, compactRecords(records), tz);
}

// ── The report ──────────────────────────────────────────

export interface QualityInputs {
  scans: MetricScan[];
  /** Days with data, per registry metric id (from the normalized dataset). */
  daysByMetric: Record<string, string[]>;
  /** The dataset's current day (still filling up; never counted as missing). */
  referenceKey: string;
  now: Date;
  /** Checks Vital corrects in its own totals. Omitted: none (the checks only report). */
  corrections?: ReadonlySet<CorrectableCheck>;
}

function label(metricId: string): string {
  return getMetric(metricId)?.displayName ?? metricId;
}

export function listLabels(ids: string[]): string {
  const names = ids.map(label);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Sorted day keys merged into consecutive runs, newest first. */
export function toRanges(days: string[]): DayRange[] {
  const sorted = [...new Set(days)].sort();
  const runs: DayRange[] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === day) {
      last.to = day;
      last.days++;
    } else {
      runs.push({ from: day, to: day, days: 1 });
    }
  }
  return runs.reverse();
}

export function formatRange(r: DayRange): string {
  return r.from === r.to ? formatDayKeyLong(r.from) : `${formatDayKeyLong(r.from)} – ${formatDayKeyLong(r.to)}`;
}

/** Metrics missing on exactly the same days, named together. */
function groupByDays(missing: { id: string; days: string[] }[]): { ids: string[]; count: number }[] {
  const groups = new Map<string, { ids: string[]; count: number }>();
  for (const m of missing) {
    const key = [...m.days].sort().join(',');
    const g = groups.get(key);
    if (g) g.ids.push(m.id);
    else groups.set(key, { ids: [m.id], count: m.days.length });
  }
  return [...groups.values()];
}

const GUIDE =
  'See “Setting up Health Auto Export for complete data” in docs/data-sources.md for the settings that prevent this.';
const SAME_GROUPING =
  'In Health Auto Export, use one time grouping (1 hour is recommended) for the automation and for every manual export, and keep it.';

export function dataQualityReport(inputs: QualityInputs): DataQualityReport {
  const { scans, daysByMetric, referenceKey, now } = inputs;
  const correcting = (id: CorrectableCheck) => inputs.corrections?.has(id) ?? false;
  const findings: QualityFinding[] = [];
  const checks: QualityCheckResult[] = [];
  const complete = (day: string) => day < referenceKey;

  // ── Overlapping exports ───────────────────────────────
  {
    const hit = scans.filter(s => s.aggregation === 'sum' && s.overlapDays.size > 0);
    if (hit.length) {
      const days = [...new Set(hit.flatMap(s => [...s.overlapDays.keys()]))];
      let doubled = 0;
      let total = 0;
      for (const s of hit) for (const e of s.overlapDays.values()) {
        doubled += e.doubled;
        total += e.total;
      }
      const inflation = total > doubled ? Math.round((doubled / (total - doubled)) * 100) : null;
      const ranges = toRanges(days);
      const records = hit.reduce((n, s) => n + s.redundantRecords, 0);
      if (correcting('overlapping-exports')) {
        checks.push({
          id: 'overlapping-exports',
          label: QUALITY_CHECK_LABEL['overlapping-exports'],
          outcome: 'corrected',
          correcting: true,
          summary:
            `Corrected by Vital: ${records} finer record${records === 1 ? '' : 's'} of ${listLabels(hit.map(s => s.metricId))} on ${days.length} day${days.length === 1 ? '' : 's'} ` +
            `${records === 1 ? 'is' : 'are'} left out, so that activity is counted once.`,
        });
      } else {
        findings.push({
          check: 'overlapping-exports',
          severity: 'problem',
          title: 'Some activity is counted twice',
          detail:
            `On ${days.length} day${days.length === 1 ? '' : 's'}, ${listLabels(hit.map(s => s.metricId))} ` +
            `${hit.length === 1 ? 'has' : 'have'} hourly totals stored beside the finer records they already contain, ` +
            `so the daily totals add the same activity twice${inflation !== null ? ` — about ${inflation} % too high on those days` : ''}. ` +
            'This happens when an export at one time grouping (say “1 hour”) covers days already sent at another.',
          metrics: hit.map(s => s.metricId),
          ranges: ranges.slice(0, MAX_RANGES),
          affectedDays: days.length,
          remedy: [SAME_GROUPING, GUIDE],
          correctable: true,
        });
        checks.push({ id: 'overlapping-exports', label: QUALITY_CHECK_LABEL['overlapping-exports'], outcome: 'flagged', correcting: false, summary: `${days.length} days with activity counted twice.` });
      }
    } else {
      checks.push({ id: 'overlapping-exports', label: QUALITY_CHECK_LABEL['overlapping-exports'], outcome: 'pass', correcting: correcting('overlapping-exports'), summary: 'No hour holds the same activity at two time groupings.' });
    }
  }

  // ── Duplicate readings ────────────────────────────────
  {
    const hit = scans.filter(s => s.duplicateDays.size > 0);
    if (hit.length) {
      const days = [...new Set(hit.flatMap(s => [...s.duplicateDays.keys()]))];
      const copies = hit.reduce((n, s) => n + [...s.duplicateDays.values()].reduce((a, b) => a + b, 0), 0);
      const ranges = toRanges(days);
      if (correcting('duplicate-readings')) {
        checks.push({
          id: 'duplicate-readings',
          label: QUALITY_CHECK_LABEL['duplicate-readings'],
          outcome: 'corrected',
          correcting: true,
          summary:
            `Corrected by Vital: ${copies} on-the-hour cop${copies === 1 ? 'y' : 'ies'} of ${listLabels(hit.map(s => s.metricId))} readings on ${days.length} day${days.length === 1 ? '' : 's'} ` +
            `${copies === 1 ? 'is' : 'are'} left out.`,
        });
      } else {
        findings.push({
          check: 'duplicate-readings',
          severity: 'warning',
          title: 'Some readings are stored twice',
          detail:
            `${listLabels(hit.map(s => s.metricId))} ${hit.length === 1 ? 'has' : 'have'} ${copies} reading${copies === 1 ? '' : 's'} stored a second time as an on-the-hour copy, on ${days.length} day${days.length === 1 ? '' : 's'}. ` +
            'Vital uses the latest reading of each day, so the values shown barely change, but the number of readings is inflated.',
          metrics: hit.map(s => s.metricId),
          ranges: ranges.slice(0, MAX_RANGES),
          affectedDays: days.length,
          remedy: [SAME_GROUPING, GUIDE],
          correctable: true,
        });
        checks.push({ id: 'duplicate-readings', label: QUALITY_CHECK_LABEL['duplicate-readings'], outcome: 'flagged', correcting: false, summary: `${copies} readings stored twice.` });
      }
    } else {
      checks.push({ id: 'duplicate-readings', label: QUALITY_CHECK_LABEL['duplicate-readings'], outcome: 'pass', correcting: correcting('duplicate-readings'), summary: 'No reading is stored twice.' });
    }
  }

  // ── Missing days and late starts ──────────────────────
  // A "device day" is one on which the watch was clearly in use: it recorded
  // heart rate, or at least two of the other daily metrics have data. A daily
  // metric missing on such a day was left out of an export, not left unrecorded.
  const daySets = new Map(DAILY_METRICS.map(id => [id, new Set((daysByMetric[id] ?? []).filter(complete))]));
  const counts = new Map<string, number>();
  for (const id of GAP_METRICS) for (const d of daySets.get(id)!) counts.set(d, (counts.get(d) ?? 0) + 1);
  const deviceDays = [...new Set([...daySets.get('heart_rate')!, ...counts.keys()])]
    .filter(d => daySets.get('heart_rate')!.has(d) || (counts.get(d) ?? 0) >= DEVICE_DAY_MIN_METRICS)
    .sort();
  const firstDeviceDay = deviceDays[0] ?? null;

  {
    const missing: { id: string; days: string[] }[] = [];
    for (const id of GAP_METRICS) {
      const set = daySets.get(id)!;
      if (set.size === 0) continue;
      const sorted = [...set].sort();
      const [first, last] = [sorted[0], sorted[sorted.length - 1]];
      const gaps = deviceDays.filter(d => d >= first && d <= last && !set.has(d));
      if (gaps.length >= 2) missing.push({ id, days: gaps });
    }
    if (missing.length) {
      const days = [...new Set(missing.flatMap(m => m.days))];
      const ranges = toRanges(days);
      const longest = Math.max(...ranges.map(r => r.days));
      findings.push({
        check: 'missing-days',
        severity: longest >= 3 ? 'problem' : 'warning',
        title: 'Days are missing from the export',
        detail:
          groupByDays(missing)
            .map(g => `${listLabels(g.ids)} ${g.ids.length === 1 ? 'is' : 'are'} missing on ${g.count} day${g.count === 1 ? '' : 's'}`)
            .join('; ') +
          ' on which your watch recorded heart rate or other activity, so those days were left out of an export rather than not recorded.',
        metrics: missing.map(m => m.id),
        ranges: ranges.slice(0, MAX_RANGES),
        affectedDays: days.length,
        remedy: [
          `In Health Auto Export, check that the automation sends ${listLabels(missing.map(m => m.id))}.`,
          'Run a manual export over the missing dates, to the server Vital reads, at the same time grouping as the automation. Keep the phone unlocked and the app open until it finishes: iOS hides Health data from apps while the phone is locked.',
          'Reload this page to confirm. The app’s “N metrics saved successfully” counts metric types, not records, so it is not proof that the days arrived.',
          GUIDE,
        ],
      });
      checks.push({ id: 'missing-days', label: QUALITY_CHECK_LABEL['missing-days'], outcome: 'flagged', summary: `${days.length} days missing from at least one daily metric.` });
    } else {
      checks.push({
        id: 'missing-days',
        label: QUALITY_CHECK_LABEL['missing-days'],
        outcome: 'pass',
        summary: deviceDays.length ? 'Every daily metric is present on every day the watch was in use.' : 'No daily watch metrics to compare yet.',
      });
    }
  }

  {
    const late: { id: string; first: string; behind: number; logged: boolean }[] = [];
    if (firstDeviceDay) {
      for (const id of [...DAILY_METRICS, ...LOGGED_METRICS]) {
        const days = (daysByMetric[id] ?? []).filter(complete).sort();
        if (!days.length) continue;
        const logged = LOGGED_METRICS.includes(id);
        const behind = diffDays(firstDeviceDay, days[0]);
        if (behind >= (logged ? LATE_START_DAYS.logged : LATE_START_DAYS.daily)) late.push({ id, first: days[0], behind, logged });
      }
    }
    // Protein follows calories; one line for the food log is enough.
    const shown = late.filter(l => !(l.id === 'dietary_protein' && late.some(o => o.id === 'dietary_energy')));
    if (shown.length) {
      for (const l of shown) {
        findings.push({
          check: 'late-start',
          severity: l.logged ? 'info' : 'warning',
          title: l.logged ? 'The food log starts late' : `${label(l.id)} history starts late`,
          detail: l.logged
            ? `${label(l.id)} starts on ${formatDayKeyLong(l.first)}, ${l.behind} days after your other data. If you logged food before then, it was never exported: nutrition is a separate group of metrics in Health Auto Export, and a backfill without it sends none.`
            : `${label(l.id)} starts on ${formatDayKeyLong(l.first)}, ${l.behind} days after your other watch data, so its earlier history was never exported.`,
          metrics: [l.id],
          ranges: [{ from: firstDeviceDay!, to: addDays(l.first, -1), days: l.behind }],
          affectedDays: l.behind,
          remedy: [
            l.logged
              ? 'In Health Auto Export, select the nutrition metrics (dietary energy, protein, carbohydrates, total fat, fiber) in the automation.'
              : `In Health Auto Export, check that the automation sends ${label(l.id)}.`,
            `Run a manual export from ${formatDayKeyLong(firstDeviceDay!)} to ${formatDayKeyLong(addDays(l.first, -1))} at the automation’s time grouping, with the phone unlocked.`,
            GUIDE,
          ],
        });
      }
      checks.push({ id: 'late-start', label: QUALITY_CHECK_LABEL['late-start'], outcome: 'flagged', summary: `${listLabels(shown.map(l => l.id))} ${shown.length === 1 ? 'starts' : 'start'} well after your other data.` });
    } else {
      checks.push({ id: 'late-start', label: QUALITY_CHECK_LABEL['late-start'], outcome: 'pass', summary: 'Every metric starts with the rest of your history.' });
    }
  }

  // ── A stalled automation ──────────────────────────────
  {
    const newest = scans
      .filter(s => DAILY_METRICS.includes(s.metricId))
      .map(s => s.newest)
      .filter((v): v is number => v !== null);
    const latest = newest.length ? Math.max(...newest) : null;
    const hours = latest === null ? null : Math.floor((now.getTime() - latest) / HOUR_MS);
    if (hours !== null && hours >= STALE_HOURS) {
      findings.push({
        check: 'stale',
        severity: 'problem',
        title: 'No new data is arriving',
        detail: `The newest record from your watch is ${hours} hours old (${new Date(latest!).toISOString().slice(0, 16).replace('T', ' ')} UTC). The phone’s automation has probably stopped, or is posting to a different server.`,
        metrics: [],
        ranges: [],
        affectedDays: Math.floor(hours / 24),
        remedy: [
          'Open Health Auto Export on the phone: an automation runs only while iOS lets it, and opening the app usually starts a sync.',
          'Check that the automation is enabled, that Background App Refresh is on for the app, and that Low Power Mode is not holding it back.',
          'Check that the automation posts to the same server Vital reads (the host shown under Health Auto Export above).',
        ],
      });
      checks.push({ id: 'stale', label: QUALITY_CHECK_LABEL.stale, outcome: 'flagged', summary: `Nothing new for ${hours} hours.` });
    } else {
      checks.push({
        id: 'stale',
        label: QUALITY_CHECK_LABEL.stale,
        outcome: 'pass',
        summary: hours === null ? 'No watch records to date yet.' : `Newest watch record ${hours < 1 ? 'less than an hour' : `${hours} hour${hours === 1 ? '' : 's'}`} old.`,
      });
    }
  }

  // Old problems are notes. A finding is a problem or a warning only while some
  // of the days it affects fall within the last RECENT_DAYS; ranges are newest
  // first, so the first one says. A check whose findings are all old is a note.
  const cutoff = addDays(referenceKey, -RECENT_DAYS);
  const aged = new Set<QualityFinding>();
  for (const f of findings) {
    if (f.severity === 'info' || f.ranges.length === 0 || f.ranges[0].to >= cutoff) continue;
    f.severity = 'info';
    f.detail += ` All of it is more than ${RECENT_DAYS} days old, so recent figures are not affected; fixing it only completes the older history.`;
    aged.add(f);
  }
  for (const c of checks) {
    const own = findings.filter(f => f.check === c.id);
    if (c.outcome !== 'flagged' || own.length === 0 || !own.every(f => f.severity === 'info')) continue;
    c.outcome = 'note';
    if (own.every(f => aged.has(f))) c.summary += ` All more than ${RECENT_DAYS} days ago.`;
  }

  const order: Record<QualitySeverity, number> = { problem: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { checks, findings };
}

// ── Running the checks in the background ────────────────
//
// The checks take a few hundred milliseconds on a year of history. That is
// too long to hold up every page while the live data loads, so the load only
// packs what the checks need and starts this job; the job scans one metric per
// turn of the event loop, so requests keep being answered while it runs. The
// pipeline panel shows that the checks are running and picks up the result
// when it is ready.

export type QualityJobState = 'computing' | 'ready' | 'failed';

export interface QualityJob {
  state: QualityJobState;
  /** The report once ready. */
  value: DataQualityReport | null;
  error: string | null;
  /** Settles when the checks finish. Never rejects. */
  promise: Promise<DataQualityReport | null>;
}

export interface QualityJobInput {
  /** Per metric: packed records to scan, or just how recent it is (averaged metrics). */
  metrics: { metricId: string; aggregation: DayAggregation; data: CompactRecords | null; newest: number | null }[];
  daysByMetric: Record<string, string[]>;
  referenceKey: string;
  now: Date;
  tz: string;
  corrections?: ReadonlySet<CorrectableCheck>;
}

const nextTurn = (): Promise<void> =>
  new Promise(resolve => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));

export function startQualityJob(input: QualityJobInput): QualityJob {
  const job: QualityJob = { state: 'computing', value: null, error: null, promise: Promise.resolve(null) };
  job.promise = (async () => {
    try {
      const scans: MetricScan[] = [];
      for (const m of input.metrics) {
        await nextTurn();
        scans.push(m.data ? scanCompact(m.metricId, m.aggregation, m.data, input.tz) : recencyScan(m.metricId, m.aggregation, m.newest));
      }
      job.value = dataQualityReport({ scans, daysByMetric: input.daysByMetric, referenceKey: input.referenceKey, now: input.now, corrections: input.corrections });
      job.state = 'ready';
      return job.value;
    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : 'The data-quality checks failed.';
      return null;
    } finally {
      // The packed records are only needed for the scan.
      input.metrics.length = 0;
    }
  })();
  return job;
}

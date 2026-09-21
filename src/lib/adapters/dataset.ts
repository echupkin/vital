// ── Canonical dataset access ────────────────────────────
//
// One dataset feeds every page, in either data mode:
//
//   demo  — the committed fixtures (src/data/health-fixtures.json), unchanged and
//           deterministic, used as the shape reference and as the demo default.
//   live  — the normalized Health Auto Export history, built server-side by
//           `LiveHealthDataAdapter` and injected once per request.
//
// Both modes arrive here as the SAME internal shape, so no page or component has
// to know which one it is reading. `setActiveDataset` swaps the active dataset;
// the reference day and window start are live bindings, so importers re-read them
// on every render instead of capturing the demo values once.

import fixturesJson from '../../data/health-fixtures.json';
import type {
  HealthFixtures,
  MetricObservation,
  SleepObservation,
  SleepStages,
  BloodPressureObservation,
  WorkoutRecord,
  MetricCoverage,
  MetricDefinition,
} from '../metrics/types';
import { getMetric } from '../metrics/registry';
import { dayKey, type DayWindow, selectByWindow } from '../analytics/windows';
import { dedupeSameInstant, sourceRuleFor } from './sources';

export type DataMode = 'demo' | 'live';

export const FIXTURES = fixturesJson as unknown as HealthFixtures;

/**
 * The active dataset, the timezone it is expressed in, and the day keys that
 * pages use as "now" and "the start of history". Mutable on purpose: the demo
 * fixtures are the initial value so demo mode and every test that never calls
 * `setActiveDataset` behave exactly as before.
 */
let ACTIVE: HealthFixtures = FIXTURES;

export let REFERENCE_TZ: string = FIXTURES.timezone || 'America/Chicago';
export let REFERENCE_KEY: string = dayKey(FIXTURES.referenceDate, REFERENCE_TZ);
export let WINDOW_START_KEY: string = dayKey(FIXTURES.windowStart, REFERENCE_TZ);
let MODE: DataMode = 'demo';

export interface DatasetMeta {
  mode: DataMode;
  /** Day key of the current day in the dataset timezone. */
  referenceKey: string;
  /** Day key the data begins. */
  windowStartKey: string;
  timezone: string;
  /** Instant the reference day is anchored to. */
  referenceDate: string;
  /** Newest observation instant in the dataset — the honest freshness time. */
  dataAsOf: string;
  generatedAt: string;
  /** Day-level observations across every stored series. */
  observationCount: number;
  metricCount: number;
  workouts: number;
  sources: string[];
  /** True when the dataset came from a live source rather than the fixtures. */
  live: boolean;
}

/** A daily point keyed by calendar day. */
export interface DayPoint {
  key: string;
  value: number;
  source: string;
  /** Present when the day's sample is known to be incomplete (see step hourly coverage). */
  partial?: boolean;
}

export interface SleepDay {
  key: string;
  /** Minutes asleep — assigned to the waking date. */
  asleepMinutes: number;
  /** Minutes in bed. */
  inBedMinutes: number;
  durationMinutes: number;
  bedtime: string;
  wakeTime: string;
  /** Per-night stage split, in minutes. `awake` is inside the in-bed window. */
  stages: SleepStages;
  source: string;
}

// ── Meta ────────────────────────────────────────────────

let META: DatasetMeta = computeMeta(FIXTURES, 'demo', FIXTURES.referenceDate, FIXTURES.windowEnd);

function computeMeta(
  dataset: HealthFixtures,
  mode: DataMode,
  referenceDate: string,
  dataAsOf: string
): DatasetMeta {
  const timezone = dataset.timezone || 'America/Chicago';
  let observationCount = 0;
  let workoutCount = 0;
  const sources = new Set<string>();
  for (const [id, series] of Object.entries(dataset.metrics)) {
    if (!Array.isArray(series)) continue;
    observationCount += series.length;
    const cov = dataset.coverage?.[id];
    if (cov?.sourceNames) cov.sourceNames.forEach(s => sources.add(s));
  }
  workoutCount = (dataset.workouts ?? []).length;
  return {
    mode,
    referenceKey: dayKey(referenceDate, timezone),
    windowStartKey: dayKey(dataset.windowStart, timezone),
    timezone,
    referenceDate,
    dataAsOf,
    generatedAt: new Date().toISOString(),
    observationCount,
    metricCount: Object.keys(dataset.metrics ?? {}).length,
    workouts: workoutCount,
    sources: [...sources].sort(),
    live: mode === 'live',
  };
}

export function datasetMeta(): DatasetMeta {
  return META;
}

export function dataMode(): DataMode {
  return MODE;
}

export function isLiveMode(): boolean {
  return MODE === 'live';
}

export function activeDataset(): HealthFixtures {
  return ACTIVE;
}

export interface ActiveDatasetOptions {
  mode: DataMode;
  /** Newest observation instant, for the freshness label. */
  dataAsOf?: string;
  generatedAt?: string;
}

/**
 * Install a dataset (demo fixtures or a normalized live history) as the active
 * one. Called once per request by the dataset provider, before the pages render.
 */
export function setActiveDataset(dataset: HealthFixtures, options: ActiveDatasetOptions): void {
  if (ACTIVE === dataset && MODE === options.mode) return;
  ACTIVE = dataset;
  MODE = options.mode;
  REFERENCE_TZ = dataset.timezone || 'America/Chicago';
  REFERENCE_KEY = dayKey(dataset.referenceDate, REFERENCE_TZ);
  WINDOW_START_KEY = dayKey(dataset.windowStart, REFERENCE_TZ);
  META = computeMeta(
    dataset,
    options.mode,
    dataset.referenceDate,
    options.dataAsOf ?? dataset.windowEnd ?? dataset.referenceDate
  );
  if (options.generatedAt) META.generatedAt = options.generatedAt;
}

/** Restore the committed demo fixtures. Used by tests. */
export function resetToDemoDataset(): void {
  ACTIVE = FIXTURES;
  MODE = 'demo';
  REFERENCE_TZ = FIXTURES.timezone || 'America/Chicago';
  REFERENCE_KEY = dayKey(FIXTURES.referenceDate, REFERENCE_TZ);
  WINDOW_START_KEY = dayKey(FIXTURES.windowStart, REFERENCE_TZ);
  META = computeMeta(FIXTURES, 'demo', FIXTURES.referenceDate, FIXTURES.windowEnd);
}

export function getFixtures(): HealthFixtures {
  return ACTIVE;
}

export function coverageFor(metricId: string): MetricCoverage | undefined {
  return ACTIVE.coverage[metricId];
}

export function availableMetricIds(): string[] {
  return Object.keys(ACTIVE.coverage);
}

function rawObservations(metricId: string): MetricObservation[] {
  const raw = ACTIVE.metrics[metricId];
  if (!Array.isArray(raw)) return [];
  return raw as MetricObservation[];
}

/**
 * Records are stored either as full instants (metric observations) or as bare
 * calendar dates (sleep episodes, which are assigned to their waking date).
 * A bare date must never be pushed through timezone conversion, or it shifts a
 * day backwards for negative UTC offsets.
 */
export function canonicalDayKey(dateStr: string, tz: string = REFERENCE_TZ): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return dayKey(dateStr, tz);
}

function toDayPoint(o: MetricObservation): DayPoint {
  const partial = o.partial === true
    ? true
    : Array.isArray(o.hourly)
      ? o.hourly.length < 24
      : undefined;
  return {
    key: canonicalDayKey(o.date),
    value: o.qty,
    source: o.source,
    ...(partial === undefined ? {} : { partial }),
  };
}

/** Sorted daily series for a plain numeric metric. */
export function metricSeries(metricId: string): DayPoint[] {
  return rawObservations(metricId)
    .map(toDayPoint)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function sleepSeries(): SleepDay[] {
  const raw = (ACTIVE.metrics['sleep_analysis'] as SleepObservation[]) || [];
  const episodes = raw.map(r => {
    const night: SleepDay = {
      key: canonicalDayKey(r.date),
      asleepMinutes: r.asleepMinutes,
      inBedMinutes: r.inBedMinutes,
      durationMinutes: r.durationMinutes,
      bedtime: r.bedtime,
      wakeTime: r.wakeTime,
      stages: sleepStagesOf(r),
      source: r.source,
    };
    // The identity of an episode is its in-bed window plus its totals, never the
    // export instant (see `SLEEP_REPEAT_RULE`). Repeats are collapsed on the way
    // in by `normalizeSleep`; collapsing again here is idempotent and also covers
    // the committed fixtures and any dataset assembled elsewhere.
    return {
      date: `${night.bedtime}|${night.wakeTime}|${night.inBedMinutes}|${night.asleepMinutes}`,
      source: night.source,
      night,
    };
  });
  const { kept } = dedupeSameInstant(episodes, sourceRuleFor('sleep_analysis'));
  return kept.map(e => e.night).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Nights whose record carries an actual stage split. Time asleep exists only for
 * these; an in-bed-only record has no time-asleep value at all — not a zero one.
 */
export function sleepNightsWithStages(nights: SleepDay[] = sleepSeries()): SleepDay[] {
  return nights.filter(hasSleepStages);
}

export interface SleepCoverageSummary {
  /** Nights in the series, after exact repeats collapsed to one. */
  nights: number;
  /** Nights carrying a deep / core / REM split — the time-asleep population. */
  nightsWithStages: number;
  /** Records carrying only an in-bed window, excluded from time asleep. */
  inBedOnlyNights: number;
}

/** Counts behind the Sleep page's coverage sentence. */
export function sleepCoverageSummary(nights: SleepDay[] = sleepSeries()): SleepCoverageSummary {
  const nightsWithStages = nights.filter(hasSleepStages).length;
  return {
    nights: nights.length,
    nightsWithStages,
    inBedOnlyNights: nights.length - nightsWithStages,
  };
}


/**
 * The stage split for one night.
 *
 * `awake` is read from the record when the source carried it. When it did not,
 * it is derived as the remaining in-bed time (in-bed minus asleep) — that is
 * arithmetic on values the record already holds, not an invented split. A night
 * whose record has no stage data at all keeps zeros, so the caller shows its
 * total without inventing stages for it.
 */
function sleepStagesOf(r: SleepObservation): SleepStages {
  const stages = (r.stages ?? {}) as Partial<SleepStages>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    deep: num(stages.deep),
    rem: num(stages.rem),
    core: num(stages.core),
    awake:
      typeof stages.awake === 'number' && Number.isFinite(stages.awake)
        ? stages.awake
        : Math.max(0, num(r.inBedMinutes) - num(r.asleepMinutes)),
  };
}

/** True when a night carries an actual stage split. */
export function hasSleepStages(day: SleepDay): boolean {
  const s = day.stages;
  return s.deep + s.rem + s.core > 0;
}

export function bloodPressureSeries(): BloodPressureObservation[] {
  return ((ACTIVE.metrics['blood_pressure'] as BloodPressureObservation[]) || [])
    .map(r => ({ ...r, date: canonicalDayKey(r.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function bloodOxygenSeries(): DayPoint[] {
  return metricSeries('blood_oxygen_saturation');
}

export function workoutList(): WorkoutRecord[] {
  return [...(ACTIVE.workouts || [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/**
 * Series dispatcher: metrics that are not plain {date,qty} records are mapped to
 * their headline numeric field so that every consumer sees a consistent shape.
 *
 * `sleep_analysis` is TIME ASLEEP, so it carries only the nights whose record
 * has a stage split. A record with an in-bed window and no stages is an
 * in-bed-only record, not a night of zero sleep, and must never enter a
 * time-asleep mean. It is still a night, so it is counted in coverage and it is
 * still included in `sleep_in_bed`, where in-bed time is the statistic.
 */
export function seriesFor(metricId: string): DayPoint[] {
  if (metricId === 'sleep_analysis') {
    return sleepSeries()
      .filter(hasSleepStages)
      .map(s => ({
        key: s.key,
        value: s.asleepMinutes,
        source: s.source,
      }));
  }
  if (metricId === 'sleep_in_bed') {
    return sleepSeries().map(s => ({
      key: s.key,
      value: s.inBedMinutes,
      source: s.source,
    }));
  }
  if (metricId === 'blood_pressure') {
    return bloodPressureSeries().map(b => ({
      key: b.date,
      value: b.systolic,
      source: b.source,
    }));
  }
  return metricSeries(metricId);
}

export function seriesInWindow(metricId: string, win: DayWindow): DayPoint[] {
  return selectByWindow(seriesFor(metricId), win);
}

/**
 * Sum-strategy metrics accumulate during the day, so the current (reference) day
 * is incomplete and must never be compared with a complete prior day.
 * Days whose sample is explicitly known to be partial are reported too.
 */
export function isAccumulating(meta: MetricDefinition | undefined): boolean {
  return meta?.aggregationStrategy === 'sum';
}

export function excludePartialForSum(
  points: DayPoint[],
  meta: MetricDefinition | undefined
): { values: number[]; excludedDays: string[] } {
  if (!isAccumulating(meta)) return { values: points.map(p => p.value), excludedDays: [] };
  const excludedDays: string[] = [];
  const values: number[] = [];
  for (const p of points) {
    const partial = p.partial === true || p.key === REFERENCE_KEY;
    if (partial) excludedDays.push(p.key);
    else values.push(p.value);
  }
  return { values, excludedDays };
}

export function latestPoint(points: DayPoint[]): DayPoint | undefined {
  return points.length ? points[points.length - 1] : undefined;
}

export function pointOn(points: DayPoint[], key: string): DayPoint | undefined {
  return points.find(p => p.key === key);
}

/** Metrics the active dataset can actually render. */
export function metricHasData(metricId: string): boolean {
  return seriesFor(metricId).length > 0;
}

export function metricObservationCount(metricId: string): number {
  return seriesFor(metricId).length;
}

/**
 * Why a registered metric shows no values, in the vocabulary of the active mode.
 * Demo fixtures and a live history have genuinely different reasons, and a live
 * gap is never described as a demo gap.
 */
export function unavailableReasonFor(metricId: string): string {
  const meta = getMetric(metricId);
  if (MODE === 'live') {
    return 'Not recorded in your Health Auto Export history.';
  }
  return meta?.unavailableReason ?? 'No observations of this metric are present in the dataset.';
}

export function metaFor(metricId: string): MetricDefinition | undefined {
  return getMetric(metricId);
}

/** One sentence naming where the active numbers come from. */
export function datasetProvenanceSentence(): string {
  const meta = META;
  if (meta.live) {
    return `Values are read from the Health Auto Export API on the server and cover ${meta.windowStartKey} to ${meta.referenceKey} in ${meta.timezone}.`;
  }
  return `Source records are the committed demo dataset ending ${meta.referenceKey}.`;
}

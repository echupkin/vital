// ── Health Auto Export → Vital internal dataset ─────────
//
// One pure, deterministic module converts recorded upstream records into the
// exact internal shape the rest of the app already reads (see
// `health-fixtures.json`): `metrics` series, `workouts`, `coverage`, plus the
// window/reference metadata. Pages and components are unchanged by design.
//
// This module performs NO I/O: the HTTP client lives in `hae.ts`, the cache in
// `cache.ts`, and the live adapter in `live.ts`. Everything here is testable
// against recorded samples without a network.
//
// Responsibilities, in order:
//   1. metric-specific aggregation from interval records to one value per day
//   2. source de-duplication (see `sources.ts` for the stated rule)
//   3. unit conversion to the registry's canonical unit (`units.ts`)
//   4. coverage / provenance metadata
//   5. sleep composition and blood-pressure pairing

import { getMetric } from '../metrics/registry';
import type {
  BloodPressureObservation,
  HealthFixtures,
  MetricCoverage,
  MetricObservation,
  SleepObservation,
  WorkoutRecord,
} from '../metrics/types';
import { dayKey, diffDays } from '../analytics/windows';
import { convertUnit } from './units';
import {
  dedupeByInterval,
  dedupeSameInstant,
  sourceLabel,
  sourceRuleFor,
  splitSources,
  SOURCE_DEDUPE_RULE,
  sourceRuleExplanationFor,
  type SourcedRecord,
} from './sources';

// ── Upstream record shapes (only the fields actually present) ──

export interface RawSimpleRecord {
  date: string;
  source?: string;
  units?: string;
  qty?: number;
  [key: string]: unknown;
}

export interface RawHeartRateRecord {
  date: string;
  source?: string;
  units?: string;
  Avg?: number;
  Max?: number;
  Min?: number;
}

export interface RawSleepRecord {
  date: string;
  source?: string;
  units?: string;
  /** Hours, per the verified contract. */
  awake?: number;
  core?: number;
  deep?: number;
  rem?: number;
  inBed?: number;
  inBedStart?: string;
  inBedEnd?: string;
  sleepStart?: string;
  sleepEnd?: string;
}

export interface RawBloodPressureRecord {
  date: string;
  source?: string;
  units?: string;
  systolic?: number;
  diastolic?: number;
}

export interface RawWorkoutRecord {
  id?: string;
  workout_type?: string;
  start_time?: string;
  end_time?: string;
  duration_minutes?: number;
  calories_burned?: number;
}

// ── Metric mapping table ────────────────────────────────
//
// Every upstream metric Vital reads, the registry metric it becomes, how one day
// is aggregated from that metric's interval records, and how often the source
// records it. Metrics the verified contract shows as empty upstream
// (walking_heart_rate, vo2max, waist_circumference, dietary_caffeine,
// dietary_protein, dietary_water, blood_glucose, …) are deliberately NOT in this
// table: no request is made for data that is known to be absent, and the app
// renders them from the registry as "not recorded".

export type DayAggregation = 'sum' | 'mean' | 'latest';

export interface MetricMapping {
  /** Upstream metric id, exactly as the API spells it. */
  hae: string;
  /** Registry metric id. */
  metricId: string;
  /** Which upstream field carries the value. */
  field: 'qty' | 'heart_rate' | 'systolic';
  aggregation: DayAggregation;
  samplingFrequency: string;
}

export const METRIC_MAPPINGS: MetricMapping[] = [
  // Cardiovascular
  { hae: 'resting_heart_rate', metricId: 'resting_heart_rate', field: 'qty', aggregation: 'mean', samplingFrequency: 'daily' },
  { hae: 'heart_rate_variability', metricId: 'heart_rate_variability', field: 'qty', aggregation: 'mean', samplingFrequency: 'several per day' },
  { hae: 'heart_rate', metricId: 'heart_rate', field: 'heart_rate', aggregation: 'mean', samplingFrequency: 'continuous' },
  { hae: 'cardio_recovery', metricId: 'cardio_recovery', field: 'qty', aggregation: 'latest', samplingFrequency: 'occasional' },
  // Respiratory / recovery
  { hae: 'respiratory_rate', metricId: 'respiratory_rate', field: 'qty', aggregation: 'mean', samplingFrequency: 'nightly' },
  { hae: 'blood_oxygen_saturation', metricId: 'blood_oxygen_saturation', field: 'qty', aggregation: 'mean', samplingFrequency: 'several per day' },
  { hae: 'breathing_disturbances', metricId: 'breathing_disturbances', field: 'qty', aggregation: 'sum', samplingFrequency: 'nightly' },
  { hae: 'apple_sleeping_wrist_temperature', metricId: 'apple_sleeping_wrist_temperature', field: 'qty', aggregation: 'mean', samplingFrequency: 'nightly' },
  // Activity
  { hae: 'step_count', metricId: 'step_count', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'walking_running_distance', metricId: 'distance_walking_running', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'flights_climbed', metricId: 'flights_climbed', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'apple_exercise_time', metricId: 'apple_exercise_time', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'apple_stand_hour', metricId: 'apple_stand_hours', field: 'qty', aggregation: 'sum', samplingFrequency: 'hourly' },
  { hae: 'active_energy', metricId: 'active_energy', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'basal_energy_burned', metricId: 'basal_energy_burned', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'time_in_daylight', metricId: 'time_in_daylight', field: 'qty', aggregation: 'sum', samplingFrequency: 'intraday' },
  { hae: 'physical_effort', metricId: 'physical_effort', field: 'qty', aggregation: 'mean', samplingFrequency: 'intraday' },
  // Body — sparse measurements, never presented as daily observations.
  { hae: 'weight_body_mass', metricId: 'weight_body_mass', field: 'qty', aggregation: 'latest', samplingFrequency: 'occasional weigh-in' },
  { hae: 'body_mass_index', metricId: 'body_mass_index', field: 'qty', aggregation: 'latest', samplingFrequency: 'occasional weigh-in' },
  { hae: 'body_fat_percentage', metricId: 'body_fat_percentage', field: 'qty', aggregation: 'latest', samplingFrequency: 'occasional weigh-in' },
  { hae: 'lean_body_mass', metricId: 'lean_body_mass', field: 'qty', aggregation: 'latest', samplingFrequency: 'occasional weigh-in' },
  // Nutrition — logged intake from a scale app, not a food diary.
  { hae: 'dietary_energy', metricId: 'dietary_energy', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  { hae: 'carbohydrates', metricId: 'dietary_carbs', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  { hae: 'total_fat', metricId: 'dietary_fat_total', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  { hae: 'dietary_sugar', metricId: 'dietary_sugar', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  // These three are registered metrics whose nutrition summaries the analyst's
  // general (free-form) selection asks for. Without a mapping here the live
  // dataset can never carry them, however much of them was logged.
  { hae: 'protein', metricId: 'dietary_protein', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  { hae: 'caffeine', metricId: 'dietary_caffeine', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
  { hae: 'water', metricId: 'dietary_water', field: 'qty', aggregation: 'sum', samplingFrequency: 'logged' },
];

export const SLEEP_HAE_METRIC = 'sleep_analysis';
export const BLOOD_PRESSURE_HAE_METRIC = 'blood_pressure';

export function mappingFor(metricId: string): MetricMapping | undefined {
  return METRIC_MAPPINGS.find(m => m.metricId === metricId);
}

// ── Aggregation ─────────────────────────────────────────

/** Round to `dp` decimals without float noise (e.g. 0.30000000000000004). */
export function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export interface IntervalValue {
  date: string;
  value: number;
  source: string;
}

/**
 * One value per calendar day, using the metric's declared aggregation.
 *
 * `partial` marks the reference day for accumulating metrics: the day is still
 * filling up, so the UI must not compare it with a complete day. Missing days
 * produce no point at all — they are never zero.
 */
export function aggregatePerDay(
  values: IntervalValue[],
  aggregation: DayAggregation
): MetricObservation[] {
  const byDay = new Map<string, IntervalValue[]>();
  for (const v of values) {
    const list = byDay.get(v.date);
    if (list) list.push(v);
    else byDay.set(v.date, [v]);
  }

  const out: MetricObservation[] = [];
  for (const [day, group] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const numbers = sorted.map(g => g.value).filter(v => Number.isFinite(v));
    if (numbers.length === 0) continue;
    let qty: number;
    if (aggregation === 'sum') qty = numbers.reduce((a, b) => a + b, 0);
    else if (aggregation === 'latest') qty = numbers[numbers.length - 1];
    else qty = numbers.reduce((a, b) => a + b, 0) / numbers.length;

    const sources = [...new Set(sorted.flatMap(g => splitSources(g.source)))];
    out.push({
      date: day,
      qty: round(qty, 6),
      units: '',
      source: sources.length > 0 ? sources.join(' · ') : 'unattributed source',
    });
  }
  return out;
}

// ── Simple metrics ──────────────────────────────────────

export interface NormalizedMetric {
  metricId: string;
  observations: MetricObservation[];
  coverage: MetricCoverage;
  /** Records read from upstream before de-duplication. */
  recordsRead: number;
  recordsKept: number;
  /** Device names that survived de-duplication. */
  sources: string[];
  /** Intervals where a lower-priority device's records were set aside. */
  droppedIntervals: number;
  droppedRecords: number;
}

export interface NormalizeContext {
  /** Display timezone for calendar-day assignment. */
  tz: string;
  /** The dataset's reference (current) day key. */
  referenceKey: string;
  /** First day of the dataset window (for expected-day counts). */
  windowStartKey: string;
}

function pickField(record: RawSimpleRecord, field: MetricMapping['field']): number | null {
  if (field === 'heart_rate') {
    const avg = (record as RawHeartRateRecord).Avg;
    return typeof avg === 'number' && Number.isFinite(avg) ? avg : null;
  }
  const raw = record.qty;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Normalize one simple (non-sleep, non-blood-pressure) metric.
 * Returns null when the upstream metric is not registered or has no records.
 */
export function normalizeSimpleMetric(
  mapping: MetricMapping,
  records: RawSimpleRecord[],
  ctx: NormalizeContext
): NormalizedMetric | null {
  const meta = getMetric(mapping.metricId);
  if (!meta) return null;

  const rule = sourceRuleFor(mapping.metricId);
  const dayOf = (r: RawSimpleRecord) => dayKey(r.date, ctx.tz);

  const converted: (SourcedRecord & { value: number })[] = [];
  for (const record of records) {
    const raw = pickField(record, mapping.field);
    if (raw == null) continue;
    const rawUnit = typeof record.units === 'string' && record.units.length > 0 ? record.units : meta.canonicalUnit;
    const value = convertUnit(raw, rawUnit, meta.canonicalUnit);
    if (!Number.isFinite(value)) continue;
    converted.push({ date: record.date, source: record.source ?? '', value });
  }

  const { kept, dropped, keptSources } = dedupeByInterval(converted, rule, dayOf);
  const { kept: unique, duplicates } = dedupeSameInstant(kept, rule);

  const observations = aggregatePerDay(
    unique.map(r => ({ date: dayOf(r), value: r.value, source: r.source ?? '' })),
    mapping.aggregation
  ).map(o => ({ ...o, units: meta.canonicalUnit }));

  // The reference day is still accumulating for sum metrics; flag it so it is
  // excluded from every comparison rather than compared with a complete day.
  if (mapping.aggregation === 'sum') {
    for (const o of observations) if (o.date === ctx.referenceKey) o.partial = true;
  }

  const observedDays = observations.length;
  const allSources = [
    ...new Set([...keptSources, ...converted.flatMap(r => splitSources(r.source))]),
  ].sort();

  return {
    metricId: mapping.metricId,
    observations,
    coverage: {
      firstObservation: unique.length > 0 ? unique[0].date : '',
      lastObservation: unique.length > 0 ? unique[unique.length - 1].date : '',
      observedDays,
      expectedDays: diffDays(ctx.windowStartKey, ctx.referenceKey) + 1,
      samplingFrequency: mapping.samplingFrequency,
      sourceNames: allSources,
    },
    recordsRead: records.length,
    recordsKept: unique.length,
    sources: allSources,
    droppedIntervals: dropped.length,
    droppedRecords: dropped.reduce((a, d) => a + d.droppedCount, 0) + duplicates,
  };
}

// ── Heart rate: daily Avg / Max / Min ───────────────────

export interface DailyHeartRate {
  date: string;
  avg: number;
  max: number;
  min: number;
  count: number;
  source: string;
}

export function normalizeHeartRateDaily(
  records: RawHeartRateRecord[],
  ctx: NormalizeContext
): DailyHeartRate[] {
  const meta = getMetric('heart_rate');
  const canonical = meta?.canonicalUnit ?? 'bpm';
  const byDay = new Map<string, { avg: number[]; max: number[]; min: number[]; sources: string[] }>();
  for (const r of records) {
    if (typeof r.Avg !== 'number') continue;
    const key = dayKey(r.date, ctx.tz);
    const rawUnit = r.units ?? 'count/min';
    const entry = byDay.get(key) ?? { avg: [], max: [], min: [], sources: [] };
    entry.avg.push(convertUnit(r.Avg, rawUnit, canonical));
    if (typeof r.Max === 'number') entry.max.push(convertUnit(r.Max, rawUnit, canonical));
    if (typeof r.Min === 'number') entry.min.push(convertUnit(r.Min, rawUnit, canonical));
    entry.sources.push(...splitSources(r.source));
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({
      date,
      avg: round(e.avg.reduce((a, b) => a + b, 0) / e.avg.length, 2),
      max: e.max.length ? round(Math.max(...e.max), 2) : NaN,
      min: e.min.length ? round(Math.min(...e.min), 2) : NaN,
      count: e.avg.length,
      source: [...new Set(e.sources)].join(' · ') || 'unattributed source',
    }));
}

/**
 * The registry series for heart rate is the daily average; the daily maximum and
 * minimum are attached to the same record so the values are available without a
 * second series.
 */
export function heartRateObservations(daily: DailyHeartRate[]): (MetricObservation & {
  dailyAvg: number;
  dailyMax: number;
  dailyMin: number;
  readings: number;
})[] {
  return daily.map(d => ({
    date: d.date,
    qty: d.avg,
    units: 'bpm',
    source: d.source,
    dailyAvg: d.avg,
    dailyMax: d.max,
    dailyMin: d.min,
    readings: d.count,
  }));
}

// ── Sleep ───────────────────────────────────────────────

/**
 * The identity of a sleep episode: its in-bed window plus its recorded totals.
 *
 * Deliberately NOT the export `date`. Health Auto Export has exported the same
 * episode twice under two different `date` values with an identical window and
 * identical stage totals; treating those as two nights would double-count the
 * night in every average. A record with no window falls back to its export
 * instant, so two exports without a window are never merged on totals alone.
 */
export function sleepRepeatIdentity(record: RawSleepRecord): string {
  const start = record.inBedStart ?? record.sleepStart;
  const end = record.inBedEnd ?? record.sleepEnd;
  if (!start || !end) return `date:${record.date}`;
  const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return [
    start,
    end,
    num(record.deep),
    num(record.rem),
    num(record.core),
    num(record.awake),
    num(record.inBed),
  ].join('|');
}

/**
 * One episode per night.
 *
 *  * asleep  = core + deep + rem (hours → minutes)
 *  * awake   = the separately recorded awake time
 *  * in bed  = computed from `inBedStart` → `inBedEnd`, NOT from the `inBed`
 *              field, which is 0 in the recorded data even when the timestamps
 *              are present
 *  * the episode is assigned to its waking date (`date` is already the waking day)
 *
 * A night whose deep + core + rem is 0 is an IN-BED-ONLY record: the source
 * recorded a window but no sleep-stage split. It keeps its in-bed total and is
 * counted separately; it is never read as a night of zero sleep (see
 * `hasSleepStages` in `dataset.ts`, which every time-asleep aggregate filters on).
 *
 * Exact repeats collapse to one night using the project's source-priority
 * convention (`dedupeSameInstant` + `SLEEP_REPEAT_RULE` in `sources.ts`).
 */
export function normalizeSleep(records: RawSleepRecord[], ctx: NormalizeContext): SleepObservation[] {
  const rule = sourceRuleFor('sleep_analysis');
  const sourced = records.map(r => ({ ...r, source: r.source ?? '' }));
  const { kept } = dedupeSameInstant(sourced, rule, sleepRepeatIdentity);

  const out: SleepObservation[] = [];
  for (const r of kept) {
    const key = dayKey(r.date, ctx.tz);
    const toMin = (x: number | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x * 60 : 0);

    const deep = toMin(r.deep);
    const rem = toMin(r.rem);
    const core = toMin(r.core);
    const awake = toMin(r.awake);
    const asleepMinutes = round(deep + rem + core, 1);

    const start = r.inBedStart ?? r.sleepStart;
    const end = r.inBedEnd ?? r.sleepEnd;
    let inBedMinutes = NaN;
    if (start && end) {
      const ms = Date.parse(end) - Date.parse(start);
      if (Number.isFinite(ms) && ms > 0) inBedMinutes = round(ms / 60000, 1);
    }
    if (!Number.isFinite(inBedMinutes) || inBedMinutes < asleepMinutes) {
      // Fall back to the recorded asleep+awake window only when the timestamps
      // are missing or inconsistent; never invent a longer night than recorded.
      inBedMinutes = round(asleepMinutes + awake, 1);
    }

    out.push({
      date: key,
      bedtime: start ?? '',
      wakeTime: end ?? '',
      // Total protected sleep window: time asleep plus time awake inside it.
      durationMinutes: round(asleepMinutes + awake, 1),
      inBedMinutes,
      asleepMinutes,
      stages: {
        deep: round(deep, 1),
        rem: round(rem, 1),
        core: round(core, 1),
        awake: round(awake, 1),
      },
      source: sourceLabel(r.source),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Blood pressure ──────────────────────────────────────

/** Every reading is kept individually: systolic/diastolic is a paired value. */
export function normalizeBloodPressure(
  records: RawBloodPressureRecord[],
  ctx: NormalizeContext
): BloodPressureObservation[] {
  const out: BloodPressureObservation[] = [];
  for (const r of records) {
    if (typeof r.systolic !== 'number' || typeof r.diastolic !== 'number') continue;
    out.push({
      date: dayKey(r.date, ctx.tz),
      systolic: r.systolic,
      diastolic: r.diastolic,
      units: 'mmHg',
      source: sourceLabel(r.source),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Workouts ────────────────────────────────────────────

/**
 * Workouts carry only what the API provides: type, start/end, duration and
 * calories. There is no distance and no heart rate, so none is invented; the UI
 * shows those fields as "not recorded for this session".
 *
 * `duration_minutes` arrives as a long float (39.1697040339311) and is rounded
 * to one decimal; calories are rounded to whole kcal.
 */
export function normalizeWorkouts(records: RawWorkoutRecord[], ctx: NormalizeContext): WorkoutRecord[] {
  const byId = new Map<string, WorkoutRecord>();
  for (const r of records) {
    if (!r.start_time || !r.end_time || !r.workout_type) continue;
    const id = r.id && String(r.id).trim().length > 0
      ? String(r.id)
      : `${r.workout_type}:${r.start_time}`;
    const record: WorkoutRecord = {
      id,
      workout_type: r.workout_type,
      start_time: r.start_time,
      end_time: r.end_time,
      duration_minutes: round(
        typeof r.duration_minutes === 'number' ? r.duration_minutes : minutesBetween(r.start_time, r.end_time),
        1
      ),
      calories_burned: Math.round(
        typeof r.calories_burned === 'number' ? r.calories_burned : NaN
      ),
      source: 'Health Auto Export',
    };
    if (!Number.isFinite(record.calories_burned)) record.calories_burned = 0;
    // The same session can be exported twice; the id is the identity.
    if (!byId.has(id)) byId.set(id, record);
  }
  void ctx;
  return [...byId.values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
}

function minutesBetween(start: string, end: string): number {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms > 0 ? ms / 60000 : 0;
}

// ── Dataset assembly ────────────────────────────────────

export interface RawMetricBundle {
  /** Upstream metric id → its records. */
  metrics: Record<string, unknown[]>;
  workouts: RawWorkoutRecord[];
}

export interface LiveDatasetStats {
  recordsRead: number;
  observations: number;
  metrics: number;
  workouts: number;
  droppedRecords: number;
  droppedIntervals: number;
}

export interface BuildOptions {
  tz: string;
  /** Instant the dataset was assembled (ISO). */
  now: string;
  /** Reference (current) day key; defaults to the day of `now` in `tz`. */
  referenceKey?: string;
}

export interface BuiltDataset {
  dataset: HealthFixtures;
  stats: LiveDatasetStats;
  /** Per-metric provenance rows, for the coverage table and the pipeline panel. */
  provenance: ProvenanceRow[];
}

export interface ProvenanceRow {
  metricId: string;
  haeMetric: string;
  aggregation: DayAggregation | 'sleep' | 'blood_pressure';
  canonicalUnit: string;
  sources: string[];
  observations: number;
  recordsRead: number;
  recordsKept: number;
  firstDay: string | null;
  lastDay: string | null;
  unitConversions: string[];
  dedupeRule: string;
}

const AGGREGATION_LABEL: Record<string, string> = {
  sum: 'sum per day',
  mean: 'mean per day',
  latest: 'latest per day',
};

/** Unit conversion labels applied for a mapping, for the provenance table. */
function conversionsFor(mapping: MetricMapping, records: RawSimpleRecord[]): string[] {
  const meta = getMetric(mapping.metricId);
  if (!meta) return [];
  const seen = new Set<string>();
  for (const r of records) {
    const from = r.units ?? meta.canonicalUnit;
    if (from !== meta.canonicalUnit) seen.add(`${from} → ${meta.canonicalUnit}`);
  }
  return [...seen].sort();
}

export function buildLiveDataset(raw: RawMetricBundle, options: BuildOptions): BuiltDataset {
  const tz = options.tz;
  const now = options.now;
  const referenceKey = options.referenceKey ?? dayKey(now, tz);

  // Establish the dataset window from the earliest observation of everything
  // that has one, so coverage percentages are computed against real bounds.
  const firstInstants: string[] = [];
  for (const records of Object.values(raw.metrics)) {
    for (const r of records) {
      const date = (r as { date?: string }).date;
      if (typeof date === 'string' && Number.isFinite(Date.parse(date))) firstInstants.push(date);
    }
  }
  for (const w of raw.workouts) {
    if (typeof w.start_time === 'string') firstInstants.push(w.start_time);
  }
  firstInstants.sort();
  const windowStartKey = firstInstants.length > 0 ? dayKey(firstInstants[0], tz) : referenceKey;

  const ctx: NormalizeContext = { tz, referenceKey, windowStartKey };

  const metrics: Record<string, MetricObservation[] | SleepObservation[] | BloodPressureObservation[]> = {};
  const coverage: Record<string, MetricCoverage> = {};
  const provenance: ProvenanceRow[] = [];
  let recordsRead = 0;
  let observations = 0;
  let droppedRecords = 0;
  let droppedIntervals = 0;

  for (const mapping of METRIC_MAPPINGS) {
    const records = (raw.metrics[mapping.hae] ?? []) as RawSimpleRecord[];
    const normalized = normalizeSimpleMetric(mapping, records, ctx);
    if (!normalized) continue;
    const meta = getMetric(mapping.metricId);
    metrics[mapping.metricId] = normalized.observations;
    coverage[mapping.metricId] = normalized.coverage;
    recordsRead += normalized.recordsRead;
    observations += normalized.observations.length;
    droppedRecords += normalized.droppedRecords;
    droppedIntervals += normalized.droppedIntervals;
    provenance.push({
      metricId: mapping.metricId,
      haeMetric: mapping.hae,
      aggregation: mapping.aggregation,
      canonicalUnit: meta?.canonicalUnit ?? '',
      sources: normalized.sources,
      observations: normalized.observations.length,
      recordsRead: normalized.recordsRead,
      recordsKept: normalized.recordsKept,
      firstDay: normalized.observations[0]?.date ?? null,
      lastDay: normalized.observations[normalized.observations.length - 1]?.date ?? null,
      unitConversions: conversionsFor(mapping, records),
      dedupeRule: sourceRuleExplanationFor(mapping.metricId),
    });
  }

  // Sleep
  const sleepRaw = (raw.metrics[SLEEP_HAE_METRIC] ?? []) as RawSleepRecord[];
  if (sleepRaw.length > 0) {
    const sleep = normalizeSleep(sleepRaw, ctx);
    metrics['sleep_analysis'] = sleep;
    coverage['sleep_analysis'] = coverageOf(
      sleep.map(s => s.date),
      sleepRaw.map(r => r.date).sort(),
      'nightly',
      sleepRaw.flatMap(r => splitSources(r.source)),
      ctx
    );
    observations += sleep.length;
    recordsRead += sleepRaw.length;
    provenance.push({
      metricId: 'sleep_analysis',
      haeMetric: SLEEP_HAE_METRIC,
      aggregation: 'sleep',
      canonicalUnit: 'min',
      sources: [...new Set(sleepRaw.flatMap(r => splitSources(r.source)))].sort(),
      observations: sleep.length,
      recordsRead: sleepRaw.length,
      recordsKept: sleep.length,
      firstDay: sleep[0]?.date ?? null,
      lastDay: sleep[sleep.length - 1]?.date ?? null,
      unitConversions: ['hr → min'],
      dedupeRule: sourceRuleExplanationFor('sleep_analysis'),
    });
  }

  // Blood pressure
  const bpRaw = (raw.metrics[BLOOD_PRESSURE_HAE_METRIC] ?? []) as RawBloodPressureRecord[];
  if (bpRaw.length > 0) {
    const bp = normalizeBloodPressure(bpRaw, ctx);
    metrics['blood_pressure'] = bp;
    coverage['blood_pressure'] = coverageOf(
      bp.map(b => b.date),
      bpRaw.map(r => r.date).sort(),
      'occasional',
      bpRaw.flatMap(r => splitSources(r.source)),
      ctx
    );
    observations += bp.length;
    recordsRead += bpRaw.length;
    provenance.push({
      metricId: 'blood_pressure',
      haeMetric: BLOOD_PRESSURE_HAE_METRIC,
      aggregation: 'blood_pressure',
      canonicalUnit: 'mmHg',
      sources: [...new Set(bpRaw.flatMap(r => splitSources(r.source)))].sort(),
      observations: bp.length,
      recordsRead: bpRaw.length,
      recordsKept: bp.length,
      firstDay: bp[0]?.date ?? null,
      lastDay: bp[bp.length - 1]?.date ?? null,
      unitConversions: [],
      dedupeRule: sourceRuleExplanationFor('blood_pressure'),
    });
  }

  // Heart rate: daily Avg / Max / Min, series value = Avg.
  const hrRaw = (raw.metrics.heart_rate ?? []) as RawHeartRateRecord[];
  if (hrRaw.length > 0) {
    const daily = normalizeHeartRateDaily(hrRaw, ctx);
    const obs = heartRateObservations(daily);
    metrics['heart_rate'] = obs;
    coverage['heart_rate'] = coverageOf(
      daily.map(d => d.date),
      hrRaw.map(r => r.date).sort(),
      'continuous',
      hrRaw.flatMap(r => splitSources(r.source)),
      ctx
    );
    observations += obs.length;
    recordsRead += hrRaw.length;
    provenance.push({
      metricId: 'heart_rate',
      haeMetric: 'heart_rate',
      aggregation: 'mean',
      canonicalUnit: 'bpm',
      sources: [...new Set(hrRaw.flatMap(r => splitSources(r.source)))].sort(),
      observations: obs.length,
      recordsRead: hrRaw.length,
      recordsKept: hrRaw.length,
      firstDay: daily[0]?.date ?? null,
      lastDay: daily[daily.length - 1]?.date ?? null,
      unitConversions: ['count/min → bpm'],
      dedupeRule: sourceRuleExplanationFor('heart_rate'),
    });
  }

  const workouts = normalizeWorkouts(raw.workouts, ctx);

  const asOf = newestInstant(raw);

  const dataset: HealthFixtures = {
    referenceDate: now,
    windowStart: firstInstants.length > 0 ? firstInstants[0] : now,
    windowEnd: asOf ?? now,
    days: diffDays(windowStartKey, referenceKey) + 1,
    timezone: tz,
    metrics,
    workouts,
    coverage,
  };

  return {
    dataset,
    provenance,
    stats: {
      recordsRead,
      observations,
      metrics: Object.keys(metrics).length,
      workouts: workouts.length,
      droppedRecords,
      droppedIntervals,
    },
  };
}

function coverageOf(
  dayKeys: string[],
  instants: string[],
  samplingFrequency: string,
  sources: string[],
  ctx: NormalizeContext
): MetricCoverage {
  const uniqueDays = [...new Set(dayKeys)].sort();
  return {
    firstObservation: instants.length > 0 ? instants[0] : uniqueDays[0] ?? '',
    lastObservation: instants.length > 0 ? instants[instants.length - 1] : uniqueDays[uniqueDays.length - 1] ?? '',
    observedDays: uniqueDays.length,
    expectedDays: diffDays(ctx.windowStartKey, ctx.referenceKey) + 1,
    samplingFrequency,
    sourceNames: [...new Set(sources)].sort(),
  };
}

/** The newest observation instant in the bundle — the real "data as of" time. */
export function newestInstant(raw: RawMetricBundle): string | null {
  let newest: string | null = null;
  const consider = (iso: unknown) => {
    if (typeof iso !== 'string') return;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    if (newest === null || t > Date.parse(newest)) newest = iso;
  };
  for (const records of Object.values(raw.metrics)) {
    for (const r of records) consider((r as { date?: string }).date);
  }
  for (const w of raw.workouts) consider(w.end_time ?? w.start_time);
  return newest;
}

/** The day window the dataset covers, as day keys. */
export function datasetWindow(dataset: HealthFixtures, tz: string): { startKey: string; endKey: string } {
  return {
    startKey: dayKey(dataset.windowStart, tz),
    endKey: dayKey(dataset.referenceDate, tz),
  };
}

export { SOURCE_DEDUPE_RULE };
export function aggregationLabel(aggregation: string): string {
  return AGGREGATION_LABEL[aggregation] ?? aggregation;
}

/** Day key of "today" in the dataset timezone — the honest reference day. */
export function todayKey(tz: string, now: Date = new Date()): string {
  return dayKey(now.toISOString(), tz);
}

export { dayKey, diffDays };

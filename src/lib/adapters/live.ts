// ── Live Health Data Adapter (Health Auto Export) ───────
//
// SERVER-SIDE ONLY. This module reads HAE_API_URL / HAE_API_KEY from the process
// environment, fetches bounded windows from the Health Auto Export API, and
// normalizes them into the same internal dataset shape the demo fixtures use
// (see `normalize.ts`). It is never imported by a component.
//
// Design decisions required by the integration boundary in SPEC §10:
//
//   * Bounded windows. Every upstream request carries `from`/`to`. The window is
//     a rolling lookback (LIVE_LOOKBACK_DAYS) rather than "everything".
//   * Fetch once, aggregate server-side. Each metric is fetched once per cache
//     period and reduced to one value per day, so the heavy series (heart_rate
//     32k, basal_energy_burned 66k, active_energy 39k records) never reach a page
//     in raw form.
//   * Cache + single flight. `loadLiveDataset` is wrapped in a TTL cache with
//     single-flight, so N concurrent page loads cause one upstream pass. Once a
//     dataset is held, a lapsed TTL is served stale while it refreshes in the
//     background: only a genuinely cold process blocks on the upstream pass.
//   * No silent fallback. Any failure throws; callers show a connection-error
//     state and never substitute demo data.

import type {
  BloodPressureObservation,
  HealthFixtures,
  MetricCoverage,
  MetricObservation,
  SleepObservation,
  WorkoutRecord,
} from '../metrics/types';
import { getMetric } from '../metrics/registry';
import { addDays, dayKey, diffDays } from '../analytics/windows';
import type { HealthDataAdapter, MetricQuery } from './types';
import { HaeError, fetchMetricRecords, fetchWorkouts, readHaeConfig } from './hae';
import { liveCache, liveCacheTtlMs } from './cache';
import {
  BLOOD_PRESSURE_HAE_METRIC,
  METRIC_MAPPINGS,
  SLEEP_HAE_METRIC,
  type LiveDatasetStats,
  type MetricMapping,
  type ProvenanceRow,
  type RawBloodPressureRecord,
  type RawSimpleRecord,
  type RawSleepRecord,
  type RawWorkoutRecord,
  normalizeBloodPressure,
  normalizeSimpleMetric,
  normalizeSleep,
  normalizeWorkouts,
} from './normalize';
import { splitSources, sourceRuleExplanationFor } from './sources';

/** Rolling window fetched from upstream. Covers the observed 56-day history many times over. */
export const LIVE_LOOKBACK_DAYS = 400;
export const DEFAULT_TIMEZONE = 'UTC';

/** Upstream metrics are fetched a few at a time so a cold load stays bounded. */
const FETCH_CONCURRENCY = 3;

export interface LiveDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Override the rolling window (tests use a small one). */
  lookbackDays?: number;
  /** Skip the process-wide cache (tests, and an explicit refresh). */
  bypassCache?: boolean;
}

/** Outcome of the boot-time cache warm-up: reported, never thrown. */
export type WarmUpOutcome = { ok: true } | { ok: false; reason: string };

export interface LiveDatasetResult {
  dataset: HealthFixtures;
  provenance: ProvenanceRow[];
  stats: LiveDatasetStats;
  mode: 'live';
  /** Newest observation instant found upstream — the real "data as of" time. */
  asOf: string | null;
  generatedAt: string;
  /** Day key of the current day in the dataset timezone. */
  referenceKey: string;
  /** First day the returned data covers. */
  windowStartKey: string;
  timezone: string;
  sources: string[];
  cacheTtlSeconds: number;
}

function resolveTimezone(env: NodeJS.ProcessEnv): string {
  const tz = (env.VITAL_TIMEZONE ?? '').trim();
  return tz || DEFAULT_TIMEZONE;
}

/** The window every upstream request is bounded by. */
export function upstreamWindow(referenceKey: string, lookbackDays: number): { from: string; to: string } {
  return {
    from: `${addDays(referenceKey, -lookbackDays)}T00:00:00.000Z`,
    to: `${addDays(referenceKey, 1)}T00:00:00.000Z`,
  };
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, () => worker()));
  return results;
}

function asHaeError(error: unknown): HaeError {
  if (error instanceof HaeError) return error;
  return new HaeError(
    error instanceof Error ? error.message : 'The Health Auto Export API request failed.',
    'network_error'
  );
}

function firstDayKey(dayKeys: string[], fallback: string): string {
  const sorted = [...dayKeys].sort();
  return sorted[0] ?? fallback;
}

function coverageFrom(
  dayKeys: string[],
  instants: string[],
  samplingFrequency: string,
  sources: string[],
  expectedDays: number
): MetricCoverage {
  const unique = [...new Set(dayKeys)].sort();
  const sortedInstants = [...instants].filter(i => typeof i === 'string' && i.length > 0).sort();
  return {
    firstObservation: sortedInstants[0] ?? unique[0] ?? '',
    lastObservation: sortedInstants[sortedInstants.length - 1] ?? unique[unique.length - 1] ?? '',
    observedDays: unique.length,
    expectedDays,
    samplingFrequency,
    sourceNames: [...new Set(sources)].sort(),
  };
}

function provenanceRow(
  mapping: MetricMapping,
  observations: MetricObservation[],
  records: RawSimpleRecord[],
  normalized: { recordsRead: number; recordsKept: number; sources: string[] }
): ProvenanceRow {
  const canonical = getMetric(mapping.metricId)?.canonicalUnit ?? '';
  const conversions = new Set<string>();
  for (const r of records) {
    const from = typeof r.units === 'string' && r.units.length > 0 ? r.units : canonical;
    if (from !== canonical) conversions.add(`${from} → ${canonical}`);
  }
  return {
    metricId: mapping.metricId,
    haeMetric: mapping.hae,
    aggregation: mapping.aggregation,
    canonicalUnit: canonical,
    sources: normalized.sources,
    observations: observations.length,
    recordsRead: normalized.recordsRead,
    recordsKept: normalized.recordsKept,
    firstDay: observations[0]?.date ?? null,
    lastDay: observations[observations.length - 1]?.date ?? null,
    unitConversions: [...conversions].sort(),
    dedupeRule: sourceRuleExplanationFor(mapping.metricId),
  };
}

/**
 * One upstream pass, normalized and aggregated to one value per day.
 *
 * Each metric's raw response is reduced and dropped immediately, so peak memory
 * is one metric's payload rather than the whole history.
 */
export async function fetchLiveDatasetUncached(deps: LiveDeps = {}): Promise<LiveDatasetResult> {
  const env = deps.env ?? process.env;
  const config = readHaeConfig(env);
  if (!config) {
    throw new HaeError(
      'Live mode is selected but the Health Auto Export API is not configured ' +
        '(HAE_API_URL and HAE_API_KEY must both be set).',
      'not_configured'
    );
  }

  const now = (deps.now ?? (() => new Date()))();
  const timezone = resolveTimezone(env);
  const referenceKey = dayKey(now.toISOString(), timezone);
  const lookbackDays = deps.lookbackDays ?? LIVE_LOOKBACK_DAYS;
  const window = upstreamWindow(referenceKey, lookbackDays);
  const requestDeps = { env, fetchImpl: deps.fetchImpl };
  const ctx = { tz: timezone, referenceKey, windowStartKey: referenceKey };

  let recordsRead = 0;
  let observations = 0;
  let droppedRecords = 0;
  let droppedIntervals = 0;
  const metrics: HealthFixtures['metrics'] = {};
  const coverage: Record<string, MetricCoverage> = {};
  const provenance: ProvenanceRow[] = [];
  const sourceSet = new Set<string>();
  const allDayKeys: string[] = [];
  const allInstants: string[] = [];

  // ── Simple metrics: one bounded request each ──────────
  const simpleTasks = METRIC_MAPPINGS.map(mapping => async () => {
    const records = await fetchMetricRecords(mapping.hae, window, requestDeps);
    recordsRead += records.length;
    for (const r of records) if (typeof r.date === 'string') allInstants.push(r.date);
    const normalized = normalizeSimpleMetric(mapping, records, ctx);
    if (!normalized) return;
    metrics[mapping.metricId] = normalized.observations;
    coverage[mapping.metricId] = normalized.coverage;
    for (const o of normalized.observations) allDayKeys.push(o.date);
    observations += normalized.observations.length;
    droppedRecords += normalized.droppedRecords;
    droppedIntervals += normalized.droppedIntervals;
    for (const s of normalized.sources) sourceSet.add(s);
    provenance.push(provenanceRow(mapping, normalized.observations, records, normalized));
  });

  // ── Special shapes + workouts ─────────────────────────
  let sleepRaw: RawSleepRecord[] = [];
  let bpRaw: RawBloodPressureRecord[] = [];
  let workoutRaw: RawWorkoutRecord[] = [];
  try {
    await runWithConcurrency(simpleTasks, FETCH_CONCURRENCY);
    sleepRaw = (await fetchMetricRecords(SLEEP_HAE_METRIC, window, requestDeps)) as unknown as RawSleepRecord[];
    bpRaw = (await fetchMetricRecords(BLOOD_PRESSURE_HAE_METRIC, window, requestDeps)) as unknown as RawBloodPressureRecord[];
    workoutRaw = (await fetchWorkouts(window, requestDeps)) as RawWorkoutRecord[];
  } catch (error) {
    throw asHaeError(error);
  }

  recordsRead += sleepRaw.length + bpRaw.length + workoutRaw.length;
  allInstants.push(...sleepRaw.map(r => r.date), ...bpRaw.map(r => r.date));
  for (const w of workoutRaw) {
    if (w.start_time) allInstants.push(w.start_time);
    if (w.end_time) allInstants.push(w.end_time);
  }

  const windowStartKey = firstDayKey(
    allInstants.map(i => dayKey(i, timezone)),
    referenceKey
  );
  const expectedDays = diffDays(windowStartKey, referenceKey) + 1;
  // Every coverage record is measured against the real dataset window, which is
  // only known once all metrics have been read.
  for (const id of Object.keys(coverage)) {
    coverage[id] = { ...coverage[id], expectedDays };
  }

  // ── Sleep ─────────────────────────────────────────────
  if (sleepRaw.length > 0) {
    const sleep = normalizeSleep(sleepRaw, ctx);
    metrics['sleep_analysis'] = sleep;
    for (const s of sleep) allDayKeys.push(s.date);
    const sources = [...new Set(sleepRaw.flatMap(r => splitSources(r.source)))].sort();
    sources.forEach(s => sourceSet.add(s));
    coverage['sleep_analysis'] = coverageFrom(
      sleep.map(s => s.date),
      sleepRaw.map(r => r.date),
      'nightly',
      sources,
      expectedDays
    );
    observations += sleep.length;
    provenance.push({
      metricId: 'sleep_analysis',
      haeMetric: SLEEP_HAE_METRIC,
      aggregation: 'sleep',
      canonicalUnit: 'min',
      sources,
      observations: sleep.length,
      recordsRead: sleepRaw.length,
      recordsKept: sleep.length,
      firstDay: sleep[0]?.date ?? null,
      lastDay: sleep[sleep.length - 1]?.date ?? null,
      unitConversions: ['hr → min'],
      dedupeRule: sourceRuleExplanationFor('sleep_analysis'),
    });
  }

  // ── Blood pressure ────────────────────────────────────
  if (bpRaw.length > 0) {
    const bp = normalizeBloodPressure(bpRaw, ctx);
    metrics['blood_pressure'] = bp;
    for (const b of bp) allDayKeys.push(b.date);
    const sources = [...new Set(bpRaw.flatMap(r => splitSources(r.source)))].sort();
    sources.forEach(s => sourceSet.add(s));
    coverage['blood_pressure'] = coverageFrom(
      bp.map(b => b.date),
      bpRaw.map(r => r.date),
      'occasional',
      sources,
      expectedDays
    );
    observations += bp.length;
    provenance.push({
      metricId: 'blood_pressure',
      haeMetric: BLOOD_PRESSURE_HAE_METRIC,
      aggregation: 'blood_pressure',
      canonicalUnit: 'mmHg',
      sources,
      observations: bp.length,
      recordsRead: bpRaw.length,
      recordsKept: bp.length,
      firstDay: bp[0]?.date ?? null,
      lastDay: bp[bp.length - 1]?.date ?? null,
      unitConversions: [],
      dedupeRule: sourceRuleExplanationFor('blood_pressure'),
    });
  }

  // ── Assemble the dataset ──────────────────────────────
  const sortedInstants = [...allInstants].sort();
  const dataset: HealthFixtures = {
    referenceDate: now.toISOString(),
    windowStart: sortedInstants[0] ?? now.toISOString(),
    windowEnd: sortedInstants[sortedInstants.length - 1] ?? now.toISOString(),
    days: expectedDays,
    timezone,
    metrics,
    workouts: normalizeWorkouts(workoutRaw, ctx),
    coverage,
  };

  return {
    dataset,
    provenance,
    stats: {
      recordsRead,
      observations,
      metrics: Object.keys(metrics).length,
      workouts: dataset.workouts.length,
      droppedRecords,
      droppedIntervals,
    },
    mode: 'live',
    asOf: dataset.windowEnd,
    generatedAt: now.toISOString(),
    referenceKey,
    windowStartKey,
    timezone,
    sources: [...sourceSet].sort(),
    cacheTtlSeconds: liveCacheTtlMs(env) / 1000,
  };
}

// ── Cached entry point ──────────────────────────────────

export function liveCacheKey(env: NodeJS.ProcessEnv = process.env): string {
  return `live-dataset:${resolveTimezone(env)}:${LIVE_LOOKBACK_DAYS}`;
}

/**
 * Load the live dataset, cached in-process with a TTL and single-flight:
 * concurrent callers share one upstream pass.
 */
export async function loadLiveDataset(deps: LiveDeps = {}): Promise<LiveDatasetResult> {
  const env = deps.env ?? process.env;
  const key = liveCacheKey(env);
  if (deps.bypassCache) {
    const fresh = await fetchLiveDatasetUncached(deps);
    liveCache.clear(key);
    return fresh;
  }
  return liveCache.getOrLoad(key, () => fetchLiveDatasetUncached(deps));
}

/**
 * Warm the live dataset cache once, at process start.
 *
 * This is a READ-ONLY cache fill, not an ingestion job: it runs exactly the same
 * fetch-and-normalize pass a page load runs, and stores the result in the
 * in-process cache, so the first visitor after a deploy or restart does not pay
 * the cold upstream pass. Nothing is written anywhere, no timer is installed and
 * no schedule exists — one pass per process, plus the stale-while-revalidate
 * refresh after the TTL lapses.
 *
 * Returns immediately; the fill continues in the background. The returned
 * promise resolves when the fill settles — reported as an outcome rather than a
 * rejection, because a failed warm-up must not crash or spam the boot path; the
 * next request retries and shows the real error. `null` means there was nothing
 * to do (demo mode, or the API is not configured).
 */
export function warmLiveDataset(deps: LiveDeps = {}): Promise<WarmUpOutcome> | null {
  const env = deps.env ?? process.env;
  if ((env.VITAL_DATA_MODE ?? '').trim().toLowerCase() !== 'live') return null;
  if (!readHaeConfig(env)) return null;

  const key = liveCacheKey(env);
  // Single-flight: a request that got there first is joined, not duplicated.
  return liveCache
    .getOrLoad(key, () => fetchLiveDatasetUncached(deps))
    .then(
      () => ({ ok: true }) as WarmUpOutcome,
      (error: unknown) =>
        ({
          ok: false,
          reason: error instanceof Error ? error.message : 'The live dataset warm-up failed.',
        }) as WarmUpOutcome
    );
}

// ── HealthDataAdapter implementation ────────────────────

function inWindow(date: string, from?: string, to?: string): boolean {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : date.slice(0, 10);
  const fromKey = from ? from.slice(0, 10) : null;
  const toKey = to ? to.slice(0, 10) : null;
  if (fromKey && key < fromKey) return false;
  if (toKey && key > toKey) return false;
  return true;
}

/**
 * The live adapter. Every read goes through `loadLiveDataset`, so a windowed read
 * shares the same cached, server-aggregated dataset as the dashboard.
 */
export class LiveHealthDataAdapter implements HealthDataAdapter {
  readonly isLive = true;
  readonly label = 'Health Auto Export';

  constructor(private readonly deps: LiveDeps = {}) {}

  private async load(): Promise<LiveDatasetResult> {
    return loadLiveDataset(this.deps);
  }

  async getMetricData(query: MetricQuery): Promise<MetricObservation[]> {
    const { dataset } = await this.load();
    const series = dataset.metrics[query.metricId];
    if (!Array.isArray(series)) return [];
    return (series as MetricObservation[]).filter(r => inWindow(String(r.date), query.from, query.to));
  }

  async getSleepData(from?: string, to?: string): Promise<SleepObservation[]> {
    const { dataset } = await this.load();
    const series = (dataset.metrics['sleep_analysis'] ?? []) as SleepObservation[];
    return series.filter(r => inWindow(String(r.date), from, to));
  }

  async getBloodPressureData(from?: string, to?: string): Promise<BloodPressureObservation[]> {
    const { dataset } = await this.load();
    const series = (dataset.metrics['blood_pressure'] ?? []) as BloodPressureObservation[];
    return series.filter(r => inWindow(String(r.date), from, to));
  }

  async getWorkouts(from?: string, to?: string): Promise<WorkoutRecord[]> {
    const { dataset } = await this.load();
    return dataset.workouts.filter(w => inWindow(String(w.start_time), from, to));
  }

  async getCoverage(metricId: string): Promise<MetricCoverage | null> {
    const { dataset } = await this.load();
    return dataset.coverage[metricId] ?? null;
  }

  async getAvailableMetrics(): Promise<string[]> {
    const { dataset } = await this.load();
    return Object.keys(dataset.coverage);
  }
}

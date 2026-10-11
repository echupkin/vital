// ── Live Health Data Adapter (Health Auto Export + Oura) ─
//
// SERVER-SIDE ONLY. This module reads the stored Health Auto Export connection
// (encrypted in Postgres), fetches bounded windows from the Health Auto Export API, and
// normalizes them into the same internal dataset shape the demo fixtures use
// (see `normalize.ts`). When Oura is connected it reads that source in parallel
// and merges the two under a stated rule (`merge.ts`). Which sources are active
// is decided in one place, the registry (`sources/registry.ts`). It is never
// imported by a component.
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
import type { SourceError } from './meta';

export type { SourceError } from './meta';
import { HaeError, fetchMetricRecords, fetchWorkouts, type HaeConfig } from './hae';
import { LIVE_CACHE_PREFIX, OURA_CACHE_PREFIX, clearLiveCaches, liveCache, liveCacheTtlMs } from './cache';
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
  normalizeBloodPressureWithCounts,
  normalizeSimpleMetric,
  normalizeSleep,
  sleepDedupeRule,
  normalizeWorkoutsWithCounts,
} from './normalize';
import { splitSources, sourceRuleExplanationFor } from './sources';
import { compactFrom, startQualityJob, type QualityJob, type QualityJobInput } from './quality';
import type { CorrectableCheck } from './quality-correct';
import { resolveCorrections } from '../db/quality-corrections-store';
import { MERGE_RULE, mergeDatasets, preferRingFromGroups, type BuiltPart } from './merge';
import { readOuraConfig } from './oura/config';
import type { StoredOuraApp } from './oura/app-store';
import { OuraError } from './oura/client';
import { fetchOuraContribution, recordOuraOutcome } from './oura';
import { OuraNotConnectedError } from './oura/tokens';
import type { OuraContribution } from './oura/normalize';
import type { PoolLike } from '../db/pool';
import { activeHealthSources, defaultContext, sourceSetKey, type SourceContext } from '../sources/registry';

/** Rolling window fetched from upstream. Covers the observed 56-day history many times over. */
export const LIVE_LOOKBACK_DAYS = 400;
/**
 * Zone used only when a caller passes none (tests and the bare adapter). Every
 * path that renders or reasons about the data passes the profile's timezone —
 * see `resolveDataset` in `runtime.ts`.
 */
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
  /**
   * IANA zone the calendar days are cut in: the profile's timezone. Sleep waking
   * dates, workout days, daily totals and "today" all depend on it.
   */
  timezone?: string;
  /** Replaces the registry's view of the world (tests). */
  sources?: SourceContext;
  /** Replaces the process Postgres pool for Oura's credential (tests). */
  ouraClient?: PoolLike | null;
  /** Use these stored Oura app credentials instead of reading them (tests). */
  ouraApp?: StoredOuraApp;
  /** Use this Health Auto Export connection instead of the stored one (tests). */
  haeConfig?: HaeConfig | null;
  /** Replaces the process Postgres pool for the stored connection (tests). */
  haeClient?: PoolLike | null;
  /** Use these data-quality corrections instead of reading the setting (tests). */
  corrections?: ReadonlySet<CorrectableCheck>;
  /**
   * Read every source afresh now instead of serving the cached dataset
   * ("Check again"). Other readers keep the cached copy until this one lands.
   */
  refresh?: boolean;
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
  /**
   * The data-quality checks (see `quality.ts`) on the Health Auto Export
   * records, started once this load is done and run in the background so they
   * never hold the data up. Absent when Health Auto Export was not read.
   */
  quality?: QualityJob;
  /** Present only when a source failed and the other's data was served. */
  sourceErrors?: SourceError[];
  /** Present only when two sources were merged. */
  mergeRule?: string;
}

function resolveTimezone(deps: LiveDeps): string {
  const tz = (deps.timezone ?? '').trim();
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
  normalized: { recordsRead: number; recordsKept: number; sources: string[]; correctedRecords: number }
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
    dedupeRule:
      sourceRuleExplanationFor(mapping.metricId) +
      (normalized.correctedRecords > 0
        ? ` ${normalized.correctedRecords} record${normalized.correctedRecords === 1 ? '' : 's'} that only repeat${normalized.correctedRecords === 1 ? 's' : ''} another (an overlapping export or an on-the-hour copy) ${normalized.correctedRecords === 1 ? 'is' : 'are'} left out; see Data quality.`
        : ''),
  };
}

/** The Health Auto Export pass, for the window the orchestrator chose. */
interface HaePassArgs {
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  haeConfig?: HaeConfig | null;
  haeClient?: PoolLike | null;
  now: Date;
  timezone: string;
  referenceKey: string;
  window: { from: string; to: string };
  /** True when Oura is connected: ring records then come only from Oura's own API. */
  excludeRing: boolean;
  /** Data-quality corrections that are on. */
  corrections: ReadonlySet<CorrectableCheck>;
}

/**
 * One Health Auto Export pass, normalized and aggregated to one value per day.
 *
 * Each metric's raw response is reduced and dropped immediately, so peak memory
 * is one metric's payload rather than the whole history.
 */
async function fetchHaePass(args: HaePassArgs): Promise<LiveDatasetResult> {
  const { env, now, timezone, referenceKey, window } = args;
  const requestDeps = { env, fetchImpl: args.fetchImpl, haeConfig: args.haeConfig, haeClient: args.haeClient };
  const ctx = {
    tz: timezone,
    referenceKey,
    windowStartKey: referenceKey,
    ...(args.excludeRing ? { excludeFamilies: ['ring' as const] } : {}),
    correct: args.corrections,
  };

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
  const qualityMetrics: QualityJobInput['metrics'] = [];

  // ── Simple metrics: one bounded request each ──────────
  const simpleTasks = METRIC_MAPPINGS.map(mapping => async () => {
    const records = await fetchMetricRecords(mapping.hae, window, requestDeps);
    recordsRead += records.length;
    for (const r of records) if (typeof r.date === 'string') allInstants.push(r.date);
    // The quality checks need the records as stored, before they are summed per
    // day: pack what they read now, since the raw records are dropped below.
    // Averaged metrics are checked only for how recent they are.
    const packed =
      mapping.aggregation === 'mean' ? null : compactFrom(records, r => (typeof r.qty === 'number' ? r.qty : NaN));
    const normalized = normalizeSimpleMetric(mapping, records, ctx);
    const newest = normalized ? Date.parse(normalized.coverage.lastObservation) : NaN;
    qualityMetrics.push({ metricId: mapping.metricId, aggregation: mapping.aggregation, data: packed, newest: Number.isFinite(newest) ? newest : null });
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
    const { observations: sleep, dropped: sleepDropped } = normalizeSleep(sleepRaw, ctx);
    droppedRecords += sleepDropped.total;
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
      dedupeRule: sleepDedupeRule(),
    });
  }

  // ── Blood pressure ────────────────────────────────────
  if (bpRaw.length > 0) {
    const { observations: bp, dropped: bpDropped } = normalizeBloodPressureWithCounts(bpRaw, ctx);
    droppedRecords += bpDropped.total;
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

  const { workouts, dropped: workoutsDropped } = normalizeWorkoutsWithCounts(workoutRaw, ctx);
  droppedRecords += workoutsDropped.total;

  // ── Assemble the dataset ──────────────────────────────
  const sortedInstants = [...allInstants].sort();
  const dataset: HealthFixtures = {
    referenceDate: now.toISOString(),
    windowStart: sortedInstants[0] ?? now.toISOString(),
    windowEnd: sortedInstants[sortedInstants.length - 1] ?? now.toISOString(),
    days: expectedDays,
    timezone,
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
    quality: startQualityJob({
      metrics: qualityMetrics,
      daysByMetric: Object.fromEntries(
        Object.entries(metrics).map(([id, series]) => [id, (series as { date: string }[]).map(o => String(o.date).slice(0, 10))])
      ),
      referenceKey,
      now,
      tz: timezone,
      corrections: args.corrections,
    }),
  };
}

// ── Several sources, one dataset ────────────────────────

/** The Oura contribution's cache key: its own TTL and its own window. */
export function ouraCacheKey(timezone: string = DEFAULT_TIMEZONE, lookbackDays: number = LIVE_LOOKBACK_DAYS): string {
  return `${OURA_CACHE_PREFIX}${timezone}:${lookbackDays}`;
}

/** Thrown when live mode has no source to read. */
export class NoLiveSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoLiveSourceError';
  }
}

/** Thrown when every active source failed; `errors` lists each one. */
export class LiveSourcesFailedError extends Error {
  constructor(readonly errors: SourceError[]) {
    super(errors.map(e => e.message).join(' '));
    this.name = 'LiveSourcesFailedError';
  }
}

/** Fixed, token-free text for a failure of one source. */
function describeFailure(sourceId: 'hae' | 'oura', error: unknown): SourceError {
  if (error instanceof HaeError) return { sourceId, kind: error.kind, message: error.message };
  if (error instanceof OuraError) return { sourceId, kind: error.kind, message: error.message };
  if (error instanceof OuraNotConnectedError) return { sourceId, kind: error.reason, message: error.message };
  return {
    sourceId,
    kind: 'network_error',
    message: sourceId === 'oura' ? 'The Oura request failed.' : 'The Health Auto Export API request failed.',
  };
}

function sourceContext(deps: LiveDeps): SourceContext {
  if (deps.sources) return deps.sources;
  const haeClient = deps.haeClient;
  return defaultContext(deps.env ?? process.env, haeClient === undefined ? undefined : () => haeClient);
}

/** The error for "no source is active", worded for what is actually missing. */
async function noSourceError(env: NodeJS.ProcessEnv, deps: LiveDeps): Promise<Error> {
  const oura = await readOuraConfig({ env, client: deps.ouraClient, ouraApp: deps.ouraApp });
  if (oura?.ok) return new NoLiveSourceError('Connect a data source in Settings → Sources.');
  return new HaeError('Live mode is selected but no data source is connected. Connect one in Settings → Sources.', 'not_configured');
}

async function loadOuraContribution(
  deps: LiveDeps,
  env: NodeJS.ProcessEnv,
  args: { timezone: string; referenceKey: string; lookbackDays: number }
): Promise<OuraContribution> {
  const load = () =>
    fetchOuraContribution(args, { env, fetchImpl: deps.fetchImpl, client: deps.ouraClient, ouraApp: deps.ouraApp, now: deps.now });
  const read = await readOuraConfig({ env, client: deps.ouraClient, ouraApp: deps.ouraApp });
  const ttlMs = read?.ok ? read.config.cacheTtlSeconds * 1000 : undefined;
  if (deps.bypassCache) return load();
  const key = ouraCacheKey(args.timezone, args.lookbackDays);
  return deps.refresh ? liveCache.refresh(key, load, ttlMs) : liveCache.getOrLoad(key, load, ttlMs);
}

/** Make every coverage record measure against the merged window. */
function alignCoverage(dataset: HealthFixtures): void {
  for (const id of Object.keys(dataset.coverage)) {
    dataset.coverage[id] = { ...dataset.coverage[id], expectedDays: dataset.days };
  }
}

/**
 * One upstream pass over every active health source, merged.
 *
 *   HAE only    → exactly the Health Auto Export result, byte for byte.
 *   Oura only   → the Oura contribution, framed on today in the profile zone.
 *   both        → merged under the stated rule (`merge.ts`).
 *   one failed  → the other's data plus a `sourceErrors` entry; never silent.
 *   all failed  → throws.
 */
export async function fetchLiveDatasetUncached(deps: LiveDeps = {}): Promise<LiveDatasetResult> {
  const env = deps.env ?? process.env;
  const active = await activeHealthSources(sourceContext(deps));
  const haeOn = active.includes('hae');
  const ouraOn = active.includes('oura');
  if (!haeOn && !ouraOn) throw await noSourceError(env, deps);

  const now = (deps.now ?? (() => new Date()))();
  const timezone = resolveTimezone(deps);
  const referenceKey = dayKey(now.toISOString(), timezone);
  const lookbackDays = deps.lookbackDays ?? LIVE_LOOKBACK_DAYS;
  const window = upstreamWindow(referenceKey, lookbackDays);
  // Never fails: an unreadable setting reads as the default, every correction on.
  const corrections = deps.corrections ?? (haeOn ? await resolveCorrections({ env, client: deps.haeClient }) : new Set<CorrectableCheck>());

  const [haeRun, ouraRun] = await Promise.allSettled([
    haeOn
      ? fetchHaePass({
          env,
          fetchImpl: deps.fetchImpl,
          haeConfig: deps.haeConfig,
          haeClient: deps.haeClient,
          now,
          timezone,
          referenceKey,
          window,
          excludeRing: ouraOn,
          corrections,
        })
      : Promise.resolve(null),
    ouraOn ? loadOuraContribution(deps, env, { timezone, referenceKey, lookbackDays }) : Promise.resolve(null),
  ]);

  const errors: SourceError[] = [];
  if (haeRun.status === 'rejected') errors.push(describeFailure('hae', haeRun.reason));
  if (ouraRun.status === 'rejected') {
    errors.push(describeFailure('oura', ouraRun.reason));
    recordOuraOutcome(errors[errors.length - 1], now);
  } else if (ouraOn) {
    recordOuraOutcome(null, now);
  }

  const hae = haeRun.status === 'fulfilled' ? haeRun.value : null;
  const oura = ouraRun.status === 'fulfilled' ? ouraRun.value : null;

  if (!hae && !oura) {
    // Health Auto Export alone keeps its own typed error; anything else is reported together.
    if (errors.length === 1 && haeRun.status === 'rejected') throw asHaeError(haeRun.reason);
    throw new LiveSourcesFailedError(errors);
  }

  const withErrors = <R extends LiveDatasetResult>(result: R): R =>
    errors.length > 0 ? { ...result, sourceErrors: errors } : result;

  // HAE alone (the other absent, or failed): the Health Auto Export result as it always was.
  if (hae && !oura) return withErrors(hae);

  const rules = { preferRing: preferRingFromGroups(await readOuraConfigGroups(env, deps)) };
  const frame = { referenceDate: now.toISOString(), timezone };
  const haePart: BuiltPart | null = hae ? { dataset: hae.dataset, provenance: hae.provenance, stats: hae.stats } : null;
  const merged = mergeDatasets(haePart, oura, rules, frame);
  if (!merged) throw new LiveSourcesFailedError(errors);
  if (hae) alignCoverage(merged.dataset);

  const sources = [...new Set([...(hae?.sources ?? []), ...(oura?.sources ?? [])])].sort();
  const result: LiveDatasetResult = {
    dataset: merged.dataset,
    provenance: merged.provenance,
    stats: merged.stats,
    mode: 'live',
    asOf: merged.dataset.windowEnd,
    generatedAt: hae?.generatedAt ?? now.toISOString(),
    referenceKey,
    windowStartKey: dayKey(merged.dataset.windowStart, timezone),
    timezone,
    sources,
    cacheTtlSeconds: liveCacheTtlMs(env) / 1000,
    ...(hae ? { mergeRule: MERGE_RULE, quality: hae.quality } : {}),
  };
  return withErrors(result);
}

async function readOuraConfigGroups(env: NodeJS.ProcessEnv, deps: LiveDeps) {
  const read = await readOuraConfig({ env, client: deps.ouraClient, ouraApp: deps.ouraApp });
  return read?.ok ? read.config.preferredFor : [];
}

// ── Cached entry point ──────────────────────────────────

/** The key for a timezone and an active-source set, e.g. `live-dataset:UTC:400:hae+oura`. */
export function liveCacheKey(timezone: string = DEFAULT_TIMEZONE, setKey: string = ''): string {
  return `${LIVE_CACHE_PREFIX}${timezone}:${LIVE_LOOKBACK_DAYS}:${setKey}`;
}

export { clearLiveCaches };

/**
 * The key for this load. A dataset cut in any other zone, or for any other set
 * of active sources, is dropped: it is stale, and holding two copies of the
 * history only costs memory (and could outlive a removed source).
 */
async function liveCacheKeyFor(deps: LiveDeps): Promise<string> {
  const timezone = resolveTimezone(deps);
  const key = liveCacheKey(timezone, await sourceSetKey(sourceContext(deps)));
  for (const other of liveCache.stats().keys) {
    if (other !== key && other.startsWith(LIVE_CACHE_PREFIX)) liveCache.clear(other);
    if (other.startsWith(OURA_CACHE_PREFIX) && !other.startsWith(`${OURA_CACHE_PREFIX}${timezone}:`)) liveCache.clear(other);
  }
  return key;
}

/**
 * Load the live dataset, cached in-process with a TTL and single-flight:
 * concurrent callers share one upstream pass.
 */
export async function loadLiveDataset(deps: LiveDeps = {}): Promise<LiveDatasetResult> {
  const key = await liveCacheKeyFor(deps);
  if (deps.bypassCache) {
    const fresh = await fetchLiveDatasetUncached(deps);
    liveCache.clear(key);
    return fresh;
  }
  if (deps.refresh) return liveCache.refresh(key, () => fetchLiveDatasetUncached(deps));
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
 * refresh after the TTL lapses. Oura is read only if it is connected.
 *
 * Returns immediately; the fill continues in the background. The returned
 * promise resolves when the fill settles — reported as an outcome rather than a
 * rejection, because a failed warm-up must not crash or spam the boot path; the
 * next request retries and shows the real error. `null` means there was nothing
 * to do (demo mode, or no live source is configured).
 */
export function warmLiveDataset(deps: LiveDeps = {}): Promise<WarmUpOutcome> | null {
  const env = deps.env ?? process.env;
  if ((env.VITAL_DATA_MODE ?? '').trim().toLowerCase() !== 'live') return null;

  return (async (): Promise<WarmUpOutcome> => {
    try {
      if ((await activeHealthSources(sourceContext(deps))).length === 0) {
        return { ok: false, reason: 'No live source is connected yet.' };
      }
      const key = await liveCacheKeyFor(deps);
      // Single-flight: a request that got there first is joined, not duplicated.
      await liveCache.getOrLoad(key, () => fetchLiveDatasetUncached(deps));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'The live dataset warm-up failed.' };
    }
  })();
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
  readonly label = 'Live sources';

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

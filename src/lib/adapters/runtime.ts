// ── Runtime data resolution (SERVER-SIDE ONLY) ──────────
//
// Decides which dataset the app is serving, exactly once per request:
//
//   VITAL_DATA_MODE=live  → fetch + normalize every active live source and merge them
//   VITAL_DATA_MODE=demo  → the committed fixtures (the default, and the fallback
//                           for any environment that does not opt in)
//
// A live failure is surfaced as `LiveDataUnavailableError`. There is deliberately
// no path from a failed live read to demo data: the failure is reported.

import type { HealthFixtures } from '../metrics/types';
import { FIXTURES, dataMode, datasetMeta, setActiveDataset, type DataMode, type DatasetMeta } from './dataset';
import { dayKey } from '../analytics/windows';
import { haeHost } from './hae';
import { loadLiveDataset, type LiveDeps } from './live';
import { activeHealthSources, defaultContext } from '../sources/registry';
import { reconcileQuietly } from '../sources/purge';
import { liveCache, liveCacheTtlMs } from './cache';
import type { ProvenanceRow } from './normalize';
import type { QualityJob } from './quality';
import type { ClientDatasetMeta } from './meta';
import { SOURCE_DEDUPE_RULE } from './sources';
import { readProfile } from '../profile/store';

export type { DataMode };
export type { ClientDatasetMeta } from './meta';

export class LiveDataUnavailableError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly host: string | null
  ) {
    super(message);
    this.name = 'LiveDataUnavailableError';
  }
}

/** The mode selected by the environment. Anything but `live` is demo. */
export function readDataMode(env: NodeJS.ProcessEnv = process.env): DataMode {
  return (env.VITAL_DATA_MODE ?? '').trim().toLowerCase() === 'live' ? 'live' : 'demo';
}

/**
 * A resolved dataset, ready to install.
 */
export interface ResolvedDataset {
  mode: DataMode;
  /**
   * Non-null only in live mode: the normalized history the client provider
   * installs before rendering. Demo mode reuses the fixtures the client bundle
   * already contains, so nothing extra is serialized.
   */
  dataset: HealthFixtures | null;
  meta: ClientDatasetMeta;
  /** Server-side meta of the installed dataset (after `install`). */
  serverMeta: DatasetMeta | null;
  /**
   * The data-quality checks on the live export, running in the background or
   * done; null in demo mode (the fixtures are not an export).
   */
  quality: QualityJob | null;
}

function toClientMeta(
  mode: DataMode,
  meta: DatasetMeta,
  host: string | null,
  env: NodeJS.ProcessEnv,
  provenance: ProvenanceRow[],
  dedupe: ClientDatasetMeta['dedupe'],
  sourceErrors?: ClientDatasetMeta['sourceErrors'],
  activeSources?: string[]
): ClientDatasetMeta {
  // No source is named here: pages never say where data came from (Settings does).
  const summary = mode === 'live'
    ? `Live data, as of ${meta.dataAsOf.slice(0, 10)}. ${meta.observationCount} daily observations across ${meta.metricCount} metrics.`
    : `Demo dataset: ${meta.observationCount} observations across ${meta.metricCount} metrics, reference day ${meta.referenceKey}.`;
  return {
    mode,
    live: mode === 'live',
    dataAsOf: meta.dataAsOf,
    dataAsOfKey: dayKey(meta.dataAsOf, meta.timezone),
    referenceKey: meta.referenceKey,
    windowStartKey: meta.windowStartKey,
    timezone: meta.timezone,
    generatedAt: meta.generatedAt,
    observationCount: meta.observationCount,
    metricCount: meta.metricCount,
    workouts: meta.workouts,
    sources: meta.sources,
    host,
    cacheTtlSeconds: liveCacheTtlMs(env) / 1000,
    dedupe,
    provenance,
    summary,
    ...(sourceErrors && sourceErrors.length > 0 ? { sourceErrors } : {}),
    ...(activeSources ? { activeSources } : {}),
  };
}

/**
 * Resolve the dataset for this request. Does not install it: `install()` does,
 * and the pipeline/analyst routes call `install()` before reading the dataset.
 */
export async function resolveDataset(deps: LiveDeps = {}): Promise<ResolvedDataset> {
  const env = deps.env ?? process.env;
  const mode = readDataMode(env);
  const host = await haeHost({ env, haeConfig: deps.haeConfig, haeClient: deps.haeClient });

  if (mode === 'demo') {
    const meta = datasetMeta();
    return {
      mode,
      dataset: null,
      meta: toClientMeta('demo', meta, host, env, [], null),
      serverMeta: meta,
      quality: null,
    };
  }

  const active = await activeHealthSources(
    deps.sources ??
      defaultContext(env, deps.haeClient === undefined ? undefined : () => deps.haeClient ?? null)
  );
  if (active.length === 0) {
    throw new LiveDataUnavailableError(
      'Live mode is selected but no live source is connected.',
      'Connect a data source in Settings → Sources.',
      host
    );
  }

  // The profile's timezone cuts the calendar days — the same zone the greeting,
  // the briefing and the Settings page use — unless the caller supplied one.
  const timezone = deps.timezone ?? (await readProfile(env)).timezone;

  let result;
  try {
    result = await loadLiveDataset({ ...deps, timezone });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The live data source could not be read.';
    throw new LiveDataUnavailableError(
      'The live health data source is unavailable.',
      detail,
      host
    );
  }

  setActiveDataset(result.dataset, {
    mode: 'live',
    dataAsOf: result.asOf ?? result.dataset.windowEnd,
    generatedAt: result.generatedAt,
  });
  const meta = datasetMeta();

  return {
    mode,
    dataset: result.dataset,
    meta: toClientMeta(
      'live',
      meta,
      host,
      env,
      result.provenance,
      {
        rule: result.mergeRule ? `${SOURCE_DEDUPE_RULE} ${result.mergeRule}` : SOURCE_DEDUPE_RULE,
        droppedRecords: result.stats.droppedRecords,
        droppedIntervals: result.stats.droppedIntervals,
      },
      result.sourceErrors,
      active.filter(id => id === 'hae' || id === 'oura')
    ),
    serverMeta: meta,
    quality: result.quality ?? null,
  };
}

/**
 * Setup mode as far as it is known without loading anything: live mode with no
 * health source connected (a database read, not an upstream one). A connected
 * source that cannot be read is only known once the load fails. Never throws.
 */
export async function knownSetupMode(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (readDataMode(env) !== 'live') return false;
  try {
    return (await activeHealthSources(defaultContext(env))).length === 0;
  } catch {
    return false;
  }
}

/**
 * Install the resolved dataset into the server process (the route-handler bundle)
 * so route handlers read exactly what the pages are showing. Idempotent.
 */
export async function installDataset(deps: LiveDeps = {}): Promise<ResolvedDataset> {
  // A source that went away since the last request is purged BEFORE anything is
  // built, so nothing it contributed can be read back (plan §8).
  const env = deps.env ?? process.env;
  await reconcileQuietly(deps.sources ?? defaultContext(env));
  const resolved = await resolveDataset(deps);
  if (resolved.mode === 'demo' && dataMode() !== 'demo') {
    // A process that previously served live data must not keep serving it in
    // demo mode; the fixtures are re-installed explicitly.
    setActiveDataset(FIXTURES, { mode: 'demo', dataAsOf: FIXTURES.windowEnd });
  }
  return resolved;
}

export function cacheStatus(): ReturnType<typeof liveCache.stats> {
  return liveCache.stats();
}

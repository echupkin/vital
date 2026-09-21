// ── Runtime data resolution (SERVER-SIDE ONLY) ──────────
//
// Decides which dataset the app is serving, exactly once per request:
//
//   VITAL_DATA_MODE=live  → fetch + normalize the Health Auto Export history
//   VITAL_DATA_MODE=demo  → the committed fixtures (the default, and the fallback
//                           for any environment that does not opt in)
//
// A live failure is surfaced as `LiveDataUnavailableError`. There is deliberately
// no path from a failed live read to demo data: the failure is reported.

import type { HealthFixtures } from '../metrics/types';
import { FIXTURES, dataMode, datasetMeta, setActiveDataset, type DataMode, type DatasetMeta } from './dataset';
import { dayKey } from '../analytics/windows';
import { haeHost, readHaeConfig } from './hae';
import { loadLiveDataset, type LiveDeps } from './live';
import { liveCache, liveCacheTtlMs } from './cache';
import type { ProvenanceRow } from './normalize';
import type { ClientDatasetMeta } from './meta';
import { SOURCE_DEDUPE_RULE } from './sources';

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
}

function toClientMeta(
  mode: DataMode,
  meta: DatasetMeta,
  host: string | null,
  env: NodeJS.ProcessEnv,
  provenance: ProvenanceRow[],
  dedupe: ClientDatasetMeta['dedupe']
): ClientDatasetMeta {
  const summary = mode === 'live'
    ? `Live Health Auto Export data, as of ${meta.dataAsOf.slice(0, 10)}. ${meta.observationCount} daily observations across ${meta.metricCount} metrics.`
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
  };
}

/**
 * Resolve the dataset for this request. Does not install it: `install()` does,
 * and the pipeline/analyst routes call `install()` before reading the dataset.
 */
export async function resolveDataset(deps: LiveDeps = {}): Promise<ResolvedDataset> {
  const env = deps.env ?? process.env;
  const mode = readDataMode(env);

  if (mode === 'demo') {
    const meta = datasetMeta();
    return {
      mode,
      dataset: null,
      meta: toClientMeta('demo', meta, haeHost(env), env, [], null),
      serverMeta: meta,
    };
  }

  if (!readHaeConfig(env)) {
    throw new LiveDataUnavailableError(
      'Live mode is selected but the Health Auto Export API is not configured.',
      'HAE_API_URL and HAE_API_KEY must both be set in the server environment.',
      haeHost(env)
    );
  }

  let result;
  try {
    result = await loadLiveDataset(deps);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The live data source could not be read.';
    throw new LiveDataUnavailableError(
      'The live health data source is unavailable.',
      detail,
      haeHost(env)
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
      haeHost(env),
      env,
      result.provenance,
      {
        rule: SOURCE_DEDUPE_RULE,
        droppedRecords: result.stats.droppedRecords,
        droppedIntervals: result.stats.droppedIntervals,
      }
    ),
    serverMeta: meta,
  };
}

/**
 * Install the resolved dataset into the server process (the route-handler bundle)
 * so route handlers read exactly what the pages are showing. Idempotent.
 */
export async function installDataset(deps: LiveDeps = {}): Promise<ResolvedDataset> {
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

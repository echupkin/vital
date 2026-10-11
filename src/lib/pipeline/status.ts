// ── Data pipeline status (SPEC §10) ─────────────────────
//
// Every status in this report comes from a real check performed in this process:
//
//   * Health Auto Export / Health API — a bounded read-only probe of the
//     stored endpoint (HAE_PROBE_METRIC, default resting_heart_rate),
//     with a hard timeout. Healthy is only ever reported when the probe actually
//     answered with an array of records.
//   * Oura — a bounded read-only probe (daily_sleep, last two days) when Oura is
//     configured and connected; "not configured" and "not connected" are
//     reported as such and make no request.
//   * Intelligence — the dataset the app is serving is read for real and its
//     observation count and newest observation are reported.
//   * Dashboard — the request itself is the check.
//
// The checks are grouped in three parts that run independently and at once —
// the probes, the dataset, the workout sources — so the settings panel can ask
// for each separately and show a stage as soon as its own check is done (see
// `assemble.ts`). The full report is the same three parts, assembled.
//
// This module is server-side: it reads the server environment, may load the live
// dataset, and never returns the token.

import { datasetMeta, type DatasetMeta } from '../adapters/dataset';
import { cacheStatus, installDataset, readDataMode, LiveDataUnavailableError } from '../adapters/runtime';
import { haeHost, resolveHaeConfig, type HaeConfig, type HaeProbeResult } from '../adapters/hae';
import { probeHae } from '../adapters/hae';
import { probeOura, type OuraProbeResult } from '../adapters/oura';
import { readOuraConfig, type OuraConfigResult } from '../adapters/oura/config';
import type { StoredOuraApp } from '../adapters/oura/app-store';
import type { PoolLike } from '../db/pool';
import { loadTrainingData } from '../workout-sources/store';
import type { QualityJob } from '../adapters/quality';
import type { SilencedKey, SilencedResult } from '../adapters/quality-silenced';
import { silencedView } from './quality-view';
import { assembleReport } from './assemble';
import type {
  DatasetPart,
  PipelineConfig,
  PipelineDatasetSummary,
  PipelinePart,
  PipelineProbe,
  PipelineStage,
  PipelineStatusReport,
  ProbeOutcome,
  SourcesPart,
  WorkoutsPart,
} from './types';

export type {
  PipelineStage,
  PipelineStatusReport,
  PipelineConfig,
  PipelineProbe,
  PipelineDatasetSummary,
  StageId,
  StageStatus,
  ProbeOutcome,
} from './types';
export { STAGE_STATUS_LABEL, PIPELINE_ORDER } from './types';

export const PROBE_TIMEOUT_MS = 1500;

export async function readPipelineConfig(
  deps: { env?: NodeJS.ProcessEnv; haeConfig?: HaeConfig | null; haeClient?: PoolLike | null } = {}
): Promise<PipelineConfig> {
  const config = await resolveHaeConfig(deps);
  return {
    healthApiConfigured: Boolean(config),
    healthApiHost: await haeHost({ ...deps, haeConfig: config }),
    probeMetric: config?.probeMetric ?? null,
  };
}

export interface PipelineDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Skip the dataset load (tests that only exercise the probe). */
  skipDataset?: boolean;
  /** Dataset summary supplied by the caller (tests). */
  datasetSummary?: PipelineDatasetSummary;
  /** Replaces the process Postgres pool for Oura's credential (tests). */
  ouraClient?: PoolLike | null;
  /** Use these stored Oura app credentials instead of reading them (tests). */
  ouraApp?: StoredOuraApp;
  /** Use these quality checks instead of the loaded dataset's (tests). */
  qualityJob?: QualityJob | null;
  /** Use this silenced list instead of reading it (tests). */
  silenced?: readonly SilencedKey[];
  /** Replaces the process Postgres pool for the silenced list (tests). */
  silencedClient?: PoolLike | null;
  /** Use this Health Auto Export connection instead of the stored one (tests). */
  haeConfig?: HaeConfig | null;
  /** Replaces the process Postgres pool for the stored connection (tests). */
  haeClient?: PoolLike | null;
  /** Read the dataset and sync the workout sources afresh instead of serving the caches ("Check again"). */
  fresh?: boolean;
}

/** The Oura stage: every status comes from the probe, or from the configuration when no request was made. */
function ouraStage(read: OuraConfigResult, probe: OuraProbeResult | null): PipelineStage {
  const base = { id: 'oura_api' as const, name: 'Oura Ring', observationCount: null, lastObservationAt: null };
  if (read && !read.ok) {
    return {
      ...base,
      status: 'unconfigured',
      detail: `Oura is partly configured: ${read.reason}`,
      derivedFrom: 'Configuration check only; no request was made.',
    };
  }
  if (!read || !probe) {
    return {
      ...base,
      status: 'unconfigured',
      detail: 'Oura app credentials are not set. Enter them in Settings → Sources.',
      derivedFrom: 'Configuration check only; no request was made.',
    };
  }
  if (probe.outcome === 'needs_reconnect' && probe.httpStatus === null) {
    return {
      ...base,
      status: 'unconfigured',
      detail: `${probe.detail} Connect it in Settings → Sources.`,
      derivedFrom: 'Credential check only; no request was made to Oura.',
    };
  }
  const ok = probe.outcome === 'ok';
  return {
    ...base,
    status: ok ? 'healthy' : 'degraded',
    detail: ok ? `Oura answered a read-only probe with ${probe.records} record(s) in ${probe.durationMs} ms.` : probe.detail,
    derivedFrom: `GET /v2/usercollection/daily_sleep for the last 2 days with a ${PROBE_TIMEOUT_MS} ms timeout (outcome: ${probe.outcome}).`,
  };
}

function toProbe(result: HaeProbeResult | null, config: PipelineConfig, env: NodeJS.ProcessEnv): PipelineProbe {
  if (!config.healthApiConfigured) {
    return {
      attempted: false,
      url: null,
      metric: config.probeMetric,
      outcome: 'not_configured',
      httpStatus: null,
      records: null,
      detail: 'The data source is not connected, so no request was made.',
      durationMs: null,
    };
  }
  const r = result!;
  return {
    attempted: true,
    url: config.healthApiHost,
    metric: config.probeMetric,
    outcome: r.outcome as ProbeOutcome,
    httpStatus: r.httpStatus,
    records: r.records,
    detail: r.detail,
    durationMs: r.durationMs,
  };
}

function summariseDataset(meta: DatasetMeta, error: string | null): PipelineDatasetSummary {
  return {
    source: meta.live ? 'live' : 'demo',
    observationCount: meta.observationCount,
    metricCount: meta.metricCount,
    workouts: meta.workouts,
    referenceKey: meta.referenceKey,
    windowStartKey: meta.windowStartKey,
    timezone: meta.timezone,
    lastObservationAt: meta.dataAsOf || null,
    error,
  };
}

/**
 * The data-quality stage: the checks run on the live export's raw records while
 * it was loaded. Degraded when any finding is a problem or a warning; notes
 * alone (a food log that starts late, a gap more than 90 days back) leave it
 * healthy.
 */
export function qualityStage(job: QualityJob | null, mode: 'demo' | 'live', summary: PipelineDatasetSummary, view: SilencedResult | null = null): PipelineStage {
  if (job && job.state !== 'ready') {
    return {
      id: 'data_quality',
      name: 'Data quality',
      status: job.state === 'computing' ? 'checking' : 'unknown',
      detail:
        job.state === 'computing'
          ? 'Checking the export’s records in the background. Nothing else waits for it; the result appears below when it is ready.'
          : `The checks could not finish: ${job.error ?? 'unknown error'}.`,
      derivedFrom: 'The checks run after the live data has loaded.',
      observationCount: null,
      lastObservationAt: null,
    };
  }
  // Silenced findings are already out of `view.report`: the counts, the
  // severities and the notes below are all computed from what is left.
  const quality = view ? view.report : (job?.value ?? null);
  if (!quality) {
    return {
      id: 'data_quality',
      name: 'Data quality',
      status: mode === 'demo' ? 'unconfigured' : 'unknown',
      detail:
        mode === 'demo'
          ? 'Demo mode: the fixtures are not an export, so there is nothing to check for gaps or duplicates.'
          : 'The live export could not be read, so its records could not be checked.',
      derivedFrom: 'No live records were available to check.',
      observationCount: null,
      lastObservationAt: null,
    };
  }
  const serious = quality.findings.filter(f => f.severity !== 'info');
  const notes = quality.findings.filter(f => f.severity === 'info');
  const flagged = quality.checks.filter(c => c.outcome === 'flagged').length;
  const hidden = view ? view.silenced.filter(s => s.found).length : 0;
  const corrected = quality.checks.filter(c => c.outcome === 'corrected');
  const correctedText = corrected.length
    ? ` Vital corrects ${corrected.map(c => c.label.replace(/ \(.*\)$/, '').toLowerCase()).join(' and ')} in its own totals.`
    : '';
  return {
    id: 'data_quality',
    name: 'Data quality',
    status: serious.length ? 'degraded' : 'healthy',
    detail:
      (serious.length
        ? `${serious.length} finding${serious.length === 1 ? '' : 's'} to fix: ${serious.map(f => f.title.toLowerCase()).join('; ')}.` +
          `${notes.length ? ` Also ${notes.length} note${notes.length === 1 ? '' : 's'}.` : ''} Each is listed below with how to fix it.`
        : notes.length
          ? `No recent problems. ${notes.length} note${notes.length === 1 ? '' : 's'} about older history or the food log: ${notes.map(f => f.title.toLowerCase()).join('; ')}.`
          : hidden > 0
            ? `No data-quality problems found. ${hidden} issue${hidden === 1 ? ' is' : 's are'} silenced in Settings → Connections.`
            : corrected.length
              ? 'No data-quality problems left to fix.'
              : `All ${quality.checks.length} checks passed: no activity counted twice, no reading stored twice, no missing days, and new data is arriving.`) +
      correctedText,
    derivedFrom: `${quality.checks.length} checks on the export's records as stored, before daily aggregation (${flagged} flagged).`,
    observationCount: summary.observationCount,
    lastObservationAt: summary.lastObservationAt,
  };
}

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

/** The export server and Oura: configuration, then both read-only probes at once. */
export async function resolveSourcesPart(deps: PipelineDeps = {}): Promise<SourcesPart> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const config = await readPipelineConfig({ env, haeConfig: deps.haeConfig, haeClient: deps.haeClient });
  const mode = readDataMode(env);

  // Probe the export API (only when configured) and Oura (only when configured;
  // a missing credential makes no request). Neither waits for the other.
  const [probeResult, ouraRead] = await Promise.all([
    config.healthApiConfigured
      ? probeHae({ env, fetchImpl: deps.fetchImpl, haeConfig: deps.haeConfig, haeClient: deps.haeClient }, now)
      : Promise.resolve(null),
    readOuraConfig({ env, client: deps.ouraClient, ouraApp: deps.ouraApp }).then(async read => ({
      read,
      probe:
        read?.ok === true
          ? await probeOura({ env, fetchImpl: deps.fetchImpl, client: deps.ouraClient, ouraApp: deps.ouraApp }, now)
          : null,
    })),
  ]);
  const probe = toProbe(probeResult, config, env);
  const probeOk = probe.outcome === 'ok';

  return {
    part: 'sources',
    mode,
    config,
    probe,
    ouraOk: ouraRead.probe?.outcome === 'ok',
    stages: [
      {
        id: 'health_auto_export',
        name: 'Health Auto Export',
        status: !config.healthApiConfigured ? 'unconfigured' : probeOk ? 'healthy' : 'degraded',
        detail: !config.healthApiConfigured
          ? 'The data source is not connected. Connect it in Settings → Sources.'
          : probeOk
            ? `The configured export server at ${config.healthApiHost ?? 'the configured host'} answered a read-only probe with ${probe.records ?? 0} record(s).`
            : `${probe.detail} The configured host is ${config.healthApiHost ?? 'unknown'}.`,
        derivedFrom: config.healthApiConfigured
          ? `GET /api/metrics/${config.probeMetric} with a ${PROBE_TIMEOUT_MS} ms timeout (outcome: ${probe.outcome}).`
          : 'Configuration check only; no request was made.',
        observationCount: null,
        lastObservationAt: null,
      },
      {
        id: 'health_api',
        name: 'Health API',
        status: !config.healthApiConfigured ? 'unconfigured' : probeOk ? 'healthy' : 'degraded',
        detail: config.healthApiConfigured
          ? probeOk
            ? `Read endpoints answered; the probe metric ${config.probeMetric} returned ${probe.records ?? 0} record(s) in ${probe.durationMs ?? '—'} ms.`
            : probe.detail
          : 'No API endpoint is configured, so no live metric can be read.',
        derivedFrom: config.healthApiConfigured
          ? 'The same bounded read-only probe as the export stage.'
          : 'Configuration check only; no request was made.',
        observationCount: null,
        lastObservationAt: null,
      },
      ouraStage(ouraRead.read, ouraRead.probe),
    ],
    checkedAt: new Date(now()).toISOString(),
  };
}

/** The dataset the app is serving (loading it when cold), and the data-quality checks on it. */
export async function resolveDatasetPart(deps: PipelineDeps = {}): Promise<DatasetPart> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const mode = readDataMode(env);

  let summary: PipelineDatasetSummary;
  let qualityJob: QualityJob | null = null;
  if (deps.datasetSummary) {
    summary = deps.datasetSummary;
    qualityJob = deps.qualityJob ?? null;
  } else if (deps.skipDataset) {
    summary = summariseDataset(datasetMeta(), null);
    qualityJob = deps.qualityJob ?? null;
  } else {
    try {
      const resolved = await installDataset({ env, fetchImpl: deps.fetchImpl, haeConfig: deps.haeConfig, haeClient: deps.haeClient, now: deps.now ? () => new Date(deps.now!()) : undefined, refresh: deps.fresh });
      summary = summariseDataset(resolved.serverMeta ?? datasetMeta(), null);
      qualityJob = resolved.quality;
    } catch (error) {
      const detail =
        error instanceof LiveDataUnavailableError
          ? `${error.message} ${error.detail}`
          : error instanceof Error
            ? error.message
            : 'The live dataset could not be loaded.';
      summary = { ...summariseDataset(datasetMeta(), detail), source: mode };
    }
  }

  // Silenced data-quality findings, left out of everything below.
  const qualityView = qualityJob?.state === 'ready' && qualityJob.value
    ? await silencedView(qualityJob.value, { env, client: deps.silencedClient, silenced: deps.silenced })
    : null;

  const cache = cacheStatus();
  return {
    part: 'dataset',
    mode,
    dataset: summary,
    cache: {
      ttlSeconds: cache.ttlMs / 1000,
      ageMs: cache.oldestAgeMs,
      hits: cache.hits,
      misses: cache.misses,
      keys: cache.keys.length,
    },
    // Never awaited: the checks finish in the background and the panel fetches
    // /api/pipeline/quality for them.
    quality: qualityView ? qualityView.report : (qualityJob?.value ?? null),
    qualityState: qualityJob ? qualityJob.state : 'unavailable',
    silenced: qualityView ? qualityView.silenced : [],
    stages: [
      qualityStage(qualityJob, mode, summary, qualityView),
      {
        id: 'intelligence',
        name: 'Intelligence',
        status: summary.error ? 'degraded' : summary.observationCount > 0 ? 'healthy' : 'degraded',
        detail: summary.error
          ? `The dataset could not be read, so no baseline, comparison or summary was produced: ${summary.error}`
          : `Baselines, comparisons and summaries were computed locally from the ${summary.source === 'live' ? 'live health history' : 'committed demo dataset'}: ` +
            `${summary.observationCount} daily observations across ${summary.metricCount} metrics and ${summary.workouts} workouts. ` +
            `Newest observation ${dayOf(summary.lastObservationAt)}.`,
        derivedFrom: summary.error
          ? 'The dataset load failed and the failure is reported.'
          : `Local check: every registered metric was read from the dataset the app is serving (window ${summary.windowStartKey} → ${summary.referenceKey}, ${summary.timezone}).`,
        observationCount: summary.observationCount,
        lastObservationAt: summary.lastObservationAt,
      },
    ],
    checkedAt: new Date(now()).toISOString(),
  };
}

/** Workout sources: a real sync, or the demo fixtures. */
export async function resolveWorkoutsPart(deps: PipelineDeps = {}): Promise<WorkoutsPart> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const workoutSources = deps.skipDataset ? [] : (await loadTrainingData({ env, fetchImpl: deps.fetchImpl, now, refresh: deps.fresh })).statuses;
  return { part: 'workouts', workoutSources, checkedAt: new Date(now()).toISOString() };
}

export const resolvePart: Record<PipelinePart, (deps?: PipelineDeps) => Promise<SourcesPart | DatasetPart | WorkoutsPart>> = {
  sources: resolveSourcesPart,
  dataset: resolveDatasetPart,
  workouts: resolveWorkoutsPart,
};

/** Build the whole report. Every status here comes from a real check; the three parts run at once. */
export async function resolvePipelineStatus(deps: PipelineDeps = {}): Promise<PipelineStatusReport> {
  const [sources, dataset, workouts] = await Promise.all([
    resolveSourcesPart(deps),
    resolveDatasetPart(deps),
    resolveWorkoutsPart(deps),
  ]);
  return assembleReport({ sources, dataset, workouts }, { now: deps.now });
}

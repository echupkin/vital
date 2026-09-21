// ── Data pipeline status (SPEC §10) ─────────────────────
//
// Every status in this report comes from a real check performed in this process:
//
//   * Health Auto Export / Health API — a bounded read-only probe of the
//     configured HAE_API_URL (HAE_PROBE_METRIC, default resting_heart_rate),
//     with a hard timeout. Healthy is only ever reported when the probe actually
//     answered with an array of records.
//   * Intelligence — the dataset the app is serving is read for real and its
//     observation count and newest observation are reported.
//   * Dashboard — the request itself is the check.
//
// This module is server-side: it reads the server environment, may load the live
// dataset, and never returns the token.

import { datasetMeta, type DatasetMeta } from '../adapters/dataset';
import { cacheStatus, installDataset, readDataMode, LiveDataUnavailableError } from '../adapters/runtime';
import { haeHost, readHaeConfig, type HaeProbeResult } from '../adapters/hae';
import { probeHae } from '../adapters/hae';
import type {
  PipelineConfig,
  PipelineDatasetSummary,
  PipelineProbe,
  PipelineStage,
  PipelineStatusReport,
  ProbeOutcome,
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

export function readPipelineConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const config = readHaeConfig(env);
  return {
    healthApiConfigured: Boolean(config),
    healthApiHost: haeHost(env),
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
      detail: 'HAE_API_URL and HAE_API_KEY are not both set, so no request was made.',
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

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

/** Build the whole report. Every status here comes from a real check. */
export async function resolvePipelineStatus(deps: PipelineDeps = {}): Promise<PipelineStatusReport> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const config = readPipelineConfig(env);
  const mode = readDataMode(env);

  // ── 1. Probe the export API (only when configured) ────
  const probeResult = config.healthApiConfigured
    ? await probeHae({ env, fetchImpl: deps.fetchImpl }, now)
    : null;
  const probe = toProbe(probeResult, config, env);
  const probeOk = probe.outcome === 'ok';

  // ── 2. Read the dataset the app is actually serving ───
  let summary: PipelineDatasetSummary;
  if (deps.datasetSummary) {
    summary = deps.datasetSummary;
  } else if (deps.skipDataset) {
    summary = summariseDataset(datasetMeta(), null);
  } else {
    try {
      const resolved = await installDataset({ env, fetchImpl: deps.fetchImpl, now: deps.now ? () => new Date(deps.now!()) : undefined });
      summary = summariseDataset(resolved.serverMeta ?? datasetMeta(), null);
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

  // ── 3. Stages ─────────────────────────────────────────
  const stages: PipelineStage[] = [
    {
      id: 'health_auto_export',
      name: 'Health Auto Export',
      status: !config.healthApiConfigured ? 'unconfigured' : probeOk ? 'healthy' : 'degraded',
      detail: !config.healthApiConfigured
        ? 'No export server is configured (HAE_API_URL and HAE_API_KEY are not both set).'
        : probeOk
          ? `The configured export server at ${config.healthApiHost ?? 'the configured host'} answered a read-only probe with ${probe.records ?? 0} record(s).`
          : `${probe.detail} The configured host is ${config.healthApiHost ?? 'unknown'}.`,
      derivedFrom: config.healthApiConfigured
        ? `GET /api/metrics/${config.probeMetric} with a ${PROBE_TIMEOUT_MS} ms timeout (outcome: ${probe.outcome}).`
        : 'Configuration check only; no request was made.',
      observationCount: summary.observationCount,
      lastObservationAt: summary.lastObservationAt,
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
      observationCount: summary.observationCount,
      lastObservationAt: summary.lastObservationAt,
    },
    {
      id: 'intelligence',
      name: 'Intelligence',
      status: summary.error ? 'degraded' : summary.observationCount > 0 ? 'healthy' : 'degraded',
      detail: summary.error
        ? `The dataset could not be read, so no baseline, comparison or summary was produced: ${summary.error}`
        : `Baselines, comparisons and summaries were computed locally from the ${summary.source === 'live' ? 'live Health Auto Export history' : 'committed demo dataset'}: ` +
          `${summary.observationCount} daily observations across ${summary.metricCount} metrics and ${summary.workouts} workouts. ` +
          `Newest observation ${dayOf(summary.lastObservationAt)}.`,
      derivedFrom: summary.error
        ? 'The dataset load failed and the failure is reported.'
        : `Local check: every registered metric was read from the dataset the app is serving (window ${summary.windowStartKey} → ${summary.referenceKey}, ${summary.timezone}).`,
      observationCount: summary.observationCount,
      lastObservationAt: summary.lastObservationAt,
    },
    {
      id: 'dashboard',
      name: 'Dashboard',
      status: 'healthy',
      detail: 'This request is the check: the pipeline route compiled, ran and returned this report.',
      derivedFrom: 'The status endpoint responded to this request.',
      observationCount: null,
      lastObservationAt: null,
    },
  ];

  const healthy = stages.filter(s => s.status === 'healthy').length;
  const cache = cacheStatus();
  const summarySentence = mode === 'live'
    ? probeOk
      ? `Live mode: ${healthy} of ${stages.length} stages confirmed by real checks; ${summary.observationCount} observations as of ${dayOf(summary.lastObservationAt)}.`
      : `Live mode, but the export API did not answer (${probe.outcome}). ${healthy} of ${stages.length} stages confirmed; the dashboard is showing a connection error rather than demo data.`
    : probeOk
      ? `Demo mode: the committed fixtures are being served. The configured export server answered a probe, but every number on the dashboard still comes from the fixtures. ${healthy} of ${stages.length} stages confirmed by real checks.`
      : `Demo mode: the committed fixtures are being served, and nothing upstream could be confirmed. ${healthy} of ${stages.length} stages are confirmed healthy.`;

  return {
    mode,
    stages,
    config,
    probe,
    dataset: summary,
    cache: {
      ttlSeconds: cache.ttlMs / 1000,
      ageMs: cache.oldestAgeMs,
      hits: cache.hits,
      misses: cache.misses,
      keys: cache.keys.length,
    },
    dataAsOf: summary.lastObservationAt,
    checkedAt: new Date(now()).toISOString(),
    summary: summarySentence,
  };
}

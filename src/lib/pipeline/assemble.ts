// ── Putting the pipeline report together from its parts ─
//
// The report is checked in three independent parts (see `PipelinePart`): the
// export server and Oura probes, the dataset with its data-quality checks, and
// the workout sources. The server assembles all three for the full report; the
// settings panel assembles whatever has arrived so far, so each stage shows
// "Checking…" only until its own check is done. A part whose request failed
// turns its stages to Unknown with the reason, and leaves the others alone.
//
// Type imports only, so the browser can use it.

import {
  PART_STAGES,
  PIPELINE_ORDER,
  PIPELINE_PARTS,
  STAGE_NAME,
  type DatasetPart,
  type PartFailure,
  type PipelinePart,
  type PipelineParts,
  type PipelineStage,
  type PipelineStatusReport,
  type SourcesPart,
  type StageId,
  type WorkoutsPart,
} from './types';

type AnyPart = SourcesPart | DatasetPart | WorkoutsPart | PartFailure | undefined;

export function isPartFailure(p: AnyPart): p is PartFailure {
  return p !== undefined && 'error' in p;
}

function ok<T extends SourcesPart | DatasetPart | WorkoutsPart>(p: T | PartFailure | undefined): T | null {
  return p !== undefined && !isPartFailure(p) ? p : null;
}

/** What a stage is waiting on while its check runs. */
const CHECKING_DETAIL: Record<StageId, string> = {
  health_auto_export: 'Asking the export server for a few recent records.',
  health_api: 'Asking the export server for a few recent records.',
  oura_api: 'Checking the Oura connection.',
  data_quality: 'Waiting for the health history to load; on a cold start it is read in full, which takes a few seconds.',
  intelligence: 'Waiting for the health history to load; on a cold start it is read in full, which takes a few seconds.',
  dashboard: 'Waiting for the first answer from the server.',
};

/** A stage whose part has not answered yet, or whose request failed. */
export function placeholderStage(id: StageId, failure: string | null = null): PipelineStage {
  return failure === null
    ? { id, name: STAGE_NAME[id], status: 'checking', detail: CHECKING_DETAIL[id], derivedFrom: 'The check is still running.', observationCount: null, lastObservationAt: null }
    : {
        id,
        name: STAGE_NAME[id],
        status: 'unknown',
        detail: `The check could not be read: ${failure}`,
        derivedFrom: 'The request for this part of the report failed.',
        observationCount: null,
        lastObservationAt: null,
      };
}

function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

/**
 * The report from the parts given. `requested` lists the parts being checked:
 * one of them that is absent is still pending. A part not requested at all (the
 * Sources tab asks for the workout sources only) is not pending; its stages
 * keep their placeholders, which that caller never shows.
 */
export function assembleReport(
  parts: PipelineParts,
  options: { requested?: PipelinePart[]; now?: () => number } = {}
): PipelineStatusReport {
  const requested = options.requested ?? PIPELINE_PARTS;
  const pending = requested.filter(p => parts[p] === undefined);
  const failures = requested.filter(p => isPartFailure(parts[p]));
  const sources = ok(parts.sources);
  const dataset = ok(parts.dataset);
  const workouts = ok(parts.workouts);
  const failureOf = (p: PipelinePart): string | null => {
    const part = parts[p];
    return isPartFailure(part) ? part.error : null;
  };

  const mode = sources?.mode ?? dataset?.mode ?? 'live';
  const summary = dataset?.dataset ?? {
    source: mode,
    observationCount: 0,
    metricCount: 0,
    workouts: 0,
    referenceKey: '',
    windowStartKey: '',
    timezone: '',
    lastObservationAt: null,
    error: failureOf('dataset'),
  };

  // Every stage comes from its part, or stands in for it.
  const byId = new Map<StageId, PipelineStage>();
  for (const part of PIPELINE_PARTS) {
    const own = part === 'sources' ? sources?.stages : part === 'dataset' ? dataset?.stages : undefined;
    for (const id of PART_STAGES[part]) {
      const stage = own?.find(s => s.id === id);
      byId.set(id, stage ?? placeholderStage(id, failureOf(part)));
    }
  }
  // The export stages carry the dataset's counts once it is in.
  for (const id of ['health_auto_export', 'health_api'] as const) {
    const stage = byId.get(id)!;
    if (sources && dataset) byId.set(id, { ...stage, observationCount: summary.observationCount, lastObservationAt: summary.lastObservationAt });
  }
  const answered = [sources, dataset, workouts].some(p => p !== null);
  byId.set(
    'dashboard',
    answered
      ? {
          id: 'dashboard',
          name: STAGE_NAME.dashboard,
          status: 'healthy',
          detail: 'This request is the check: the pipeline route compiled, ran and returned this report.',
          derivedFrom: 'The status endpoint responded to this request.',
          observationCount: null,
          lastObservationAt: null,
        }
      : placeholderStage('dashboard', pending.length ? null : 'no part of the report could be read.')
  );
  const stages = PIPELINE_ORDER.map(id => byId.get(id)!);

  const healthy = stages.filter(s => s.status === 'healthy').length;
  const probeOk = sources?.probe.outcome === 'ok';
  const ouraOk = sources?.ouraOk ?? false;
  const configured = sources?.config.healthApiConfigured ?? false;
  const summarySentence = pending.length
    ? 'Checking each stage…'
    : failures.length
      ? `Part of the status could not be read (${failures.join(', ')}). ${healthy} of ${stages.length} stages confirmed by real checks.`
      : mode === 'live'
        ? probeOk || ouraOk
          ? `Live mode: ${healthy} of ${stages.length} stages confirmed by real checks; ${summary.observationCount} observations as of ${dayOf(summary.lastObservationAt)}.`
          : !configured
            ? `Live mode, but no live source answered. ${healthy} of ${stages.length} stages confirmed; the dashboard is showing a connection error rather than demo data.`
            : `Live mode, but the export API did not answer (${sources?.probe.outcome}). ${healthy} of ${stages.length} stages confirmed; the dashboard is showing a connection error rather than demo data.`
        : probeOk
          ? `Demo mode: the committed fixtures are being served. The configured export server answered a probe, but every number on the dashboard still comes from the fixtures. ${healthy} of ${stages.length} stages confirmed by real checks.`
          : `Demo mode: the committed fixtures are being served, and nothing upstream could be confirmed. ${healthy} of ${stages.length} stages are confirmed healthy.`;

  const times = [sources, dataset, workouts].filter(p => p !== null).map(p => p!.checkedAt).sort();
  return {
    mode,
    stages,
    config: sources?.config ?? { healthApiConfigured: false, healthApiHost: null, probeMetric: null },
    probe: sources?.probe ?? {
      attempted: false,
      url: null,
      metric: null,
      outcome: 'not_configured',
      httpStatus: null,
      records: null,
      detail: failureOf('sources') ?? 'Checking…',
      durationMs: null,
    },
    dataset: summary,
    cache: dataset?.cache ?? { ttlSeconds: 0, ageMs: null, hits: 0, misses: 0, keys: 0 },
    workoutSources: workouts?.workoutSources ?? [],
    quality: dataset?.quality ?? null,
    qualityState: dataset ? dataset.qualityState : failureOf('dataset') !== null ? 'failed' : requested.includes('dataset') ? 'computing' : 'unavailable',
    silenced: dataset?.silenced ?? [],
    dataAsOf: summary.lastObservationAt,
    checkedAt: times.at(-1) ?? new Date((options.now ?? Date.now)()).toISOString(),
    summary: summarySentence,
    pending,
  };
}

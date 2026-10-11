// ── Pipeline stage vocabulary (SPEC §10) ────────────────
//
// Types and labels shared by the server-side status resolver and the interface
// that renders it. This module has only type imports, so the browser can use it
// without pulling the server probe into the client bundle.

import type { DataQualityReport } from '../adapters/quality';
import type { SilencedFinding } from '../adapters/quality-silenced';
import type { WorkoutSourceStatus } from '../workout-sources/types';

/** `checking`: the check is still running in the background; its result is on the way. */
export type StageStatus = 'healthy' | 'degraded' | 'checking' | 'unknown' | 'unconfigured';

export type StageId =
  | 'health_auto_export'
  | 'health_api'
  | 'oura_api'
  | 'data_quality'
  | 'intelligence'
  | 'dashboard';

export interface PipelineStage {
  id: StageId;
  name: string;
  status: StageStatus;
  /** Plain-language statement of how the status was derived. */
  detail: string;
  /** What actually produced the status. */
  derivedFrom: string;
  /** Real observation count for this stage, when one exists. */
  observationCount?: number | null;
  /** Newest observation the stage actually carries, when known. */
  lastObservationAt?: string | null;
}

export interface PipelineConfig {
  /** True when both URL and key are present in the server environment. */
  healthApiConfigured: boolean;
  /** Host of the configured Health Auto Export server, never the key. */
  healthApiHost: string | null;
  /** Metric the read probe asks for. */
  probeMetric: string | null;
}

export type ProbeOutcome =
  | 'ok'
  | 'http_error'
  | 'network_error'
  | 'timeout'
  | 'invalid_payload'
  | 'not_configured';

export interface PipelineProbe {
  attempted: boolean;
  url: string | null;
  /** Metric requested by the probe. */
  metric: string | null;
  outcome: ProbeOutcome;
  /** HTTP status when a response arrived. */
  httpStatus: number | null;
  /** Short, non-sensitive description of the outcome. */
  detail: string;
  durationMs: number | null;
  /** Records the probe actually returned. */
  records: number | null;
}

/** What the app is serving right now, measured from the installed dataset. */
export interface PipelineDatasetSummary {
  /** 'demo' when the committed fixtures are in use. */
  source: 'demo' | 'live';
  observationCount: number;
  metricCount: number;
  workouts: number;
  referenceKey: string;
  windowStartKey: string;
  timezone: string;
  /** Newest observation instant in that dataset. */
  lastObservationAt: string | null;
  /** Non-fatal problem encountered while loading it, when there was one. */
  error: string | null;
}

export interface PipelineCacheInfo {
  ttlSeconds: number;
  ageMs: number | null;
  hits: number;
  misses: number;
  keys: number;
}

export interface PipelineStatusReport {
  /** The mode the server is running in (from VITAL_DATA_MODE). */
  mode: 'demo' | 'live';
  stages: PipelineStage[];
  config: PipelineConfig;
  probe: PipelineProbe;
  dataset: PipelineDatasetSummary;
  cache: PipelineCacheInfo;
  /** Detailed-workout sources (Hevy, …): configured or not, and what each holds. */
  workoutSources: WorkoutSourceStatus[];
  /**
   * Problems in what the export delivered — overlapping exports, duplicate
   * readings, missing days, a late start, a stalled automation — each with its
   * fix. Null when no live export was read (demo mode, or the load failed).
   */
  quality: DataQualityReport | null;
  /**
   * Where the checks are: they run in the background after the live data
   * loads, so the report never waits for them. `computing` means fetch
   * /api/pipeline/quality for the result; `unavailable` means no live export
   * was read.
   */
  qualityState: 'ready' | 'computing' | 'failed' | 'unavailable';
  /**
   * Findings the reader silenced. `quality` above already leaves them out, and
   * so do the stage text and counts; this is what the panel lists to restore.
   */
  silenced: SilencedFinding[];
  /** Reference day / instant of the dataset driving the dashboard. */
  dataAsOf: string | null;
  checkedAt: string;
  /** Human sentence for the panel header. */
  summary: string;
  /**
   * Parts still being checked when the report was put together in the browser
   * from parts (see `assemble.ts`); their stages read "Checking…" and their
   * other fields are placeholders. Empty for a report the server assembled.
   */
  pending: PipelinePart[];
}

// ── Parts: the report, checked piece by piece ───────────
//
// GET /api/pipeline/status?part=… answers one part, so the panel can show
// each stage as soon as its own check is done instead of waiting for the
// slowest (a cold dataset load). `assembleReport` puts parts together; the
// full report is the same function over all three.

export type PipelinePart = 'sources' | 'dataset' | 'workouts';
export const PIPELINE_PARTS: PipelinePart[] = ['sources', 'dataset', 'workouts'];

/** The export server and Oura: configuration and the two read-only probes. */
export interface SourcesPart {
  part: 'sources';
  mode: 'demo' | 'live';
  config: PipelineConfig;
  probe: PipelineProbe;
  /** Oura answered its probe. */
  ouraOk: boolean;
  /** health_auto_export, health_api and oura_api. */
  stages: PipelineStage[];
  checkedAt: string;
}

/** The dataset the app is serving, and the data-quality checks on it. */
export interface DatasetPart {
  part: 'dataset';
  mode: 'demo' | 'live';
  dataset: PipelineDatasetSummary;
  cache: PipelineCacheInfo;
  quality: DataQualityReport | null;
  qualityState: PipelineStatusReport['qualityState'];
  silenced: SilencedFinding[];
  /** data_quality and intelligence. */
  stages: PipelineStage[];
  checkedAt: string;
}

/** Detailed-workout sources (Hevy, …). */
export interface WorkoutsPart {
  part: 'workouts';
  workoutSources: WorkoutSourceStatus[];
  checkedAt: string;
}

/** A part whose request failed: its stages read Unknown, with the reason. */
export interface PartFailure {
  error: string;
}

export interface PipelineParts {
  sources?: SourcesPart | PartFailure;
  dataset?: DatasetPart | PartFailure;
  workouts?: WorkoutsPart | PartFailure;
}

/** The stages each part reports. */
export const PART_STAGES: Record<PipelinePart, StageId[]> = {
  sources: ['health_auto_export', 'health_api', 'oura_api'],
  dataset: ['data_quality', 'intelligence'],
  workouts: [],
};

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  checking: 'Checking…',
  unknown: 'Unknown',
  unconfigured: 'Not configured',
};

/** The stages this build actually checks, in order. */
export const PIPELINE_ORDER: StageId[] = [
  'health_auto_export',
  'health_api',
  'oura_api',
  'data_quality',
  'intelligence',
  'dashboard',
];

export const STAGE_NAME: Record<StageId, string> = {
  health_auto_export: 'Health Auto Export',
  health_api: 'Health API',
  oura_api: 'Oura Ring',
  data_quality: 'Data quality',
  intelligence: 'Intelligence',
  dashboard: 'Dashboard',
};

/** GET /api/pipeline/quality: the data-quality checks, once they have finished. */
export interface PipelineQualityResponse {
  state: 'ready' | 'computing' | 'failed' | 'unavailable';
  quality: DataQualityReport | null;
  /** Why there is no report, when there is none. */
  detail: string | null;
  /** Findings the reader silenced: left out of `quality`, listed here to restore. */
  silenced: SilencedFinding[];
}

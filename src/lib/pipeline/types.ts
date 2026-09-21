// ── Pipeline stage vocabulary (SPEC §10) ────────────────
//
// Types and labels shared by the server-side status resolver and the interface
// that renders it. This module has no imports, so the browser can use it
// without pulling the server probe into the client bundle.

export type StageStatus = 'healthy' | 'degraded' | 'unknown' | 'unconfigured';

export type StageId =
  | 'health_auto_export'
  | 'health_api'
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
  /** Reference day / instant of the dataset driving the dashboard. */
  dataAsOf: string | null;
  checkedAt: string;
  /** Human sentence for the panel header. */
  summary: string;
}

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unknown: 'Unknown',
  unconfigured: 'Not configured',
};

/** The stages this build actually checks, in order. */
export const PIPELINE_ORDER: StageId[] = [
  'health_auto_export',
  'health_api',
  'intelligence',
  'dashboard',
];

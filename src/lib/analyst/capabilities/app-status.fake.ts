// ── Fakes for the app-status capabilities ───────────────────────────────────
//
// Saved maps, the coverage of each, quality findings and the pipeline report.
// Every fixture
// carries values that must NOT reach the model (a name, a host, a coordinate, a
// token) so a leak is findable by searching the serialized result.

import type { CoverageResponse } from '../../activity-maps/service';
import type { ActivityMap } from '../../activity-maps/types';
import type { DataQualityReport } from '../../adapters/quality';
import { addDays } from '../../analytics/windows';
import type { PipelineQualityResponse, PipelineStatusReport } from '../../pipeline/types';
import { REF } from './test-dataset.fake';

/** Values that must never appear in a result. */
export const HOST = 'export.internal.example.com';
export const TOKEN = 'canary-probe-token-91x';
export const NAME = 'Zaphod Unique Beeblebrox';
export const LAT = 41.87811;
export const LON = -87.62983;

export const MAPS: ActivityMap[] = [
  { id: 'map-1', name: 'Home loop', bbox: { south: 41.86, west: -87.64, north: 41.9, east: -87.6 }, settings: { activityTypes: ['Running'], metric: 'frequency', basemap: { provider: 'carto', style: 'light' } as never, range: 'all' }, position: 0, revision: 1, updatedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'map-2', name: 'Lake trail', bbox: { south: 41.7, west: -87.7, north: 41.75, east: -87.62 }, settings: { activityTypes: null, metric: 'frequency', basemap: { provider: 'carto', style: 'light' } as never, range: 'all' }, position: 1, revision: 1, updatedAt: '2026-08-01T10:00:00.000Z' },
];

/** What the map service answers for one box: routes (coordinates) and the totals the analyst may keep. */
export function coverageOf(over: Partial<CoverageResponse> = {}, workouts = 7): CoverageResponse {
  return {
    available: true,
    reason: null,
    unreadWorkouts: 0,
    referenceKey: REF,
    range: { fromKey: addDays(REF, -29), toKey: REF },
    mode: 'demo',
    paths: [{ coords: [LAT, LON, LAT + 0.001, LON + 0.001], count: 3, types: ['Running'], first: '2026-09-02', last: '2026-10-01' }],
    scale: null,
    toleranceM: 20,
    smoothingM: null,
    truncated: false,
    types: [{ type: 'Running', workouts: 5 }],
    highlights: {
      totals: {
        workouts,
        seconds: 14_400,
        distanceM: 52_000,
        byType: [
          { type: 'Running', workouts: 5, seconds: 9_000, distanceM: 40_000 },
          { type: 'Walking', workouts: 2, seconds: 5_400, distanceM: 12_000 },
        ],
      },
      coverage: { uniqueDistanceM: 30_000, newDistanceM: 6_000, newSinceKey: addDays(REF, -29) },
      longest: { workoutId: 'w-1', type: 'Running', dayKey: '2026-09-20', distanceM: 15_000, seconds: 5_000, lines: [[LAT, LON, LAT + 0.01, LON + 0.01]] },
      visits: { first: '2026-09-02', last: '2026-10-01' },
      effort: { meanHeartRate: 142, measuredShare: 0.8, hardest: { lines: [[LAT, LON]], count: 3, lengthM: 400, first: '2026-09-02', last: '2026-10-01', meanHeartRate: 160 } },
    },
    ...over,
  };
}

export const REPORT: DataQualityReport = {
  checks: [
    { id: 'stale', label: 'New data arriving', outcome: 'pass', summary: 'Data arrived in the last day.' },
    { id: 'missing-days', label: 'Missing days', outcome: 'flagged', summary: '3 days missing.' },
  ],
  findings: [
    {
      check: 'missing-days',
      severity: 'warning',
      title: 'Days are missing from the export',
      detail: 'Step count has no readings on 3 days the watch was worn.',
      metrics: ['step_count'],
      ranges: [{ from: '2026-09-01', to: '2026-09-03', days: 3 }],
      affectedDays: 3,
      remedy: ['In Health Auto Export, check that the automation sends step count.', `Check the server at https://${HOST}/api.`],
    },
  ],
};

export const QUALITY: PipelineQualityResponse = {
  state: 'ready',
  quality: REPORT,
  detail: null,
  silenced: [{ checkId: 'late-start', checkLabel: 'History that starts late', metricId: 'dietary_energy', metricLabel: 'Dietary energy', title: 'Food log starts late', severity: 'info', found: true, firstDay: '2025-01-01', lastDay: '2025-02-01' }],
};

export const PIPELINE: PipelineStatusReport = {
  mode: 'live',
  stages: [
    { id: 'health_auto_export', name: 'Health Auto Export', status: 'degraded', detail: `The configured export server at ${HOST} did not answer. token=${TOKEN}`, derivedFrom: `GET https://${HOST}/api/metrics/x`, observationCount: 120_000, lastObservationAt: `${addDays(REF, -2)}T18:00:00.000Z` },
    { id: 'oura_api', name: 'Oura Ring', status: 'healthy', detail: 'Oura answered a read-only probe with 2 record(s) in 120 ms.', derivedFrom: 'GET /v2/usercollection/daily_sleep', observationCount: null, lastObservationAt: null },
    { id: 'data_quality', name: 'Data quality', status: 'degraded', detail: '1 finding to fix.', derivedFrom: '5 checks', observationCount: null, lastObservationAt: null },
    { id: 'dashboard', name: 'Dashboard', status: 'healthy', detail: 'This request is the check.', derivedFrom: 'The status endpoint responded.', observationCount: null, lastObservationAt: null },
  ],
  config: { healthApiConfigured: true, healthApiHost: HOST, probeMetric: 'step_count' },
  probe: { attempted: true, url: HOST, metric: 'step_count', outcome: 'timeout', httpStatus: null, detail: `Timed out reaching ${HOST} with key ${TOKEN}`, durationMs: 5000, records: null },
  dataset: { source: 'live', observationCount: 120_000, metricCount: 40, workouts: 420, referenceKey: REF, windowStartKey: addDays(REF, -399), timezone: 'America/Chicago', lastObservationAt: `${addDays(REF, -2)}T18:00:00.000Z`, error: null },
  cache: { ttlSeconds: 300, ageMs: 1000, hits: 3, misses: 1, keys: 2 },
  workoutSources: [{ id: 'hevy', displayName: 'Hevy', configured: true, host: 'api.hevy.example.com', origin: 'live', sessions: 88, lastSyncAt: `${addDays(REF, -1)}T07:00:00.000Z`, newestSessionAt: `${addDays(REF, -1)}T06:00:00.000Z`, lastError: `bearer ${TOKEN}` }],
  quality: REPORT,
  qualityState: 'ready',
  silenced: [],
  dataAsOf: `${addDays(REF, -2)}T18:00:00.000Z`,
  checkedAt: `${REF}T12:00:00.000Z`,
  summary: `Live mode, but the export API did not answer (timeout) at ${HOST}.`,
  pending: [],
};

// ── Fallback dataset meta ───────────────────────────────
//
// Used only when the layout could not resolve a dataset at all (a live failure).
// It says exactly that, so no freshness claim is made about data that was never
// loaded.

import type { ClientDatasetMeta } from '@/lib/adapters/meta';

export const FALLBACK_CLIENT_META: ClientDatasetMeta = {
  mode: 'demo',
  live: false,
  dataAsOf: '',
  dataAsOfKey: '',
  referenceKey: '',
  windowStartKey: '',
  timezone: 'UTC',
  generatedAt: '',
  observationCount: 0,
  metricCount: 0,
  workouts: 0,
  sources: [],
  host: null,
  cacheTtlSeconds: 0,
  dedupe: null,
  provenance: [],
  summary: 'No dataset was loaded for this request.',
};

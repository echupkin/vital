// ── Adapters ────────────────────────────────────────────
//
// Client-safe surface: the dataset accessors, the demo adapter, the metric
// mapping table and the pure helpers (units, sources, normalization, dataset
// metadata). These may be imported from components.
//
// Server-only entry points are deliberately NOT re-exported here so they can
// never be pulled into a browser bundle by accident:
//   ./hae      — the HTTP client (reads the token)
//   ./live     — the live adapter / dataset loader
//   ./runtime  — the mode switch used by the layout and the routes

export type { HealthDataAdapter, MetricQuery } from './types';
export { DemoHealthDataAdapter, demoAdapter } from './demo';
export * from './dataset';
export * from './units';
export * from './sources';
export * from './normalize';
export type { ClientDatasetMeta, DedupeSummary } from './meta';
export { TtlCache, liveCache } from './cache';

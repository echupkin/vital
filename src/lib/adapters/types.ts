// ── Health Data Adapter Interface ──────────────────────
//
// Typed boundary between Vital and health data sources.
// Demo adapter returns deterministic fixture data.
// Live adapter is explicitly not implemented in phase 1.

import type {
  MetricObservation,
  SleepObservation,
  BloodPressureObservation,
  WorkoutRecord,
  MetricCoverage,
} from '../metrics/types';

export interface MetricQuery {
  metricId: string;
  from?: string;
  to?: string;
}

export interface HealthDataAdapter {
  /** Load all metric data for a given metric within an optional window */
  getMetricData(query: MetricQuery): Promise<MetricObservation[]>;

  /** Load sleep records (stored in separate collection) */
  getSleepData(from?: string, to?: string): Promise<SleepObservation[]>;

  /** Load blood pressure records (stored in separate collection) */
  getBloodPressureData(from?: string, to?: string): Promise<BloodPressureObservation[]>;

  /** Load workouts */
  getWorkouts(from?: string, to?: string): Promise<WorkoutRecord[]>;

  /** Get coverage info for a metric */
  getCoverage(metricId: string): Promise<MetricCoverage | null>;

  /** Get all available metric IDs with coverage */
  getAvailableMetrics(): Promise<string[]>;

  /** Whether this adapter is connected to a live source */
  readonly isLive: boolean;

  /** Human-readable label for the adapter */
  readonly label: string;
}

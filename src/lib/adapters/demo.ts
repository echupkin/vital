// ── Demo Health Data Adapter ───────────────────────────
//
// Reads the committed health-fixtures.json at runtime.
// All data is deterministic, labeled as demo, and never mixed with live data.

import fixturesJson from '../../data/health-fixtures.json';
import type { HealthFixtures, MetricObservation, SleepObservation, BloodPressureObservation, WorkoutRecord, MetricCoverage } from '../metrics/types';
import type { HealthDataAdapter, MetricQuery } from './types';

const fixtures = fixturesJson as unknown as HealthFixtures;

function parseWindow(from?: string, to?: string): { fromDate: Date; toDate: Date } {
  const now = new Date('2026-09-17T23:59:59.999-05:00');
  return {
    fromDate: from ? new Date(from) : new Date(fixtures.windowStart),
    toDate: to ? new Date(to) : now,
  };
}

export class DemoHealthDataAdapter implements HealthDataAdapter {
  readonly isLive = false;
  readonly label = 'Demo';

  async getMetricData(query: MetricQuery): Promise<MetricObservation[]> {
    const { fromDate, toDate } = parseWindow(query.from, query.to);
    const records = (fixtures.metrics[query.metricId] as MetricObservation[]) || [];
    return records.filter(r => {
      const d = new Date(r.date);
      return d >= fromDate && d <= toDate;
    });
  }

  async getSleepData(from?: string, to?: string): Promise<SleepObservation[]> {
    const { fromDate, toDate } = parseWindow(from, to);
    const records = (fixtures.metrics['sleep_analysis'] as SleepObservation[]) || [];
    return records.filter(r => {
      const d = new Date(r.date);
      return d >= fromDate && d <= toDate;
    });
  }

  async getBloodPressureData(from?: string, to?: string): Promise<BloodPressureObservation[]> {
    const { fromDate, toDate } = parseWindow(from, to);
    const records = (fixtures.metrics['blood_pressure'] as BloodPressureObservation[]) || [];
    return records.filter(r => {
      const d = new Date(r.date);
      return d >= fromDate && d <= toDate;
    });
  }

  async getWorkouts(from?: string, to?: string): Promise<WorkoutRecord[]> {
    const { fromDate, toDate } = parseWindow(from, to);
    return (fixtures.workouts || []).filter(w => {
      const d = new Date(w.start_time);
      return d >= fromDate && d <= toDate;
    });
  }

  async getCoverage(metricId: string): Promise<MetricCoverage | null> {
    return fixtures.coverage[metricId] || null;
  }

  async getAvailableMetrics(): Promise<string[]> {
    return Object.keys(fixtures.coverage);
  }

  /** Access the raw fixtures directly (for SSR / build-time loading) */
  getRawFixtures(): HealthFixtures {
    return fixtures;
  }
}

// Singleton
export const demoAdapter = new DemoHealthDataAdapter();

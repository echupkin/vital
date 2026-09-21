// ── Analytics utilities ─────────────────────────────────
//
// Baseline windows, comparison windows, metric-specific aggregation,
// missing-data handling, timezone/day-boundary helpers, correlation pairing.
//
// Sub-modules:
//   windows.ts       timezone-aware calendar-day windows and day keys
//   stats.ts         aggregation primitives and Pearson correlation
//   comparisons.ts   complete-day comparison windows (accumulating metrics)
//   status.ts        the single status vocabulary (SPEC §5)
//   narrative.ts     all generated interpretation copy
//   relationships.ts relationship explorer pairing + coefficient
//   coverage.ts      logged-day coverage and per-metric availability
//   workouts.ts      workout filtering, grouping and comparison rules
//   insights.ts      evidence-gated insight generation
//   reports.ts       weekly / monthly reports composed from the dataset

export * from './windows';
export * from './stats';
export * from './comparisons';
export * from './status';
export * from './narrative';
export * from './relationships';
export * from './coverage';
export * from './bloodPressure';
export * from './workouts';
export * from './insights';
export * from './reports';

import type { MetricObservation, SleepObservation } from '../metrics/types';
import { mean, stddev } from './stats';

// ── Date helpers (legacy Date-based surface, retained) ──

export function parseDate(d: string | Date): Date {
  return typeof d === 'string' ? new Date(d) : d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function dateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

export function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

// ── Observed-value extraction ──────────────────────────

export function extractValues(records: MetricObservation[]): number[] {
  return records.map(r => r.qty).filter(v => v != null && !isNaN(v));
}

export function extractSleepValues(
  records: SleepObservation[],
  field: 'durationMinutes' | 'asleepMinutes' | 'inBedMinutes'
): number[] {
  return records.map(r => r[field]).filter(v => v != null && !isNaN(v));
}

// ── Anomaly detection (documented robust rolling baseline) ─

export interface AnomalyResult {
  date: string;
  value: number;
  baseline: number;
  stddevAbove: number;
  isAnomaly: boolean;
}

/** Rolling anomaly: |value - rolling mean| > threshold standard deviations. */
export function detectAnomalies(
  values: { date: string; value: number }[],
  windowSize: number = 14,
  threshold: number = 2
): AnomalyResult[] {
  const results: AnomalyResult[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize);
    const windowValues = values.slice(start, i).map(v => v.value);
    if (windowValues.length < 7) {
      results.push({
        date: values[i].date,
        value: values[i].value,
        baseline: NaN,
        stddevAbove: NaN,
        isAnomaly: false,
      });
      continue;
    }
    const m = mean(windowValues);
    const s = stddev(windowValues);
    const stddevAbove = (values[i].value - m) / (s || 1);
    results.push({
      date: values[i].date,
      value: values[i].value,
      baseline: m,
      stddevAbove,
      isAnomaly: Math.abs(stddevAbove) > threshold,
    });
  }
  return results;
}

// ── Trend summary ─────────────────────────────────────

export interface TrendSummary {
  direction: 'up' | 'down' | 'stable' | 'insufficient_data';
  delta: number;
  deltaPercent: number | null;
  meanRecent: number;
  meanPrior: number;
  recentCount: number;
  priorCount: number;
  description: string;
}

/**
 * Relative change over the most recent window versus the prior data.
 * `formatter` is required so the description never emits a raw float.
 */
export function computeTrendSummary(
  values: { date: string; value: number }[],
  recentDays: number = 7,
  formatter?: (v: number) => string
): TrendSummary {
  const fmt = formatter ?? ((v: number) => v.toFixed(1));
  if (values.length < 3) {
    return {
      direction: 'insufficient_data',
      delta: NaN, deltaPercent: null,
      meanRecent: NaN, meanPrior: NaN,
      recentCount: values.length, priorCount: 0,
      description: 'Not enough data to identify a trend.',
    };
  }

  const sorted = [...values].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1].date;
  const cutoff = new Date(`${last}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - recentDays);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const recent = sorted.filter(v => v.date >= cutoffKey).map(v => v.value);
  const prior = sorted.filter(v => v.date < cutoffKey).map(v => v.value);

  if (recent.length < 2 || prior.length < 2) {
    return {
      direction: 'insufficient_data',
      delta: NaN, deltaPercent: null,
      meanRecent: recent.length > 0 ? mean(recent) : NaN,
      meanPrior: prior.length > 0 ? mean(prior) : NaN,
      recentCount: recent.length, priorCount: prior.length,
      description: 'Not enough data in the comparison window.',
    };
  }

  const mr = mean(recent);
  const mp = mean(prior);
  const delta = mr - mp;
  const pct = mp !== 0 ? (delta / mp) * 100 : null;
  const stable = Math.abs(pct ?? 0) < 3;
  const direction: TrendSummary['direction'] = stable ? 'stable' : delta > 0 ? 'up' : 'down';

  let description: string;
  if (scaleIsFlat(recent) && scaleIsFlat(prior)) {
    description = `No change over the last ${recentDays} days (${fmt(mr)}).`;
  } else if (stable) {
    description = `Broadly unchanged over the last ${recentDays} days (${fmt(mr)} vs ${fmt(mp)} in the prior period).`;
  } else if (pct == null) {
    description = `${delta > 0 ? 'Higher' : 'Lower'} by ${fmt(Math.abs(delta))} over the last ${recentDays} days; the prior period averaged 0, so no percentage is shown.`;
  } else {
    description = `${delta > 0 ? 'Higher' : 'Lower'} by ${Math.abs(pct).toFixed(1)}% over the last ${recentDays} days (${fmt(mr)} vs ${fmt(mp)} in the prior period).`;
  }

  return {
    direction, delta, deltaPercent: pct,
    meanRecent: mr, meanPrior: mp,
    recentCount: recent.length, priorCount: prior.length,
    description,
  };
}

function scaleIsFlat(values: number[]): boolean {
  return values.every(v => v === values[0]);
}
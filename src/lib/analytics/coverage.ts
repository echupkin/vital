// ── Coverage and logged-day statistics ──────────────────
//
// Nutrition intake is *logged*, not measured: a day with no food log has no
// observation, which is not a day of zero intake. Every statistic built here is
// therefore taken over logged days only, and always reports how many days that
// was out of how many could have been recorded.

import { getMetric } from '../metrics/registry';
import type { MetricDefinition } from '../metrics/types';
import { REFERENCE_KEY, coverageFor, seriesFor } from '../adapters/dataset';
import { formatMetricWithUnit } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import { mean, median, min as minOf, max as maxOf, sum } from './stats';
import {
  containsDay,
  formatDayKeyLong,
  formatDayKeyShort,
  trailingWindow,
  windowDays,
  windowRangeLabel,
  type DayWindow,
} from './windows';

export interface CoverageFact {
  metricId: string;
  metricName: string;
  /** Days that actually carry a value. */
  observedDays: number;
  /** Days the window could have carried. */
  expectedDays: number;
  samplingFrequency: string;
  sources: string[];
  firstKey: string;
  lastKey: string;
  /** Number of stored records (may exceed observed days for re-measurements). */
  observations: number;
}

function dayKeyOf(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
}

export function coverageFact(metricId: string): CoverageFact | null {
  const cov = coverageFor(metricId);
  const meta = getMetric(metricId);
  const series = seriesFor(metricId);
  if (!cov && series.length === 0) return null;
  return {
    metricId,
    metricName: meta?.displayName ?? metricId,
    observedDays: cov?.observedDays ?? series.length,
    expectedDays: cov?.expectedDays ?? series.length,
    samplingFrequency: cov?.samplingFrequency ?? meta?.aggregationStrategy ?? 'unknown',
    sources: cov?.sourceNames ?? [...new Set(series.map(p => p.source))],
    firstKey: dayKeyOf(cov?.firstObservation ?? series[0]?.key ?? REFERENCE_KEY),
    lastKey: dayKeyOf(cov?.lastObservation ?? series[series.length - 1]?.key ?? REFERENCE_KEY),
    observations: series.length,
  };
}

/** '171 of 181 days recorded · daily' — never a bare percentage. */
export function coverageSentence(metricId: string): string {
  const fact = coverageFact(metricId);
  if (!fact) return 'No coverage record for this metric.';
  return `${fact.observedDays} of ${fact.expectedDays} days recorded · ${fact.samplingFrequency}`;
}

export interface LoggedDayStats {
  metricId: string;
  metricName: string;
  window: DayWindow;
  /** Days in the window that carry a logged value. */
  loggedDays: number;
  /** Calendar days in the window. */
  windowDays: number;
  /** Whole-dataset coverage, for the "of 180" part of the sentence. */
  datasetLoggedDays: number;
  datasetExpectedDays: number;
  /** True when the metric accumulates within a day (a per-day total). */
  accumulating: boolean;
  /** Mean over logged days only. NaN when nothing was logged. */
  dailyAverage: number;
  /** Sum over logged days only (NaN for non-accumulating metrics). */
  windowTotal: number;
  median: number;
  min: number;
  max: number;
  latestKey: string | null;
  latestValue: number;
  values: number[];
  points: { key: string; value: number }[];
  /** 'average over 74 logged days of 90' */
  averageLabel: string;
  /** '142 logged days of 180 in the dataset' */
  coverageLabel: string;
  /** True when a statistic may be shown at all. */
  sufficient: boolean;
}

/** Minimum logged days before an average is shown for a logged metric. */
export const MIN_LOGGED_DAYS = 3;

/**
 * Statistics over the logged days inside `days`, with the coverage of the
 * window and of the whole dataset stated alongside them. Missing days are
 * excluded; they are never counted as zero.
 */
export function loggedDayStats(
  metricId: string,
  refKey: string = REFERENCE_KEY,
  days = 90,
  options: { meta?: MetricDefinition } = {}
): LoggedDayStats {
  const meta = options.meta ?? getMetric(metricId);
  const window = trailingWindow(refKey, days, `Last ${days} days`);
  const points = seriesFor(metricId).filter(p => containsDay(window, p.key));
  const values = points.map(p => p.value);
  const accumulating = meta?.aggregationStrategy === 'sum';
  const fact = coverageFact(metricId);
  const latest = points.length ? points[points.length - 1] : undefined;
  const sufficient = values.length >= Math.max(MIN_LOGGED_DAYS, meta?.minObservations ?? 1);

  return {
    metricId,
    metricName: meta?.displayName ?? metricId,
    window,
    loggedDays: values.length,
    windowDays: windowDays(window),
    datasetLoggedDays: fact?.observedDays ?? values.length,
    datasetExpectedDays: fact?.expectedDays ?? windowDays(window),
    accumulating,
    dailyAverage: mean(values),
    windowTotal: accumulating ? sum(values) : NaN,
    median: median(values),
    min: minOf(values),
    max: maxOf(values),
    latestKey: latest?.key ?? null,
    latestValue: latest?.value ?? NaN,
    values,
    points: points.map(p => ({ key: p.key, value: p.value })),
    averageLabel:
      values.length === 0
        ? `no logged days in ${windowRangeLabel(window)}`
        : `average over ${values.length} logged ${values.length === 1 ? 'day' : 'days'} of ${windowDays(window)}`,
    coverageLabel: fact
      ? `${fact.observedDays} logged days of ${fact.expectedDays} in the dataset`
      : 'no coverage record',
    sufficient,
  };
}

/** Formatted average, or an explicit statement that nothing was logged. */
export function loggedAverageLabel(
  metricId: string,
  stats: LoggedDayStats,
  system: UnitSystem = 'metric'
): string {
  if (!stats.sufficient) return 'Not enough logged days';
  return formatMetricWithUnit(metricId, stats.dailyAverage, system);
}

export interface MetricAvailability {
  metricId: string;
  displayName: string;
  category: string;
  registered: boolean;
  hasData: boolean;
  observations: number;
  coverage: CoverageFact | null;
  unavailableReason: string | null;
}

export function metricAvailability(metricId: string): MetricAvailability {
  const meta = getMetric(metricId);
  const fact = coverageFact(metricId);
  const observations = seriesFor(metricId).length;
  return {
    metricId,
    displayName: meta?.displayName ?? metricId,
    category: meta?.category ?? 'unknown',
    registered: !!meta,
    hasData: observations > 0,
    observations,
    coverage: fact,
    unavailableReason: meta?.unavailableReason ?? null,
  };
}

/** Whole-dataset coverage table, ordered as the registry is. */
export function availabilityTable(metricIds: string[]): MetricAvailability[] {
  return metricIds.map(metricAvailability);
}

export function dayLabel(key: string, long = false): string {
  return long ? formatDayKeyLong(key) : formatDayKeyShort(key);
}

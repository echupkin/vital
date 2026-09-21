// ── Complete-window comparisons (SPEC §9) ───────────────
//
// Accumulating metrics (the `sum` strategy) are still filling up while the
// current day is in progress. Comparing "6 complete days so far" with "7 full
// days" makes every such metric look as though it fell, so:
//
//   * the in-progress day is removed from the evaluated window,
//   * the baseline window is shortened to exactly the same number of complete
//     days, ending the day before the evaluated window starts,
//   * both sides are therefore always like-for-like.
//
// Non-accumulating metrics (an average, a latest value, a count of readings) are
// complete for the final day and keep the full requested window.

import { getMetric } from '../metrics/registry';
import type { AggregationStrategy, MetricDefinition } from '../metrics/types';
import { REFERENCE_KEY, excludePartialForSum, isAccumulating, seriesFor } from '../adapters/dataset';
import { compareValues, type ComparisonResult } from './stats';
import {
  addDays,
  containsDay,
  formatDayKeyLong,
  makeWindow,
  previousWindow,
  trailingWindow,
  windowDays,
  windowRangeLabel,
  type DayWindow,
} from './windows';

export interface WindowComparisonOptions {
  /** Metric definition; looked up from the registry when omitted. */
  meta?: MetricDefinition;
  /** Force the aggregation used for the comparison (e.g. daily averages). */
  strategyOverride?: AggregationStrategy;
  minCount?: number;
  /** Label for the requested window. */
  label?: string;
  /**
   * Anchor the evaluated window on this day instead of the in-progress
   * reference day. Used by the report archive, which evaluates complete weeks
   * and months that have already finished.
   */
  endKey?: string;
  /** Label for the derived baseline window. */
  baselineLabel?: string;
  /**
   * Build the baseline from the (complete-day) evaluated window. Defaults to
   * the same-length window ending the day before the evaluated window.
   */
  baseline?: (evaluated: DayWindow, days: number) => DayWindow;
}

export interface WindowComparison {
  metricId: string;
  /** True when the metric accumulates during the day. */
  accumulating: boolean;
  /** The window the chart and the "latest" reading are taken from. */
  requestedWindow: DayWindow;
  /** The window actually compared (complete days only). */
  evaluatedWindow: DayWindow;
  baselineWindow: DayWindow;
  evaluatedDays: number;
  baselineDays: number;
  /** Days dropped because they had not finished accumulating. */
  excludedDays: string[];
  values: { evaluated: number[]; baseline: number[] };
  counts: { evaluated: number; baseline: number };
  comparison: ComparisonResult;
  /** '6 complete days vs 6 complete days' */
  lengthLabel: string;
  /** 'Sep 11 – Sep 16 vs Sep 5 – Sep 10' */
  rangeLabel: string;
  /** Plain sentence stating the exclusion, or null when nothing was excluded. */
  exclusionNote: string | null;
}

export function compareWindows(
  metricId: string,
  refKey: string = REFERENCE_KEY,
  days = 7,
  options: WindowComparisonOptions = {}
): WindowComparison {
  const meta = options.meta ?? getMetric(metricId);
  const accumulating = isAccumulating(meta);
  const anchor = options.endKey ?? refKey;
  const requestedWindow = trailingWindow(anchor, days, options.label ?? `Last ${days} days`);
  const series = seriesFor(metricId);

  // Which days inside the requested window have not finished accumulating?
  // The in-progress day is the dataset reference day, never the anchor, and it
  // is dropped whether or not a reading exists for it yet: a sum metric that has
  // recorded nothing today is still an incomplete day, so both sides are always
  // compared over the same number of complete days. Days whose sample is flagged
  // partial are dropped as well.
  const inProgressDays: string[] = [];
  if (accumulating && containsDay(requestedWindow, REFERENCE_KEY)) {
    for (let k = REFERENCE_KEY; k <= requestedWindow.endKey; k = addDays(k, 1)) {
      inProgressDays.push(k);
    }
  }
  const excluded: string[] = accumulating
    ? [
        ...new Set([
          ...inProgressDays,
          ...series
            .filter(p => containsDay(requestedWindow, p.key) && p.partial === true)
            .map(p => p.key),
        ]),
      ].sort()
    : [];

  let evaluatedWindow = requestedWindow;
  if (accumulating && excluded.length > 0) {
    const lastExcluded = excluded.reduce((a, b) => (a > b ? a : b), excluded[0]);
    const end = addDays(lastExcluded, -1);
    const trimmed = makeWindow(requestedWindow.startKey, end < requestedWindow.endKey ? end : requestedWindow.endKey, requestedWindow.label);
    if (trimmed.startKey <= trimmed.endKey) evaluatedWindow = trimmed;
  }

  const evaluatedDays = windowDays(evaluatedWindow);
  const baselineWindow = options.baseline
    ? options.baseline(evaluatedWindow, evaluatedDays)
    : previousWindow(evaluatedWindow, evaluatedDays, options.baselineLabel ?? `Prior ${evaluatedDays} days`);

  const ev = excludePartialForSum(
    series.filter(p => containsDay(evaluatedWindow, p.key)),
    meta
  );
  const bs = excludePartialForSum(
    series.filter(p => containsDay(baselineWindow, p.key)),
    meta
  );

  const strategy: AggregationStrategy = options.strategyOverride ?? meta?.aggregationStrategy ?? 'avg';
  const minObs = meta?.minObservations ?? 1;
  const minCount = options.minCount ?? (strategy === 'sum' ? Math.max(minObs, 3) : minObs);
  const comparison = compareValues(ev.values, bs.values, strategy, minCount);

  const baselineDays = windowDays(baselineWindow);
  const lengthLabel =
    accumulating && excluded.length > 0
      ? `${evaluatedDays} complete days vs ${baselineDays} complete days`
      : `${evaluatedDays} days vs ${baselineDays} days`;

  const exclusionNote =
    excluded.length > 0
      ? `Today (${formatDayKeyLong(refKey)}) is still in progress and is excluded from both sides of this comparison, so ${evaluatedDays} complete days are compared with the ${evaluatedDays} complete days before them.`
      : null;

  return {
    metricId,
    accumulating,
    requestedWindow,
    evaluatedWindow,
    baselineWindow,
    evaluatedDays,
    baselineDays,
    excludedDays: [...excluded, ...bs.excludedDays],
    values: { evaluated: ev.values, baseline: bs.values },
    counts: { evaluated: ev.values.length, baseline: bs.values.length },
    comparison,
    lengthLabel,
    rangeLabel: `${windowRangeLabel(evaluatedWindow)} vs ${windowRangeLabel(baselineWindow)}`,
    exclusionNote,
  };
}

/**
 * The shared sentence for a comparison panel that contains at least one
 * accumulating metric. Returns null when no day had to be excluded.
 */
export function exclusionFootnote(comparisons: WindowComparison[]): string | null {
  const affected = comparisons.filter(c => c.exclusionNote);
  if (affected.length === 0) return null;
  const names = affected.map(c => getMetric(c.metricId)?.displayName ?? c.metricId);
  const excluded = affected[0].excludedDays.filter(k => k === REFERENCE_KEY);
  const completeDays = affected[0].evaluatedDays;
  return `${names.join(', ')} accumulate during the day, so today${excluded.length ? ` (${formatDayKeyLong(REFERENCE_KEY)})` : ''} is excluded from both sides and the baseline is shortened to the same number of complete days (${completeDays} vs ${completeDays}). Metrics that are complete for the final day use the full window.`;
}

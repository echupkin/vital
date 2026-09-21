// ── Status vocabulary (SPEC §5) ─────────────────────────
//
// One computation produces every status word in the UI: the briefing headline,
// the hero category chips, the health-story observations and the domain pages.
// Nothing else may invent a status string.

import type { MetricDefinition, AggregationStrategy } from '../metrics/types';
import type { DayPoint } from '../adapters/dataset';
import { excludePartialForSum } from '../adapters/dataset';
import { compareValues, type ComparisonResult } from './stats';
import type { DayWindow } from './windows';

export type BaselineStatus =
  | 'Within baseline'
  | 'Stable'
  | 'Above recent average'
  | 'Below recent average'
  | 'Not enough data';

/** The word used when a category sits inside its normal band. */
export type WithinWord = 'Within baseline' | 'Stable';

export interface StatusInput {
  metricId: string;
  meta: MetricDefinition | undefined;
  evaluated: DayPoint[];
  baseline: DayPoint[];
  /** Percentage band inside which the metric counts as within baseline. */
  band?: number;
  /** Word used for the within-baseline case. */
  withinWord?: WithinWord;
  /**
   * Force the aggregation used for the comparison. Required when the two windows
   * have different lengths: a 6-day total is not comparable with a 30-day total,
   * so sum metrics are compared as daily averages instead.
   */
  strategyOverride?: AggregationStrategy;
  minCountOverride?: number;
}

export interface StatusResult {
  metricId: string;
  status: BaselineStatus;
  withinWord: WithinWord;
  comparison: ComparisonResult;
  counts: { evaluated: number; baseline: number };
  excludedEvaluatedDays: string[];
  excludedBaselineDays: string[];
  /** Whether the underlying data was sufficient to make any statement. */
  sufficient: boolean;
}

const DEFAULT_BAND = 5;

export function computeStatus(input: StatusInput): StatusResult {
  const { metricId, meta, withinWord = 'Within baseline' } = input;
  const band = input.band ?? DEFAULT_BAND;

  const ev = excludePartialForSum(input.evaluated, meta);
  const bs = excludePartialForSum(input.baseline, meta);

  const strategy: AggregationStrategy = input.strategyOverride ?? meta?.aggregationStrategy ?? 'avg';
  const minObs = meta?.minObservations ?? 1;
  const minCount = input.minCountOverride ?? (strategy === 'sum' ? Math.max(minObs, 3) : minObs);

  const comparison = compareValues(ev.values, bs.values, strategy, minCount);
  const sufficient = comparison.valid && comparison.deltaPercent != null;

  let status: BaselineStatus;
  if (!sufficient) {
    status = 'Not enough data';
  } else if (Math.abs(comparison.deltaPercent as number) < band) {
    status = withinWord;
  } else if ((comparison.deltaPercent as number) > 0) {
    status = 'Above recent average';
  } else {
    status = 'Below recent average';
  }

  return {
    metricId,
    status,
    withinWord,
    comparison,
    counts: { evaluated: ev.values.length, baseline: bs.values.length },
    excludedEvaluatedDays: ev.excludedDays,
    excludedBaselineDays: bs.excludedDays,
    sufficient,
  };
}

/** A comparison row for the "What changed?" panels — numeric, never a status word. */
export interface ChangeRow {
  metricId: string;
  label: string;
  comparison: ComparisonResult;
  excludedDays: string[];
  counts: { evaluated: number; baseline: number };
}

export function computeChangeRow(
  label: string,
  metricId: string,
  meta: MetricDefinition | undefined,
  evaluated: DayPoint[],
  baseline: DayPoint[]
): ChangeRow {
  const ev = excludePartialForSum(evaluated, meta);
  const bs = excludePartialForSum(baseline, meta);
  const strategy: AggregationStrategy = meta?.aggregationStrategy ?? 'avg';
  const minObs = meta?.minObservations ?? 1;
  const minCount = strategy === 'sum' ? Math.max(minObs, 3) : minObs;
  return {
    metricId,
    label,
    comparison: compareValues(ev.values, bs.values, strategy, minCount),
    excludedDays: ev.excludedDays,
    counts: { evaluated: ev.values.length, baseline: bs.values.length },
  };
}
/**
 * One numeric summary sentence for a comparison panel. Uses counts and
 * percentages only — never the status vocabulary — so a comparison panel can
 * never contradict the briefing headline.
 */
export function changeRowSummary(rows: ChangeRow[]): string {
  const comparable = rows.filter(r => r.comparison.valid);
  if (comparable.length === 0) {
    return 'There is not enough recorded data in both weeks to compare any of these metrics.';
  }
  const moved = comparable.filter(
    r => r.comparison.delta !== 0 && r.comparison.deltaPercent != null && Math.abs(r.comparison.deltaPercent) >= 5
  );
  const flat = comparable.filter(r => r.comparison.delta === 0);
  const close = comparable.length - moved.length - flat.length;

  const parts = [`${comparable.length} of ${rows.length} metrics have readings in both weeks`];
  parts.push(
    moved.length === 0
      ? 'none moved by 5% or more'
      : `${moved.length} moved by 5% or more`
  );
  if (flat.length > 0) parts.push(`${flat.length} showed no change`);
  if (close > 0) parts.push(`${close} stayed within 5%`);
  return `${parts.join(', ')}.`;
}

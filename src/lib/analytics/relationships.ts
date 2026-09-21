// ── Relationship explorer ───────────────────────────────
//
// Pairs two metric series by calendar day and computes a Pearson coefficient.
// No confidence intervals, significance tests or causal claims are produced.

import { seriesFor, type DayPoint } from '../adapters/dataset';
import type { AggregationStrategy } from '../metrics/types';
import { pearsonCorrelation } from './stats';
import { addDays, type DayWindow } from './windows';

export type Alignment = 'same-day' | 'lagged';

export interface PairPoint {
  key: string;
  x: number;
  y: number;
}

export interface RelationshipResult {
  xMetricId: string;
  yMetricId: string;
  alignment: Alignment;
  /** Days by which X leads Y when alignment is 'lagged'. */
  lagDays: number;
  coefficient: number | null;
  pairedCount: number;
  xCount: number;
  yCount: number;
  valid: boolean;
  /** Why the relationship cannot be shown, when it cannot. */
  insufficientReason: string | null;
  points: PairPoint[];
  window: DayWindow;
}

/** Minimum paired days before any coefficient is displayed. */
export const MIN_PAIRED_OBSERVATIONS = 10;

/** Daily values are already per-day for every metric, so daily means are used. */
const PAIR_STRATEGY: AggregationStrategy = 'avg';

export function computeRelationship(
  xMetricId: string,
  yMetricId: string,
  window: DayWindow,
  alignment: Alignment,
  lagDays = 1
): RelationshipResult {
  const lag = alignment === 'lagged' ? Math.max(1, Math.round(lagDays)) : 0;

  const xAll = inWindow(seriesFor(xMetricId), window);
  // When X leads Y, Y is read `lag` days after X, so Y's window shifts forward.
  const yWindow: DayWindow = lag
    ? { startKey: addDays(window.startKey, lag), endKey: addDays(window.endKey, lag), label: window.label }
    : window;
  const yAll = inWindow(seriesFor(yMetricId), yWindow);

  const yByKey = new Map<string, number>();
  for (const p of yAll) yByKey.set(p.key, p.value);

  const points: PairPoint[] = [];
  for (const p of xAll) {
    const yKey = addDays(p.key, lag);
    const yValue = yByKey.get(yKey);
    if (yValue === undefined) continue;
    points.push({ key: p.key, x: p.value, y: yValue });
  }

  const corr = pearsonCorrelation(
    points.map(p => p.x),
    points.map(p => p.y)
  );

  let insufficientReason: string | null = null;
  if (points.length < MIN_PAIRED_OBSERVATIONS) {
    insufficientReason = `Only ${points.length} days have a reading for both metrics in this window. At least ${MIN_PAIRED_OBSERVATIONS} paired days are needed to show an association.`;
  } else if (!corr.valid) {
    insufficientReason =
      'One of the selected metrics has the same value on every paired day, so no association can be expressed.';
  }

  return {
    xMetricId,
    yMetricId,
    alignment,
    lagDays: lag,
    coefficient: corr.valid ? corr.coefficient : null,
    pairedCount: points.length,
    xCount: xAll.length,
    yCount: yAll.length,
    valid: corr.valid && points.length >= MIN_PAIRED_OBSERVATIONS,
    insufficientReason,
    points,
    window,
  };
}

function inWindow(points: DayPoint[], win: DayWindow): DayPoint[] {
  return points.filter(p => p.key >= win.startKey && p.key <= win.endKey);
}

export { PAIR_STRATEGY };

/** Plain-language strength word. Deliberately about strength, not quality. */
export function describeCoefficient(r: number | null): string {
  if (r == null || !isFinite(r)) return 'Not calculable';
  const a = Math.abs(r);
  if (a < 0.2) return 'Very weak linear association';
  if (a < 0.4) return 'Weak linear association';
  if (a < 0.6) return 'Moderate linear association';
  if (a < 0.8) return 'Strong linear association';
  return 'Very strong linear association';
}

export const ASSOCIATION_NOTE =
  'Association does not establish causation. Missing days, repeated measurements, shared seasonal effects, and the number of relationships examined can all make an apparent association misleading.';
// ── Aggregation primitives ──────────────────────────────
//
// Metric-specific aggregation lives here so that every page aggregates the same
// way. Missing values are excluded — never replaced with zero.

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function stddev(values: number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  const sqDiffs = values.map(v => (v - m) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

export function min(values: number[]): number {
  return values.length === 0 ? NaN : Math.min(...values);
}

export function max(values: number[]): number {
  return values.length === 0 ? NaN : Math.max(...values);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Aggregate using the metric's declared strategy. Returns NaN for no data. */
export function aggregate(values: number[], strategy: string): number {
  if (values.length === 0) return NaN;
  switch (strategy) {
    case 'sum': return sum(values);
    case 'min': return min(values);
    case 'max': return max(values);
    case 'latest': return values[values.length - 1];
    case 'count': return values.length;
    case 'avg':
    default: return mean(values);
  }
}

/**
 * Percentage change. Returns null when the denominator is zero (or not finite)
 * rather than an infinity, per SPEC §9.
 */
export function percentChange(value: number, baseline: number): number | null {
  if (!isFinite(value) || !isFinite(baseline) || baseline === 0) return null;
  return ((value - baseline) / Math.abs(baseline)) * 100;
}

export interface ComparisonResult {
  current: number;
  baseline: number;
  delta: number;
  deltaPercent: number | null;
  currentCount: number;
  baselineCount: number;
  valid: boolean;
}
export function compareValues(
  currentValues: number[],
  baselineValues: number[],
  strategy: string,
  minCount = 1
): ComparisonResult {
  if (currentValues.length < minCount || baselineValues.length < minCount) {
    return {
      current: NaN, baseline: NaN, delta: NaN, deltaPercent: null,
      currentCount: currentValues.length, baselineCount: baselineValues.length,
      valid: false,
    };
  }
  const current = aggregate(currentValues, strategy);
  const baseline = aggregate(baselineValues, strategy);
  return {
    current,
    baseline,
    delta: current - baseline,
    deltaPercent: percentChange(current, baseline),
    currentCount: currentValues.length,
    baselineCount: baselineValues.length,
    valid: true,
  };
}
// ── Correlation ─────────────────────────────────────────

export interface CorrelationResult {
  /** Pearson r, or NaN when there is not enough paired data. */
  coefficient: number;
  pairedCount: number;
  valid: boolean;
}

/**
 * Pearson correlation between two equal-length, paired value arrays.
 * No confidence intervals or significance tests are computed — SPEC §9 is
 * explicit that exploratory association is all this can claim.
 */
export function pearsonCorrelation(x: number[], y: number[]): CorrelationResult {
  if (x.length < 3 || y.length < 3 || x.length !== y.length) {
    return { coefficient: NaN, pairedCount: Math.min(x.length, y.length), valid: false };
  }
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (!(denom > 0)) {
    // One of the series is constant: no linear association can be expressed.
    return { coefficient: 0, pairedCount: n, valid: false };
  }
  return { coefficient: num / denom, pairedCount: n, valid: true };
}

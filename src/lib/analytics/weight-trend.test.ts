import { describe, expect, it } from 'vitest';
import { linearSlope, weightedMean, weightedSlope } from './stats';
import { addDays } from './windows';
import { trendWeights, WEIGHT_TREND_DAYS, weightTrendSlope } from './weight-trend';

const TODAY = '2026-10-08';

/** One weigh-in a day for the trend window, ending today. */
function window(value: (daysAgo: number) => number) {
  return Array.from({ length: WEIGHT_TREND_DAYS }, (_, i) => WEIGHT_TREND_DAYS - 1 - i).map(ago => ({ key: addDays(TODAY, -ago), value: value(ago) }));
}

describe('weighted statistics', () => {
  it('weight the mean by each value’s weight', () => {
    expect(weightedMean([1, 3], [1, 1])).toBe(2);
    expect(weightedMean([1, 3], [3, 1])).toBe(1.5);
    expect(weightedMean([], [])).toBeNaN();
  });

  it('match the plain slope with equal weights, and fit a straight line exactly whatever the weights', () => {
    const noisy = window(ago => 80 - ago * 0.05 + (ago % 3 === 0 ? 0.4 : -0.2));
    expect(weightedSlope(noisy, noisy.map(() => 1))).toBeCloseTo(linearSlope(noisy)!, 12);
    const line = window(ago => 80 + ago * 0.07);
    expect(weightedSlope(line, line.map((_, i) => i + 1))).toBeCloseTo(-0.07, 12);
  });
});

describe('weight trend', () => {
  it('halves a weigh-in’s weight every two weeks', () => {
    const [w0, w14, w28] = trendWeights([{ key: TODAY }, { key: addDays(TODAY, -14) }, { key: addDays(TODAY, -28) }], TODAY);
    expect(w0).toBe(1);
    expect(w14).toBeCloseTo(0.5, 12);
    expect(w28).toBeCloseTo(0.25, 12);
  });

  it('reads a steady rate as it is', () => {
    expect(weightTrendSlope(window(ago => 80 + ago * 0.07), TODAY)! * 7).toBeCloseTo(-0.49, 10);
  });

  it('shows a stall sooner than an equal-weight slope', () => {
    // Losing 0.5 kg a week, then flat for the last 14 days.
    const stalled = window(ago => (ago < 14 ? 0 : (0.5 / 7) * (ago - 14)));
    const weighted = weightTrendSlope(stalled, TODAY)! * 7;
    const plain = linearSlope(stalled)! * 7;
    expect(weighted).toBeLessThan(0);
    expect(Math.abs(weighted)).toBeLessThan(Math.abs(plain) - 0.03);
  });

  it('is moved little by one high weigh-in today', () => {
    const spike = window(ago => (ago === 0 ? 1.5 : 0));
    expect(weightTrendSlope(spike, TODAY)! * 7).toBeLessThan(0.15);
  });

  it('needs four weigh-ins', () => {
    expect(weightTrendSlope(window(() => 80).slice(-3), TODAY)).toBeNull();
  });
});

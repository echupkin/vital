import { describe, expect, it } from 'vitest';
import {
  REFERENCE_KEY,
  excludePartialForSum,
  isAccumulating,
  seriesFor,
  seriesInWindow,
} from '@/lib/adapters/dataset';
import { getMetric } from '@/lib/metrics';
import {
  addDays,
  compareValues,
  compareWindows,
  dayKey,
  diffDays,
  previousWindow,
  trailingWindow,
  windowDays,
  windowRangeLabel,
} from '@/lib/analytics';

describe('comparison windows exclude the in-progress day (SPEC §9)', () => {
  it('drops the current day from both sides of an accumulating comparison', () => {
    const cmp = compareWindows('step_count', REFERENCE_KEY, 7);
    expect(cmp.accumulating).toBe(true);
    // The in-progress day is named, not silently included.
    expect(cmp.excludedDays).toContain(REFERENCE_KEY);
    expect(cmp.evaluatedWindow.endKey).toBe(addDays(REFERENCE_KEY, -1));
    expect(cmp.evaluatedWindow.startKey).toBe('2026-09-11');
    expect(cmp.baselineWindow.endKey).toBe('2026-09-10');
    expect(cmp.baselineWindow.startKey).toBe('2026-09-05');
    // Like for like: 6 complete days against 6 complete days.
    expect(cmp.evaluatedDays).toBe(6);
    expect(cmp.baselineDays).toBe(6);
    expect(cmp.evaluatedDays).toBe(cmp.baselineDays);
    expect(cmp.lengthLabel).toBe('6 complete days vs 6 complete days');
    expect(cmp.exclusionNote).toContain('still in progress');
  });

  it('drops the in-progress day even when a sum metric has no reading for it yet', () => {
    // Exercise minutes are recorded per session, so the fixture has no entry for
    // the in-progress reference day — but the day is still incomplete and must
    // not be compared with a complete baseline day.
    const cmp = compareWindows('apple_exercise_time', REFERENCE_KEY, 7);
    expect(cmp.accumulating).toBe(true);
    expect(cmp.excludedDays).toEqual([REFERENCE_KEY]);
    expect(cmp.evaluatedWindow.endKey).toBe(addDays(REFERENCE_KEY, -1));
    expect(cmp.evaluatedDays).toBe(6);
    expect(cmp.baselineDays).toBe(6);
    expect(cmp.lengthLabel).toBe('6 complete days vs 6 complete days');
    expect(cmp.exclusionNote).toContain('still in progress');
  });

  it('never compares a 6-day total with a 7-day total', () => {
    const cmp = compareWindows('step_count', REFERENCE_KEY, 7);
    const evaluatedSum = seriesInWindow('step_count', cmp.evaluatedWindow).map(p => p.value);
    const baselineSum = seriesInWindow('step_count', cmp.baselineWindow).map(p => p.value);
    expect(evaluatedSum.length).toBe(baselineSum.length);
    expect(cmp.comparison.current).toBeCloseTo(evaluatedSum.reduce((a, b) => a + b, 0), 5);
    expect(cmp.comparison.baseline).toBeCloseTo(baselineSum.reduce((a, b) => a + b, 0), 5);
  });

  it('leaves a metric that is complete for the final day on the full window', () => {
    const cmp = compareWindows('resting_heart_rate', REFERENCE_KEY, 7);
    expect(cmp.accumulating).toBe(false);
    expect(cmp.excludedDays).toEqual([]);
    expect(cmp.evaluatedDays).toBe(7);
    expect(cmp.baselineDays).toBe(7);
    expect(cmp.lengthLabel).toBe('7 days vs 7 days');
    expect(cmp.exclusionNote).toBeNull();
    expect(cmp.evaluatedWindow.endKey).toBe(REFERENCE_KEY);
  });

  it('equalises the window length for every accumulating metric', () => {
    for (const id of ['step_count', 'apple_exercise_time', 'active_energy', 'distance_walking_running', 'apple_stand_hours']) {
      const meta = getMetric(id);
      const cmp = compareWindows(id, REFERENCE_KEY, 30);
      expect(cmp.accumulating).toBe(isAccumulating(meta));
      expect(cmp.baselineDays).toBe(cmp.evaluatedDays);
      expect(cmp.baselineWindow.endKey).toBe(addDays(cmp.evaluatedWindow.startKey, -1));
    }
  });
});

describe('baseline windows exclude the evaluated period (SPEC §9)', () => {
  it('never overlaps the evaluated window', () => {
    for (const id of ['step_count', 'resting_heart_rate', 'sleep_analysis']) {
      const cmp = compareWindows(id, REFERENCE_KEY, 14);
      expect(cmp.baselineWindow.endKey < cmp.evaluatedWindow.startKey).toBe(true);
    }
  });

  it('anchors on an explicit end day without treating it as in progress', () => {
    // A finished week evaluated by the report archive excludes nothing.
    const cmp = compareWindows('step_count', REFERENCE_KEY, 7, { endKey: '2026-09-10' });
    expect(cmp.excludedDays).toEqual([]);
    expect(cmp.evaluatedWindow).toEqual({
      startKey: '2026-09-04',
      endKey: '2026-09-10',
      label: 'Last 7 days',
    });
    expect(cmp.baselineWindow.startKey).toBe('2026-08-28');
    expect(cmp.baselineWindow.endKey).toBe('2026-09-03');
  });

  it('builds a same-length baseline for a non-week window', () => {
    const win = trailingWindow(REFERENCE_KEY, 9);
    const base = previousWindow(win, windowDays(win));
    expect(windowDays(base)).toBe(9);
    expect(base.endKey).toBe(addDays(win.startKey, -1));
  });
});

describe('missing data is preserved, never zero-filled (SPEC §9)', () => {
  it('reports no data rather than a zero value', () => {
    // apple_stand_hours is registered but absent from the dataset.
    const cmp = compareWindows('apple_stand_hours', REFERENCE_KEY, 30);
    expect(cmp.comparison.valid).toBe(false);
    expect(Number.isNaN(cmp.comparison.current)).toBe(true);
    expect(Number.isNaN(cmp.comparison.delta)).toBe(true);
    expect(cmp.comparison.currentCount).toBe(0);
    expect(cmp.comparison.deltaPercent).toBeNull();
  });

  it('excludes incomplete days without substituting for them', () => {
    const points = seriesInWindow('step_count', trailingWindow(REFERENCE_KEY, 7));
    const { values, excludedDays } = excludePartialForSum(points, getMetric('step_count'));
    expect(excludedDays).toContain(REFERENCE_KEY);
    expect(values.length).toBe(points.length - excludedDays.length);
    expect(values.every(v => v > 0)).toBe(true);
  });

  it('never divides a total by the calendar length of the window', () => {
    const cmp = compareWindows('apple_exercise_time', REFERENCE_KEY, 7);
    // 4 of the 7 days carry a value; the total is the sum of those 4 days.
    expect(cmp.counts.evaluated).toBe(4);
    expect(cmp.comparison.current).toBeLessThan(cmp.comparison.current * 2);
    expect(cmp.comparison.current).toBe(
      seriesInWindow('apple_exercise_time', cmp.evaluatedWindow).reduce((a, p) => a + p.value, 0)
    );
  });
});

describe('zero denominators (SPEC §9)', () => {
  it('withholds a percentage when the baseline is zero but keeps the difference', () => {
    const cmp = compareValues([5, 6, 7], [0, 0, 0], 'sum');
    expect(cmp.valid).toBe(true);
    expect(cmp.delta).toBe(18);
    expect(cmp.deltaPercent).toBeNull();
  });

  it('is invalid, not zero, when either side has nothing', () => {
    expect(compareValues([], [1, 2, 3], 'avg').valid).toBe(false);
    expect(compareValues([1, 2, 3], [], 'avg').valid).toBe(false);
  });
});

describe('timezone and day boundaries (SPEC §9)', () => {
  it('resolves day keys in the dataset timezone across a DST transition', () => {
    // DST ends 2026-11-01 in America/Chicago: the day is 25 hours long.
    expect(dayKey('2026-11-01T05:30:00.000Z', 'America/Chicago')).toBe('2026-11-01'); // 00:30 CDT
    expect(dayKey('2026-11-02T05:30:00.000Z', 'America/Chicago')).toBe('2026-11-01'); // 23:30 CST
    expect(dayKey('2026-11-02T06:30:00.000Z', 'America/Chicago')).toBe('2026-11-02'); // 00:30 CST
  });

  it('does not lose or repeat a day across the transition', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    const win = trailingWindow('2026-11-02', 3);
    expect(windowRangeLabel(win)).toBe('Oct 31 – Nov 2');
    expect(windowDays(win)).toBe(3);
  });
});

describe('staleness is measured in whole calendar days', () => {
  it('counts from the last reading to the reference day', () => {
    const rhr = seriesFor('resting_heart_rate');
    const last = rhr[rhr.length - 1].key;
    expect(diffDays(last, REFERENCE_KEY)).toBe(1);
    const weight = seriesFor('weight_body_mass');
    expect(diffDays(weight[weight.length - 1].key, REFERENCE_KEY)).toBeGreaterThan(1);
    expect(diffDays('2026-06-19', REFERENCE_KEY)).toBe(90);
  });
});

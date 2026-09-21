import { describe, expect, it } from 'vitest';
import {
  addDays,
  aggregate,
  compareValues,
  computeStatus,
  dayKey,
  diffDays,
  pearsonCorrelation,
  percentChange,
  previousWindow,
  trailingWindow,
  windowRangeLabel,
} from '@/lib/analytics';
import { computeRelationship, MIN_PAIRED_OBSERVATIONS, ASSOCIATION_NOTE } from '@/lib/analytics/relationships';
import {
  describeChange,
  formatMetricTick,
  formatMetricValue,
  formatMetricWithUnit,
  formatPercent,
  convertValue,
  displayUnit,
  metricUnit,
} from '@/lib/metrics/format';
import { getMetric } from '@/lib/metrics';
import { REFERENCE_KEY, seriesFor, sleepSeries } from '@/lib/adapters/dataset';

describe('window maths (SPEC §6, §9)', () => {
  it('builds an inclusive trailing window of the requested length', () => {
    const win = trailingWindow('2026-09-17', 7);
    expect(win.startKey).toBe('2026-09-11');
    expect(win.endKey).toBe('2026-09-17');
    expect(diffDays(win.startKey, win.endKey)).toBe(6);
  });

  it('excludes the evaluated period from the baseline window', () => {
    const win = trailingWindow('2026-09-17', 7);
    const base = previousWindow(win, 30);
    expect(base.endKey).toBe('2026-09-10');
    expect(base.startKey).toBe('2026-08-12');
    // No overlap at all between evaluated and baseline.
    expect(base.endKey < win.startKey).toBe(true);
    expect(base.endKey).not.toBe(win.startKey);
  });

  it('labels every window with its own dates', () => {
    const win = trailingWindow('2026-09-17', 7);
    expect(windowRangeLabel(win)).toBe('Sep 11 – Sep 17');
    expect(windowRangeLabel(previousWindow(win, 7))).toBe('Sep 4 – Sep 10');
  });

  it('crosses a US daylight-saving boundary without losing or repeating a day', () => {
    // DST ends on 2026-11-01 in America/Chicago.
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('resolves day keys in the dataset timezone, not UTC', () => {
    // 04:59:59Z on the 18th is still the 17th in Chicago.
    expect(dayKey('2026-09-18T04:59:59.999Z', 'America/Chicago')).toBe('2026-09-17');
    expect(dayKey('2026-09-17T05:00:00.000Z', 'America/Chicago')).toBe('2026-09-17');
  });

  it('computes staleness in whole calendar days', () => {
    // Last reading 2026-09-16 against reference date 2026-09-17 => 1 day.
    expect(diffDays('2026-09-16', REFERENCE_KEY)).toBe(1);
  });
});

describe('aggregation and missing data (SPEC §9)', () => {
  it('returns NaN rather than zero when there is nothing to aggregate', () => {
    expect(Number.isNaN(aggregate([], 'sum'))).toBe(true);
    expect(Number.isNaN(aggregate([], 'avg'))).toBe(true);
  });

  it('avoids percentage change when the denominator is zero', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
  });

  it('marks a comparison invalid when either side is missing', () => {
    expect(compareValues([], [1, 2, 3], 'avg').valid).toBe(false);
    expect(compareValues([1, 2, 3], [], 'avg').valid).toBe(false);
    expect(compareValues([1, 2, 3], [1, 2], 'avg', 3).valid).toBe(false);
  });

  it('applies the metric-specific strategy (sum is not an average)', () => {
    expect(aggregate([10, 20, 30], 'sum')).toBe(60);
    expect(aggregate([10, 20, 30], 'avg')).toBe(20);
    expect(aggregate([10, 20, 30], 'latest')).toBe(30);
    expect(aggregate([10, 20, 30], 'count')).toBe(3);
  });
});

describe('status vocabulary (SPEC §5)', () => {
  const meta = getMetric('resting_heart_rate');
  const points = (start: number, values: number[]) =>
    values.map((value, i) => ({ key: addDays('2026-09-17', -(start - i)), value, source: 'test' }));

  it('reports "Not enough data" instead of guessing', () => {
    const result = computeStatus({
      metricId: 'resting_heart_rate',
      meta,
      evaluated: points(1, [58]),
      baseline: [],
      withinWord: 'Within baseline',
    });
    expect(result.status).toBe('Not enough data');
    expect(result.sufficient).toBe(false);
  });

  it('keeps a small move inside the baseline band', () => {
    const evaluated = points(0, [58.5, 58.4, 58.6, 58.5]);
    const baseline = points(10, [58.6, 58.5, 58.5, 58.6]);
    const result = computeStatus({
      metricId: 'resting_heart_rate',
      meta,
      evaluated,
      baseline,
      withinWord: 'Within baseline',
    });
    expect(result.status).toBe('Within baseline');
  });

  it('names the direction when a move exceeds the band', () => {
    const evaluated = points(0, [64, 65, 64.5, 65]);
    const baseline = points(10, [58, 58.5, 58, 58.5]);
    const result = computeStatus({
      metricId: 'resting_heart_rate',
      meta,
      evaluated,
      baseline,
      withinWord: 'Within baseline',
    });
    expect(result.status).toBe('Above recent average');
  });

  it('reports no change for an exact match rather than a numeric zero', () => {
    const values = [60, 61, 60, 61];
    const evaluated = points(0, values);
    const baseline = points(10, values);
    const result = computeStatus({
      metricId: 'resting_heart_rate',
      meta,
      evaluated,
      baseline,
      withinWord: 'Within baseline',
    });
    expect(result.comparison.delta).toBe(0);
    expect(result.status).toBe('Within baseline');
    expect(describeChange('resting_heart_rate', 0, 0).value).toBe('no change');
  });
});

describe('formatting (SPEC §3, defect 2/3/5)', () => {
  it('never appends a unit the layout already renders', () => {
    // 353 minutes formats as '5h 53m'; the 'h' unit must not be appended again.
    expect(formatMetricWithUnit('sleep_analysis', 353, 'metric')).toBe('5h 53m');
    expect(formatMetricWithUnit('sleep_analysis', 353, 'metric')).not.toContain('h h');
    expect(formatMetricWithUnit('blood_oxygen_saturation', 97.4, 'metric')).toBe('97.4%');
    expect(formatMetricWithUnit('dietary_water', 2205, 'metric')).toBe('2.2L');
  });

  it('renders a zero delta as an explicit no-change state', () => {
    expect(describeChange('resting_heart_rate', 0, 0).value).toBe('no change');
    expect(formatMetricValue('resting_heart_rate', 56.01935483870969, 'metric')).toBe('56.0');
    expect(formatMetricValue('heart_rate_variability', 54.53333333333333, 'metric')).toBe('55');
  });

  it('keeps counts whole on the axis and never shows three decimals', () => {
    expect(formatMetricTick('step_count', 4231, 'metric')).toBe('4.2K');
    expect(formatMetricTick('resting_heart_rate', 56.3, 'metric')).toBe('56');
    expect(formatMetricTick('apple_exercise_time', 62.4, 'metric')).toBe('62');
    const formatted = formatMetricWithUnit('resting_heart_rate', 56.01935483870969, 'metric');
    expect(formatted).toBe('56.0 bpm');
    expect((formatted.match(/\./g) || []).length).toBe(1);
  });

  it('converts units consistently and describes the conversion', () => {
    expect(convertValue(76.8, 'kg', 'metric')).toBe(76.8);
    expect(convertValue(76.8, 'kg', 'imperial')).toBeCloseTo(169.31, 1);
    expect(displayUnit('kg', 'imperial')).toBe('lb');
    expect(displayUnit('bpm', 'imperial')).toBe('bpm');
    expect(formatMetricWithUnit('weight_body_mass', 76.8, 'imperial')).toContain('lb');
  });

  it('handles a null percentage without printing NaN', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('formats a large negative delta with the same scale as the positive value', () => {
    // -2017 steps must read '-2.0K', never the raw '-2017'.
    expect(formatMetricValue('step_count', -2017, 'metric')).toBe('-2.0K');
    expect(formatMetricValue('step_count', -2560, 'metric')).toBe('-2.6K');
    expect(formatMetricValue('step_count', 2560, 'metric')).toBe('2.6K');
    expect(formatMetricValue('step_count', -999, 'metric')).toBe('-999');
  });

  it('never appends a placeholder unit to a bare count', () => {
    expect(metricUnit('step_count', 'metric')).toBe('');
    expect(formatMetricWithUnit('step_count', 4200, 'metric')).toBe('4.2K');
    expect(metricUnit('resting_heart_rate', 'metric')).toBe('bpm');
    expect(metricUnit('weight_body_mass', 'imperial')).toBe('lb');
  });
});

describe('correlation pairing (SPEC §9 relationship explorer)', () => {
  it('pairs only days present in both series', () => {
    const window = trailingWindow(REFERENCE_KEY, 90);
    const result = computeRelationship('sleep_analysis', 'heart_rate_variability', window, 'same-day');
    expect(result.pairedCount).toBe(result.points.length);
    expect(result.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(result.coefficient).not.toBeNull();
    expect(ASSOCIATION_NOTE).toContain('does not establish causation');
  });

  it('shifts Y forward by the lag when lagged alignment is chosen', () => {
    const window = trailingWindow(REFERENCE_KEY, 60);
    const sameDay = computeRelationship('sleep_analysis', 'heart_rate_variability', window, 'same-day');
    const lagged = computeRelationship('sleep_analysis', 'heart_rate_variability', window, 'lagged', 1);
    expect(lagged.lagDays).toBe(1);
    expect(lagged.pairedCount).toBeGreaterThan(0);
    // A one-day shift changes which days pair up.
    expect(lagged.points.map(p => p.key)).not.toEqual(sameDay.points.map(p => p.key));
  });

  it('refuses to show a coefficient from too few paired days', () => {
    const tiny = { startKey: REFERENCE_KEY, endKey: REFERENCE_KEY, label: 'One day' };
    const result = computeRelationship('sleep_analysis', 'heart_rate_variability', tiny, 'same-day');
    expect(result.valid).toBe(false);
    expect(result.pairedCount).toBeLessThan(MIN_PAIRED_OBSERVATIONS);
    expect(result.insufficientReason).toBeTruthy();
  });

  it('reports invalid rather than a fabricated coefficient for a constant series', () => {
    const flat = pearsonCorrelation([1, 1, 1, 1], [1, 2, 3, 4]);
    expect(flat.valid).toBe(false);
  });
});

describe('dataset integrity', () => {
  it('keys every series by calendar day and sorts it', () => {
    const series = seriesFor('resting_heart_rate');
    const keys = series.map(p => p.key);
    expect([...keys].sort()).toEqual(keys);
    expect(series.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.key))).toBe(true);
  });

  it('assigns sleep to its waking date and keeps in-bed longer than asleep', () => {
    const nights = sleepSeries();
    expect(nights.length).toBeGreaterThan(0);
    expect(nights.every(n => n.inBedMinutes >= n.asleepMinutes)).toBe(true);
    expect(nights[nights.length - 1].key).toBe(REFERENCE_KEY);
  });

  it('detects the in-progress day from hourly coverage', () => {
    const today = seriesFor('step_count').find(p => p.key === REFERENCE_KEY);
    expect(today?.partial).toBe(true);
  });
});
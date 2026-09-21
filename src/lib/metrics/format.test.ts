import { describe, expect, it } from 'vitest';
import { getAllMetrics, getMetric } from '@/lib/metrics';
import {
  convertValue,
  displayUnit,
  durationAggregateExact,
  DURATION_AGGREGATE_METRIC_IDS,
  formatDeltaWithUnit,
  formatDurationAggregate,
  formatDurationHm,
  formatDurationHmWithExact,
  formatMetricTick,
  formatMetricValue,
  formatMetricWithUnit,
  formatPercent,
  hasConversion,
  metricUnit,
  toCanonicalValue,
} from '@/lib/metrics/format';
import { countNoun, proseName } from '@/lib/metrics/prose';
import { REFERENCE_KEY, seriesFor } from '@/lib/adapters/dataset';
import { buildSeriesSummary } from '@/lib/analytics';
import { describeStoredPreferences, DEFAULT_NOTIFICATIONS, loadPreferences, STORAGE_KEY_NAME } from '@/lib/prefs';

describe('unit conversion round-trips (SPEC §9)', () => {
  it('returns to the canonical value after a round trip', () => {
    for (const [unit, value] of [
      ['kg', 76.8],
      ['km', 5.4],
      ['cm', 84],
    ] as const) {
      const imperial = convertValue(value, unit, 'imperial');
      const back = toCanonicalValue(imperial, unit, 'imperial');
      expect(back).toBeCloseTo(value, 10);
      // And metric is the identity.
      expect(convertValue(value, unit, 'metric')).toBe(value);
      expect(toCanonicalValue(value, unit, 'metric')).toBe(value);
    }
  });

  it('is reversible through several round trips', () => {
    let value = 76.8;
    for (let i = 0; i < 5; i++) {
      value = toCanonicalValue(convertValue(value, 'kg', 'imperial'), 'kg', 'imperial');
    }
    expect(value).toBeCloseTo(76.8, 8);
  });

  it('leaves units without a defined conversion untouched', () => {
    for (const unit of ['bpm', 'ms', 'kcal', 'min', 'count', 'mg', 'mL', '%', 'mmHg']) {
      expect(hasConversion(unit)).toBe(false);
      expect(convertValue(42, unit, 'imperial')).toBe(42);
      expect(displayUnit(unit, 'imperial')).toBe(unit);
    }
  });

  it('formats the converted value with the metric formatter and the right unit', () => {
    expect(formatMetricWithUnit('weight_body_mass', 76.8, 'metric')).toBe('76.8 kg');
    expect(formatMetricWithUnit('weight_body_mass', 76.8, 'imperial')).toBe('169.3 lb');
    expect(formatMetricWithUnit('distance_walking_running', 5, 'imperial')).toBe('3.1 mi');
    expect(metricUnit('step_count', 'imperial')).toBe('');
  });
});

describe('formatting discipline (SPEC §3, §9)', () => {
  it('never emits a raw float in a rendered value or delta', () => {
    for (const metric of getAllMetrics()) {
      if (seriesFor(metric.id).length === 0) continue;
      const summary = buildSeriesSummary(metric.id, REFERENCE_KEY, 30);
      expect(summary.latestValue).not.toMatch(/\d\.\d{3}/);
      const delta = formatDeltaWithUnit(metric.id, 3.14159, 'metric');
      expect(delta).not.toMatch(/\d\.\d{3}/);
      const value = formatMetricValue(metric.id, 3.14159, 'metric');
      expect(value).not.toMatch(/\d\.\d{3}/);
      const tick = formatMetricTick(metric.id, 3.14159, 'metric');
      expect(tick).not.toMatch(/\d\.\d{3}/);
    }
  });

  it('renders an em dash for anything that is not finite', () => {
    expect(formatMetricValue('resting_heart_rate', NaN)).toBe('—');
    expect(formatMetricWithUnit('resting_heart_rate', Infinity)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatDeltaWithUnit('resting_heart_rate', NaN)).toBe('—');
  });

  it('never adds a unit the formatter already shows', () => {
    expect(formatMetricWithUnit('sleep_analysis', 353)).toBe('5h 53m');
    expect(formatMetricWithUnit('dietary_water', 2205)).toBe('2.2L');
    expect(formatMetricWithUnit('blood_oxygen_saturation', 97.4)).toBe('97.4%');
    expect(formatMetricWithUnit('step_count', 4200)).toBe('4.2K');
  });
});

describe('duration aggregates in h:mm (owner requests 4 and 5)', () => {
  it('formats minutes as hours:minutes', () => {
    expect(formatDurationHm(85)).toBe('1:25');
    expect(formatDurationHm(45)).toBe('0:45');
    expect(formatDurationHm(723)).toBe('12:03');
    expect(formatDurationHm(60)).toBe('1:00');
    expect(formatDurationHm(0)).toBe('0:00');
    // Rounds to the nearest minute rather than printing a float.
    expect(formatDurationHm(84.6)).toBe('1:25');
    expect(formatDurationHm(59.4)).toBe('0:59');
    expect(formatDurationHm(NaN)).toBe('—');
  });

  it('keeps the exact minute value available alongside the h:mm figure', () => {
    expect(formatDurationHmWithExact(85)).toBe('1:25 (85 min)');
    expect(durationAggregateExact(85)).toBe('85 min');
  });

  it('routes duration aggregates through h:mm and every other metric through its own formatter', () => {
    expect(DURATION_AGGREGATE_METRIC_IDS.has('apple_exercise_time')).toBe(true);
    expect(formatDurationAggregate('apple_exercise_time', 85)).toBe('1:25');
    // A non-duration metric is untouched by the h:mm path.
    expect(formatDurationAggregate('resting_heart_rate', 58)).toBe('58.0 bpm');
    expect(formatDurationAggregate('sleep_analysis', 353)).toBe('5h 53m');
  });
});

describe('generated prose names (SPEC §7 reports and §8 answers)', () => {
  it('names each metric as a phrase and counts its observations correctly', () => {
    expect(proseName('sleep_analysis')).toBe('time asleep');
    expect(proseName('heart_rate_variability')).toBe('HRV');
    expect(proseName('resting_heart_rate')).toBe('resting heart rate');
    expect(proseName('step_count')).toBe('steps');
    expect(proseName('dietary_energy')).toBe('logged calories');

    expect(countNoun('sleep_analysis', 7)).toBe('nights');
    expect(countNoun('sleep_analysis', 1)).toBe('night');
    expect(countNoun('resting_heart_rate', 7)).toBe('readings');
    expect(countNoun('step_count', 6)).toBe('recorded days');
  });

  it('falls back to a sensible phrase for an unlisted metric', () => {
    expect(proseName('walking_heart_rate')).toBe('walking heart rate');
    expect(getMetric('walking_heart_rate')).toBeDefined();
  });
});

describe('stored preferences (SPEC §7, §11)', () => {
  it('keeps one namespaced cache entry and never holds a health value', () => {
    const prefs = loadPreferences();
    const rows = describeStoredPreferences(prefs);
    // One entry now: the server owns the settings, and this browser keeps only a
    // first-paint cache of the values it last read.
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(STORAGE_KEY_NAME);
    expect(rows[0].key).toMatch(/^vital-prefs/);
    const flat = JSON.stringify(prefs);
    expect(flat).not.toMatch(/\d+\.\d/); // no measurement values
    expect(flat).not.toMatch(/key|token|secret|password/i);
    expect(DEFAULT_NOTIFICATIONS.dailyBriefing).toBe(true);
  });
});

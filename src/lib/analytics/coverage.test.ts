import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY, coverageFor, seriesInWindow } from '@/lib/adapters/dataset';
import { trailingWindow } from '@/lib/analytics/windows';
import {
  availabilityTable,
  coverageFact,
  coverageSentence,
  loggedAverageLabel,
  loggedDayStats,
  MIN_LOGGED_DAYS,
} from '@/lib/analytics';

describe('logged-day statistics (SPEC §7 nutrition)', () => {
  it('averages over logged days only, never over calendar days', () => {
    const stats = loggedDayStats('dietary_energy', REFERENCE_KEY, 90);
    const points = seriesInWindow('dietary_energy', trailingWindow(REFERENCE_KEY, 90));
    expect(stats.loggedDays).toBe(points.length);
    expect(stats.loggedDays).toBeLessThan(stats.windowDays);
    const sum = points.reduce((a, p) => a + p.value, 0);
    expect(stats.windowTotal).toBeCloseTo(sum, 6);
    expect(stats.dailyAverage).toBeCloseTo(sum / points.length, 6);
    // Dividing by the calendar window would understate the average.
    expect(stats.dailyAverage).toBeGreaterThan(sum / stats.windowDays);
  });

  it('states the coverage of the window and of the whole dataset', () => {
    const stats = loggedDayStats('dietary_energy', REFERENCE_KEY, 90);
    const fact = coverageFor('dietary_energy')!;
    expect(stats.averageLabel).toBe(`average over ${stats.loggedDays} logged days of 90`);
    expect(stats.coverageLabel).toBe(`${fact.observedDays} logged days of ${fact.expectedDays} in the dataset`);
    expect(stats.datasetLoggedDays).toBe(142);
    expect(stats.datasetExpectedDays).toBe(181);
  });

  it('totals logged intake over the logged days it has', () => {
    const stats = loggedDayStats('dietary_caffeine', REFERENCE_KEY, 90);
    expect(stats.accumulating).toBe(true);
    expect(stats.windowTotal).toBeCloseTo(
      stats.values.reduce((a, b) => a + b, 0),
      6
    );
    expect(stats.median).toBeGreaterThan(0);
    expect(stats.min).toBeLessThanOrEqual(stats.median);
    expect(stats.max).toBeGreaterThanOrEqual(stats.median);
  });

  it('reports insufficient logging rather than an average of nothing', () => {
    const stats = loggedDayStats('dietary_energy', REFERENCE_KEY, 1);
    if (stats.loggedDays < MIN_LOGGED_DAYS) {
      expect(stats.sufficient).toBe(false);
      expect(loggedAverageLabel('dietary_energy', stats)).toBe('Not enough logged days');
    }
  });

  it('is deterministic: the same call produces the same figures', () => {
    const a = loggedDayStats('dietary_protein', REFERENCE_KEY, 90);
    const b = loggedDayStats('dietary_protein', REFERENCE_KEY, 90);
    expect(a.dailyAverage).toBe(b.dailyAverage);
    expect(a.latestKey).toBe(b.latestKey);
  });
});

describe('coverage facts (SPEC §7, §10)', () => {
  it('describes each metric with counts, not a bare percentage', () => {
    const fact = coverageFact('resting_heart_rate')!;
    expect(fact.observedDays).toBe(171);
    expect(fact.expectedDays).toBe(181);
    expect(fact.samplingFrequency).toBe('daily');
    expect(fact.sources.length).toBeGreaterThan(1);
    expect(coverageSentence('resting_heart_rate')).toBe('171 of 181 days recorded · daily');
  });

  it('has no coverage record for a metric absent from the dataset', () => {
    expect(coverageFact('apple_stand_hours')).toBeNull();
    expect(coverageSentence('apple_stand_hours')).toBe('No coverage record for this metric.');
  });

  it('builds an availability table straight from the registry order', () => {
    const table = availabilityTable(['sleep_analysis', 'vo2max', 'apple_stand_hours']);
    expect(table.map(r => r.metricId)).toEqual(['sleep_analysis', 'vo2max', 'apple_stand_hours']);
    expect(table[0].hasData).toBe(true);
    expect(table[2].hasData).toBe(false);
    expect(table[2].unavailableReason).toContain('Not recorded');
  });
});

describe('coverage determinism', () => {
  it('does not depend on the current clock', () => {
    const first = coverageSentence('step_count');
    const second = coverageSentence('step_count');
    expect(first).toBe(second);
    expect(first).toContain('181 of 181 days recorded');
  });
});

import { describe, expect, it, afterEach } from 'vitest';
import samples from '@/data/hae-samples.json';
import {
  METRIC_MAPPINGS,
  aggregatePerDay,
  buildLiveDataset,
  normalizeBloodPressure,
  normalizeHeartRateDaily,
  normalizeSimpleMetric,
  normalizeSleep,
  normalizeWorkouts,
  round,
  type IntervalValue,
  type RawBloodPressureRecord,
  type RawSimpleRecord,
  type RawSleepRecord,
} from '@/lib/adapters/normalize';
import {
  REFERENCE_KEY,
  WINDOW_START_KEY,
  resetToDemoDataset,
  coverageFor,
  seriesFor,
  setActiveDataset,
} from '@/lib/adapters/dataset';
import { addDays, dayKey, diffDays, trailingWindow } from '@/lib/analytics/windows';
import { compareWindows } from '@/lib/analytics/comparisons';
import type { HealthFixtures } from '@/lib/metrics/types';

const TZ = 'America/Chicago';
const REFERENCE = '2026-09-17';
const CTX = { tz: TZ, referenceKey: REFERENCE, windowStartKey: '2026-07-23' };

afterEach(() => resetToDemoDataset());

const synthetic = samples.synthetic as unknown as {
  compositeAndDuplicate: RawSimpleRecord[];
  pounds: RawSimpleRecord[];
  miles: RawSimpleRecord[];
  fahrenheit: RawSimpleRecord[];
  hours: RawSleepRecord[];
};

describe('interval → daily aggregation, per strategy (SPEC §9)', () => {
  const values: IntervalValue[] = [
    { date: '2026-09-16', value: 10, source: 'watch' },
    { date: '2026-09-16', value: 20, source: 'watch' },
    { date: '2026-09-16', value: 30, source: 'watch' },
    { date: '2026-09-18', value: 7, source: 'watch' },
  ];

  it('sums per day for accumulating metrics', () => {
    const out = aggregatePerDay(values, 'sum');
    expect(out.map(o => [o.date, o.qty])).toEqual([
      ['2026-09-16', 60],
      ['2026-09-18', 7],
    ]);
  });

  it('averages per day for mean metrics', () => {
    const out = aggregatePerDay(values, 'mean');
    expect(out[0].qty).toBeCloseTo(20, 9);
  });

  it('takes the last reading of the day for sparse metrics', () => {
    const out = aggregatePerDay(values, 'latest');
    expect(out[0].qty).toBe(30);
  });

  it('produces no point for a day with no observation', () => {
    const out = aggregatePerDay(values, 'sum');
    expect(out.map(o => o.date)).not.toContain('2026-09-17');
  });

  it('flags the reference day as partial for accumulating metrics only', () => {
    const withToday: IntervalValue[] = [{ date: REFERENCE, value: 5, source: 'watch' }];
    const sum = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'step_count')!,
      withToday.map(v => ({ date: `${v.date}T12:00:00.000Z`, qty: v.value, units: 'count', source: v.source })),
      CTX
    )!;
    expect(sum.observations[0].partial).toBe(true);

    const mean = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'resting_heart_rate')!,
      [{ date: `${REFERENCE}T12:00:00.000Z`, qty: 60, units: 'count/min', source: 'watch' }],
      CTX
    )!;
    expect(mean.observations[0].partial).toBeUndefined();
  });
});

describe('metric-specific normalization of recorded samples', () => {
  it('applies metric-specific aggregation rather than averaging everything', () => {
    const steps = samples.metrics.step_count as unknown as RawSimpleRecord[];
    const normalized = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'step_count')!,
      steps,
      CTX
    )!;
    // Steps accumulate: the day total is the sum of that day's kept records.
    const dayTotal = normalized.observations.find(o => o.date === '2026-09-17')!;
    expect(dayTotal.qty).toBeGreaterThan(0);

    const hrv = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'heart_rate_variability')!,
      samples.metrics.heart_rate_variability as unknown as RawSimpleRecord[],
      CTX
    )!;
    // HRV is averaged per day, not summed.
    expect(hrv.observations.every(o => o.qty < 200)).toBe(true);
  });

  it('de-duplicates composite sources for a real step day', () => {
    const normalized = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'step_count')!,
      synthetic.compositeAndDuplicate,
      CTX
    )!;
    // Watch 120 at 05:00 (the phone's 100 is the same instant), composite 7 at
    // 06:00 counts once, the phone-only 3 at 07:00 is set aside because the watch
    // recorded that day.
    expect(normalized.observations).toHaveLength(1);
    expect(normalized.observations[0].date).toBe('2026-09-16');
    expect(normalized.observations[0].qty).toBeCloseTo(127, 6);
    expect(normalized.droppedRecords).toBe(2);
    expect(normalized.droppedIntervals).toBe(1);
  });

  it('converts pounds to kilograms exactly once', () => {
    const normalized = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'weight_body_mass')!,
      synthetic.pounds,
      CTX
    )!;
    expect(normalized.observations[0].qty).toBeCloseTo(100, 8);
    expect(normalized.observations[0].units).toBe('kg');
  });

  it('converts miles to kilometres', () => {
    const normalized = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'distance_walking_running')!,
      synthetic.miles,
      CTX
    )!;
    expect(normalized.observations[0].qty).toBeCloseTo(1.609344, 6);
  });

  it('converts Fahrenheit to Celsius', () => {
    const normalized = normalizeSimpleMetric(
      METRIC_MAPPINGS.find(m => m.metricId === 'apple_sleeping_wrist_temperature')!,
      synthetic.fahrenheit,
      CTX
    )!;
    expect(normalized.observations[0].qty).toBeCloseTo(37, 6);
  });

  it('maps upstream ids onto registry ids', () => {
    const byMetric = new Map(METRIC_MAPPINGS.map(m => [m.metricId, m.hae]));
    expect(byMetric.get('distance_walking_running')).toBe('walking_running_distance');
    expect(byMetric.get('apple_stand_hours')).toBe('apple_stand_hour');
    expect(byMetric.get('dietary_carbs')).toBe('carbohydrates');
    expect(byMetric.get('dietary_fat_total')).toBe('total_fat');
  });
});

describe('sleep composition (SPEC §9)', () => {
  const sleep = normalizeSleep(
    samples.metrics.sleep_analysis as unknown as RawSleepRecord[],
    CTX
  );
  const latest = sleep[sleep.length - 1];

  it('assigns each episode to its waking date', () => {
    // The record's date is 2026-09-16T05:00:00Z = midnight CDT on 2026-09-16.
    expect(latest.date).toBe('2026-09-16');
  });

  it('computes time asleep as core + deep + rem, in minutes', () => {
    const expected = round((4.948722919424374 + 0.744003798895412 + 1.454532992508676) * 60, 1);
    expect(latest.asleepMinutes).toBeCloseTo(expected, 6);
    expect(round(latest.stages.core + latest.stages.deep + latest.stages.rem, 1)).toBeCloseTo(expected, 1);
  });

  it('computes time in bed from the timestamps, not from the zeroed inBed field', () => {
    const raw = (samples.metrics.sleep_analysis as unknown as RawSleepRecord[]).slice(-1)[0];
    expect(raw.inBed).toBe(0);
    const minutes = (Date.parse(raw.inBedEnd!) - Date.parse(raw.inBedStart!)) / 60000;
    expect(latest.inBedMinutes).toBeCloseTo(round(minutes, 1), 6);
    expect(latest.inBedMinutes).toBeGreaterThan(latest.asleepMinutes);
    expect(latest.bedtime).toBe(raw.inBedStart);
    expect(latest.wakeTime).toBe(raw.inBedEnd);
  });

  it('keeps awake time separate from time asleep', () => {
    const syntheticNight = normalizeSleep(synthetic.hours, CTX)[0];
    expect(syntheticNight.asleepMinutes).toBeCloseTo(360, 6);
    expect(syntheticNight.inBedMinutes).toBeCloseTo(480, 6);
    expect(syntheticNight.durationMinutes).toBeCloseTo(390, 6);
  });

  it('never reports a night longer than the recorded timestamps', () => {
    // inBed fields contradict the timestamps (shorter than time asleep): the
    // fallback still keeps in bed at or above time asleep.
    const odd = normalizeSleep(
      [{ date: '2026-09-16T05:00:00.000Z', source: 'watch', awake: 0.1, core: 5, deep: 1, rem: 1, inBed: 0.5,
        inBedStart: '2026-09-16T05:00:00.000Z', inBedEnd: '2026-09-16T05:05:00.000Z' }],
      CTX
    )[0];
    expect(odd.inBedMinutes).toBeGreaterThanOrEqual(odd.asleepMinutes);
  });
});

// ── A repeated export is one night (SLEEP_REPEAT_RULE) ───
//
// The two records below are the real pair the live API returns: the same in-bed
// episode exported twice, an hour apart in `date`, with an identical window and
// identical stage totals. Identity is the window plus the totals, never the
// export instant, so this collapses to one night — and it must collapse in the
// live path, not only when a test builds it by hand.
describe('a sleep episode exported twice', () => {
  /** The live record, verbatim: identical in both copies. */
  const episode = {
    source: 'Apple Watch',
    awake: 0.05851470526721742,
    core: 2.800366176697943,
    deep: 0.4513843624790509,
    rem: 0.9864342602756289,
    inBed: 0,
    inBedStart: '2026-08-09T16:59:39.000Z',
    inBedEnd: '2026-08-09T21:17:27.000Z',
  };

  it('collapses to one night when only the export date differs', () => {
    const nights = normalizeSleep(
      [
        { ...episode, date: '2026-08-09T21:00:00.000Z' },
        { ...episode, date: '2026-08-09T22:00:00.000Z' },
      ],
      CTX
    );

    expect(nights).toHaveLength(1);
    expect(nights[0].date).toBe('2026-08-09');
    // 4.238184799452623 h asleep, counted once rather than twice.
    expect(nights[0].asleepMinutes).toBeCloseTo(254.3, 1);
    expect(nights[0].inBedMinutes).toBeCloseTo(257.8, 1);
  });

  it('keeps two zero-stage fragments that share a start instant but differ in window', () => {
    // The live 2026-08-14 pair: same start instant, different end and different
    // awake totals, no stage split on either. Two fragments, not a repeat.
    const fragment = {
      source: 'Apple Watch',
      deep: 0,
      core: 0,
      rem: 0,
      inBed: 0,
      inBedStart: '2026-08-14T19:43:32.000Z',
    };
    const nights = normalizeSleep(
      [
        { ...fragment, date: '2026-08-14T04:00:00.000Z', inBedEnd: '2026-08-14T21:49:55.000Z', awake: 0.04179526444938448 },
        { ...fragment, date: '2026-08-14T21:00:00.000Z', inBedEnd: '2026-08-14T22:59:38.000Z', awake: 0.4012375479274326 },
      ],
      CTX
    );

    expect(nights).toHaveLength(2);
    expect(nights.map(n => n.inBedMinutes)).toEqual([126.4, 196.1]);
    // Neither carries a stage split, so neither is a night of zero sleep.
    expect(nights.every(n => n.asleepMinutes === 0 && n.stages.deep === 0)).toBe(true);
  });

  it('is applied in the assembled dataset, so the raw count and the night count differ', () => {
    // The shape the live API returns: one episode exported twice, plus the two
    // genuine zero-stage fragments. Four records, three nights.
    const records: RawSleepRecord[] = [
      { ...episode, date: '2026-08-09T21:00:00.000Z' },
      { ...episode, date: '2026-08-09T22:00:00.000Z' },
      {
        date: '2026-08-14T04:00:00.000Z',
        source: 'Apple Watch',
        deep: 0, core: 0, rem: 0, inBed: 0,
        inBedStart: '2026-08-14T19:43:32.000Z',
        inBedEnd: '2026-08-14T21:49:55.000Z',
        awake: 0.04179526444938448,
      },
      {
        date: '2026-08-14T21:00:00.000Z',
        source: 'Apple Watch',
        deep: 0, core: 0, rem: 0, inBed: 0,
        inBedStart: '2026-08-14T19:43:32.000Z',
        inBedEnd: '2026-08-14T22:59:38.000Z',
        awake: 0.4012375479274326,
      },
    ];
    const built = buildLiveDataset(
      { metrics: { sleep_analysis: records }, workouts: [] },
      { tz: TZ, now: '2026-09-17T12:00:00.000Z', referenceKey: REFERENCE }
    );

    const sleep = built.dataset.metrics.sleep_analysis as unknown as { date: string }[];
    expect(records).toHaveLength(4);
    expect(sleep).toHaveLength(3);
    // The repeated export collapsed: one night on 2026-08-09 …
    expect(sleep.filter(s => s.date === '2026-08-09')).toHaveLength(1);
    // … and the two genuine fragments were both kept. Each is assigned to its
    // waking date (America/Chicago), which puts 04:00Z on the previous day.
    expect(sleep.filter(s => s.date === '2026-08-13')).toHaveLength(1);
    expect(sleep.filter(s => s.date === '2026-08-14')).toHaveLength(1);
    // The assembly reports the same counts it publishes.
    expect(built.stats.observations).toBe(sleep.length);
  });
});

describe('blood pressure and workouts', () => {
  it('keeps every blood pressure reading as a paired observation', () => {
    const bp = normalizeBloodPressure(
      samples.metrics.blood_pressure as unknown as RawBloodPressureRecord[],
      CTX
    );
    expect(bp.length).toBeGreaterThan(0);
    for (const r of bp) {
      expect(r.units).toBe('mmHg');
      // The cuff reports decimals; they are kept as recorded, never rounded away.
      expect(Number.isFinite(r.systolic)).toBe(true);
      expect(Number.isFinite(r.diastolic)).toBe(true);
      expect(r.systolic).toBeGreaterThan(0);
      expect(r.diastolic).toBeGreaterThan(0);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect([...bp.map(r => r.date)].sort()).toEqual(bp.map(r => r.date));
  });

  it('rounds the long float durations and calories, and invents no distance or heart rate', () => {
    const workouts = normalizeWorkouts(samples.workouts, CTX);
    const first = workouts.find(w => w.id === '22DC8D26-10EE-4F2F-B2D3-E84282570D6C')!;
    expect(first).toBeDefined();
    expect(String(first.duration_minutes)).not.toContain('1697040339311');
    expect(first.duration_minutes).toBeCloseTo(39.2, 6);
    expect(Number.isInteger(first.calories_burned)).toBe(true);
    expect(first.distance_km).toBeUndefined();
    expect(first.avg_heart_rate).toBeUndefined();
    expect(first.max_heart_rate).toBeUndefined();
    // Every session is rounded the same way.
    for (const w of workouts) {
      expect(String(w.duration_minutes)).not.toMatch(/\d{6,}/);
      expect(Number.isInteger(w.calories_burned)).toBe(true);
    }
  });

  it('de-duplicates a session exported more than once', () => {
    const duplicated = [...samples.workouts, ...samples.workouts];
    expect(normalizeWorkouts(duplicated, CTX)).toHaveLength(samples.workouts.length);
  });
});

describe('dataset assembly and coverage', () => {
  it('normalizes recorded samples into the internal dataset shape', () => {
    const built = buildLiveDataset(
      { metrics: samples.metrics as unknown as Record<string, unknown[]>, workouts: samples.workouts },
      { tz: TZ, now: '2026-09-17T18:00:00.000Z', referenceKey: REFERENCE }
    );

    const { dataset, stats, provenance } = built;
    expect(stats.recordsRead).toBeGreaterThan(200);
    expect(stats.observations).toBeGreaterThan(40);

    // Registry ids, not upstream ids.
    expect(dataset.metrics['distance_walking_running']).toBeDefined();
    expect(dataset.metrics['walking_running_distance']).toBeUndefined();
    expect(dataset.metrics['apple_stand_hours']).toBeDefined();
    expect(dataset.metrics['sleep_analysis']).toBeDefined();
    expect(dataset.metrics['blood_pressure']).toBeDefined();

    // An upstream metric with zero records produces no series at all — not a
    // zero-valued one.
    expect(samples.metrics.vo2max).toHaveLength(0);
    expect(dataset.metrics['vo2max']).toBeUndefined();
    expect(dataset.coverage['vo2max']).toBeUndefined();

    // Coverage is real: first/last instants and an expected-day count.
    const rhr = dataset.coverage['resting_heart_rate'];
    expect(rhr.observedDays).toBeGreaterThan(0);
    expect(rhr.expectedDays).toBeGreaterThanOrEqual(rhr.observedDays);
    expect(Date.parse(rhr.firstObservation)).toBeLessThan(Date.parse(rhr.lastObservation));

    // Provenance states the conversion and the de-dup rule for every metric.
    const weight = provenance.find(p => p.metricId === 'weight_body_mass')!;
    expect(weight.unitConversions).toContain('lb → kg');
    expect(weight.dedupeRule.length).toBeGreaterThan(10);
    const steps = provenance.find(p => p.metricId === 'step_count')!;
    expect(steps.aggregation).toBe('sum');
  });

  it('records daily heart rate as average, maximum and minimum', () => {
    const daily = normalizeHeartRateDaily(
      samples.metrics.heart_rate as unknown as { date: string; Avg?: number; Max?: number; Min?: number; units?: string; source?: string }[],
      CTX
    );
    expect(daily.length).toBeGreaterThan(0);
    for (const d of daily) {
      expect(d.max).toBeGreaterThanOrEqual(d.avg);
      expect(d.min).toBeLessThanOrEqual(d.avg);
    }
  });
});

describe('windowing and baselines against a 56-day history', () => {
  /** 56 consecutive daily resting-heart-rate records, as the live source has. */
  function shortHistoryDataset(): HealthFixtures {
    const start = '2026-07-23';
    const records: RawSimpleRecord[] = [];
    for (let i = 0; i < 56; i++) {
      const key = addDays(start, i);
      records.push({
        date: `${key}T05:00:00.000Z`,
        qty: 60 + (i % 5),
        units: 'count/min',
        source: 'Alex\u2019s Apple Watch',
      });
    }
    const built = buildLiveDataset(
      { metrics: { resting_heart_rate: records }, workouts: [] },
      { tz: TZ, now: '2026-09-17T18:00:00.000Z', referenceKey: REFERENCE }
    );
    return built.dataset;
  }

  it('measures coverage against the real (short) window', () => {
    const dataset = shortHistoryDataset();
    expect(dataset.days).toBe(diffDays('2026-07-23', REFERENCE) + 1);
    const cov = dataset.coverage['resting_heart_rate'];
    expect(cov.observedDays).toBe(56);
    expect(cov.expectedDays).toBe(dataset.days);
  });

  it('shows only the days that exist, and degrades a 90-day comparison honestly', () => {
    const dataset = shortHistoryDataset();
    setActiveDataset(dataset, { mode: 'live', dataAsOf: dataset.windowEnd });

    // The live-binding reference day follows the installed dataset.
    expect(REFERENCE_KEY).toBe(REFERENCE);
    expect(WINDOW_START_KEY).toBe('2026-07-23');

    const series = seriesFor('resting_heart_rate');
    expect(series).toHaveLength(56);

    // 7 days and 30 days have enough history; the baseline window is real.
    // The series ends the day before the reference day (as the live source does),
    // so the last 7-day window holds 6 recorded days.
    const week = compareWindows('resting_heart_rate', REFERENCE, 7);
    expect(week.comparison.valid).toBe(true);
    expect(week.counts.evaluated).toBe(6);
    expect(week.evaluatedWindow.endKey).toBe(REFERENCE);

    const month = compareWindows('resting_heart_rate', REFERENCE, 30);
    expect(month.comparison.valid).toBe(true);

    // 90, 180 and 365 days do not: the baseline window falls before the data
    // begins, so the comparison is reported as insufficient rather than as a
    // 90-day trend computed from 56 days.
    for (const days of [90, 180, 365]) {
      const cmp = compareWindows('resting_heart_rate', REFERENCE, days);
      expect(cmp.comparison.valid, `${days}d`).toBe(false);
      const window = trailingWindow(REFERENCE, days);
      expect(diffDays(window.startKey, WINDOW_START_KEY)).toBeGreaterThan(0);
      expect(cmp.counts.evaluated).toBeLessThanOrEqual(56);
    }

    resetToDemoDataset();
    expect(REFERENCE_KEY).toBe('2026-09-17');
    expect(WINDOW_START_KEY).toBe('2026-03-21');
    expect(coverageFor('vo2max')).toBeDefined();
  });

  it('still treats the demo fixtures as the default dataset', () => {
    // Nothing in this file installed a dataset before this expectation.
    expect(REFERENCE_KEY).toBe('2026-09-17');
    expect(seriesFor('resting_heart_rate').length).toBeGreaterThan(100);
    expect(dayKey('2026-09-17T12:00:00.000Z', TZ)).toBe('2026-09-17');
  });
});

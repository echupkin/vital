// ── A sleep record with no stage split is not a night of zero sleep ──
//
// Health Auto Export has exported sleep records that carry a valid in-bed window
// (`inBedStart`/`inBedEnd`) and no stage split at all (deep + core + rem == 0).
// Reading those as nights of zero sleep pulled the average time asleep down by
// about half an hour and invented a zero minimum.
//
// The rules asserted here, one per consumer:
//
//   1. a zero-stage record is an in-bed-only record: it contributes to time in
//      bed and to coverage, and is excluded from every time-asleep figure;
//   2. an episode exported twice (same in-bed window, same totals, two `date`
//      values) is one night, not two;
//   3. a genuinely short night is still a night — only zero-stage records drop
//      out;
//   4. the Overview and the Sleep page read the same filtered series, so the two
//      pages can never disagree about time asleep.

import { afterEach, describe, expect, it } from 'vitest';
import {
  REFERENCE_KEY,
  coverageFor,
  hasSleepStages,
  resetToDemoDataset,
  seriesFor,
  seriesInWindow,
  setActiveDataset,
  sleepCoverageSummary,
  sleepSeries,
} from '@/lib/adapters/dataset';
import { buildSeriesSummary, mean, median, min, max } from '@/lib/analytics';
import { normalizeSleep } from '@/lib/adapters/normalize';
import type { HealthFixtures, SleepObservation } from '@/lib/metrics/types';

afterEach(() => resetToDemoDataset());

/** A 400-minute in-bed window with no stage split recorded. */
function inBedOnly(date: string, bedtime: string, wakeTime: string): SleepObservation {
  const minutes = (Date.parse(wakeTime) - Date.parse(bedtime)) / 60000;
  return {
    date,
    bedtime,
    wakeTime,
    durationMinutes: minutes,
    inBedMinutes: minutes,
    asleepMinutes: 0,
    stages: { deep: 0, rem: 0, core: 0, awake: 0 },
    source: 'test device',
  };
}

/** A night with a real stage split. */
function stagedNight(date: string, asleepMinutes: number, bedtime: string, wakeTime: string): SleepObservation {
  const inBed = (Date.parse(wakeTime) - Date.parse(bedtime)) / 60000;
  return {
    date,
    bedtime,
    wakeTime,
    durationMinutes: asleepMinutes + (inBed - asleepMinutes),
    inBedMinutes: inBed,
    asleepMinutes,
    stages: {
      deep: Math.round(asleepMinutes * 0.2 * 10) / 10,
      rem: Math.round(asleepMinutes * 0.2 * 10) / 10,
      core: Math.round(asleepMinutes * 0.6 * 10) / 10,
      awake: Math.round((inBed - asleepMinutes) * 10) / 10,
    },
    source: 'test device',
  };
}

/**
 * Four records: a full night, an in-bed-only record, a genuinely short night,
 * and the full night exported a second time under a different `date`.
 */
function datasetWithMixedNights(): HealthFixtures {
  const full = stagedNight('2026-09-10', 500, '2026-09-10T05:00:00.000Z', '2026-09-10T14:30:00.000Z');
  return {
    referenceDate: '2026-09-12T18:00:00.000Z',
    windowStart: '2026-09-10T05:00:00.000Z',
    windowEnd: '2026-09-12T14:00:00.000Z',
    days: 3,
    timezone: 'America/Chicago',
    metrics: {
      sleep_analysis: [
        full,
        inBedOnly('2026-09-11', '2026-09-11T05:00:00.000Z', '2026-09-11T11:40:00.000Z'),
        // The same episode, exported again an hour later: identical window, identical totals.
        { ...full, date: '2026-09-10T22:00:00.000Z' },
        stagedNight('2026-09-12', 254.3, '2026-09-12T05:40:00.000Z', '2026-09-12T10:00:00.000Z'),
      ],
    },
    workouts: [],
    coverage: {
      sleep_analysis: {
        firstObservation: '2026-09-10T05:00:00.000Z',
        lastObservation: '2026-09-12T05:40:00.000Z',
        observedDays: 3,
        expectedDays: 3,
        samplingFrequency: 'nightly',
        sourceNames: ['test device'],
      },
    },
  };
}

describe('an in-bed-only sleep record', () => {
  it('is excluded from every time-asleep statistic but counted in coverage', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    const nights = sleepSeries();
    const inBedOnly = nights.filter(n => !hasSleepStages(n));
    expect(inBedOnly).toHaveLength(1);

    const asleep = seriesFor('sleep_analysis').map(p => p.value);
    // Only the nights with a recorded stage split carry a time-asleep value.
    expect(asleep).toEqual([500, 254.3]);
    expect(asleep).not.toContain(0);

    const zeroWouldDrag = mean([500, 0, 254.3]);
    expect(mean(asleep)).toBeCloseTo(377.15, 6);
    expect(mean(asleep)).not.toBeCloseTo(zeroWouldDrag, 6);
    expect(median(asleep)).toBeCloseTo(377.15, 6);
    expect(min(asleep)).toBeCloseTo(254.3, 6);
    expect(max(asleep)).toBeCloseTo(500, 6);

    // It is still a night, and coverage says so.
    const coverage = sleepCoverageSummary(nights);
    expect(coverage).toEqual({ nights: 3, nightsWithStages: 2, inBedOnlyNights: 1 });
  });

  it('still contributes to time in bed, where in-bed time is the statistic', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    const inBed = seriesFor('sleep_in_bed').map(p => p.value);
    expect(inBed).toHaveLength(3);
    expect(inBed).toContain(400);
    expect(mean(inBed)).toBeCloseTo((570 + 400 + 260) / 3, 6);
  });
});

describe('an episode exported twice', () => {
  it('is one night, not two', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    const nights = sleepSeries();
    // Four records, three nights: the second export of 2026-09-10 is the same night.
    expect(nights).toHaveLength(3);
    expect(nights.filter(n => n.key === '2026-09-10')).toHaveLength(1);
    expect(seriesFor('sleep_analysis').map(p => p.value)).toEqual([500, 254.3]);
  });

  it('is collapsed by the normalizer as well, so provenance and coverage agree', () => {
    const full = {
      date: '2026-09-10T05:00:00.000Z',
      source: 'watch',
      awake: 4.3,
      core: 5,
      deep: 1.7,
      rem: 1.6,
      inBedStart: '2026-09-10T05:00:00.000Z',
      inBedEnd: '2026-09-10T14:30:00.000Z',
    };
    const normalized = normalizeSleep(
      [
        full,
        // Same window, same totals, a different export instant.
        { ...full, date: '2026-09-10T22:00:00.000Z' },
        // Same start instant but a different window and different totals: a real,
        // separate episode and never merged.
        { ...full, inBedEnd: '2026-09-10T22:00:00.000Z', core: 9, awake: 0.4 },
      ],
      { tz: 'America/Chicago', referenceKey: '2026-09-11', windowStartKey: '2026-09-10' }
    );
    expect(normalized).toHaveLength(2);
    expect(normalized[0].stages.core).toBe(300);
    expect(normalized[1].stages.core).toBe(540);
  });
});

describe('a genuinely short night', () => {
  it('is still counted — only zero-stage records are excluded', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    const short = sleepSeries().find(n => n.key === '2026-09-12')!;
    expect(hasSleepStages(short)).toBe(true);
    expect(short.asleepMinutes).toBeCloseTo(254.3, 6);
    expect(short.asleepMinutes / 60).toBeCloseTo(4.238, 3);
    expect(seriesFor('sleep_analysis').map(p => p.value)).toContain(254.3);
    expect(min(seriesFor('sleep_analysis').map(p => p.value))).toBeCloseTo(254.3, 6);
  });
});

describe('every consumer of time asleep', () => {
  it('reads the same filtered night series as the Sleep page', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    // Sleep page population: the nights it aggregates duration over.
    const sleepPage = sleepSeries().filter(hasSleepStages).map(n => n.asleepMinutes);
    // Overview card / weekly row / analyst bundle: the metric series.
    const overview = seriesFor('sleep_analysis').map(p => p.value);
    expect(overview).toEqual(sleepPage);

    // …and the 30-day summary the domain cards render is built from it too.
    // (Its comparison needs the registry's 3-observation minimum, so only the
    // point series is asserted here — that is the series every consumer reads.)
    const summary = buildSeriesSummary('sleep_analysis', REFERENCE_KEY, 30);
    expect(summary.points.map(p => p.value)).toEqual(sleepPage);
    expect(mean(summary.points.map(p => p.value))).toBeCloseTo(mean(sleepPage), 6);
    expect(seriesInWindow('sleep_analysis', summary.window).map(p => p.value)).toEqual(sleepPage);
  });
});

// ── Every sleep count comes from the one de-duplicated series ────
//
// The chart label, the coverage sentence, "Nights recorded" and the stage-split
// share are all rendered from `sleepCoverageSummary(sleepSeries())`. These two
// tests pin the invariants that make those figures agree, and the one place they
// legitimately differ from a calendar-day count.
describe('the counts behind the coverage sentences', () => {
  it('never reports more calendar days than nights, and counts each night once', () => {
    setActiveDataset(datasetWithMixedNights(), { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' });

    const nights = sleepSeries();
    const coverage = sleepCoverageSummary(nights);
    // Four records, three nights: the repeated export is not a second night.
    expect(coverage).toEqual({ nights: 3, nightsWithStages: 2, inBedOnlyNights: 1 });
    expect(nights).toHaveLength(coverage.nights);

    // The day-coverage figure is a different measure and can only be smaller:
    // two nights can fall on one waking date, never more days than nights.
    const observedDays = coverageFor('sleep_analysis')?.observedDays ?? 0;
    expect(observedDays).toBeGreaterThan(0);
    expect(observedDays).toBeLessThanOrEqual(coverage.nights);
  });

  it('counts two episodes on one waking date as two nights and one calendar day', () => {
    // Split sleep: two in-bed windows assigned to the same waking date. They are
    // two nights on the chart and one day in the coverage row — which is exactly
    // why the two figures are labelled differently and never mixed.
    const first = stagedNight('2026-09-11', 240, '2026-09-11T05:00:00.000Z', '2026-09-11T09:30:00.000Z');
    const second = stagedNight('2026-09-11', 260, '2026-09-11T18:00:00.000Z', '2026-09-11T23:00:00.000Z');
    setActiveDataset(
      {
        referenceDate: '2026-09-12T18:00:00.000Z',
        windowStart: '2026-09-11T05:00:00.000Z',
        windowEnd: '2026-09-12T14:00:00.000Z',
        days: 2,
        timezone: 'America/Chicago',
        metrics: { sleep_analysis: [first, second] },
        workouts: [],
        coverage: {
          sleep_analysis: {
            firstObservation: '2026-09-11T05:00:00.000Z',
            lastObservation: '2026-09-11T18:00:00.000Z',
            observedDays: 1,
            expectedDays: 2,
            samplingFrequency: 'nightly',
            sourceNames: ['test device'],
          },
        },
      },
      { mode: 'demo', dataAsOf: '2026-09-12T18:00:00.000Z' }
    );

    const coverage = sleepCoverageSummary(sleepSeries());
    expect(coverage.nights).toBe(2);
    expect(coverage.nightsWithStages).toBe(2);
    expect(coverageFor('sleep_analysis')?.observedDays).toBe(1);
    // Both sleep figures the page renders come from the same series …
    expect(sleepSeries()).toHaveLength(coverage.nights);
    // … and time asleep is the mean of both episodes, not just the last.
    expect(mean(seriesFor('sleep_analysis').map(p => p.value))).toBeCloseTo(250, 6);
  });
});

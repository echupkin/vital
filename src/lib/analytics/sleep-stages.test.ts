// ── Sleep stages per night (owner request 6) ────────────
//
// The Sleep page's main chart stacks deep / core / REM / awake for one night per
// bar, and states time asleep and time in bed alongside it. Two contracts make
// that chart honest:
//
//   * the stage split sums to time asleep, and awake is the time awake inside
//     the in-bed window (so asleep + awake = in bed for the committed data), and
//   * a night whose record carries no stage split is reported as zero stages —
//     the caller draws its total asleep with no split inferred.

import { afterEach, describe, expect, it } from 'vitest';
import {
  hasSleepStages,
  resetToDemoDataset,
  setActiveDataset,
  sleepSeries,
} from '@/lib/adapters/dataset';
import { normalizeSleep } from '@/lib/adapters/normalize';
import { sleepStageRow } from '@/components/charts/SleepStageChart';
import type { HealthFixtures } from '@/lib/metrics/types';

afterEach(() => resetToDemoDataset());

describe('stage data in the active dataset', () => {
  it('sums deep + core + REM to time asleep and keeps awake inside the in-bed window', () => {
    const nights = sleepSeries();
    expect(nights.length).toBeGreaterThan(0);
    for (const night of nights) {
      const { deep, core, rem, awake } = night.stages;
      expect(deep + core + rem).toBeCloseTo(night.asleepMinutes, 1);
      expect(night.asleepMinutes + awake).toBeCloseTo(night.inBedMinutes, 1);
      expect(awake).toBeGreaterThanOrEqual(0);
      expect(hasSleepStages(night)).toBe(true);
    }
  });
});

describe('a night with no recorded stage split', () => {
  it('reports zero stages rather than inventing a split, and keeps its totals', () => {
    const fixtures: HealthFixtures = {
      referenceDate: '2026-09-18T04:59:59.999Z',
      windowStart: '2026-09-17T05:00:00.000Z',
      windowEnd: '2026-09-18T04:59:59.999Z',
      days: 2,
      timezone: 'America/Chicago',
      metrics: {
        sleep_analysis: [
          {
            date: '2026-09-18',
            bedtime: '2026-09-18T04:20:00.000Z',
            wakeTime: '2026-09-18T11:40:00.000Z',
            durationMinutes: 440,
            inBedMinutes: 440,
            asleepMinutes: 420,
            // No stage split recorded by the source for this night.
            stages: { deep: 0, rem: 0, core: 0, awake: 0 },
            source: 'test device',
          },
        ],
      },
      workouts: [],
      coverage: {},
    };
    setActiveDataset(fixtures, { mode: 'demo', dataAsOf: fixtures.windowEnd });

    const [night] = sleepSeries();
    expect(night).toBeDefined();
    expect(night.stages).toEqual({ deep: 0, rem: 0, core: 0, awake: 0 });
    expect(hasSleepStages(night)).toBe(false);
    // The totals are still there, so the chart can draw the night as its total.
    expect(night.asleepMinutes).toBe(420);
    expect(night.inBedMinutes).toBe(440);
  });
});

describe('the live normalizer', () => {
  it('carries the recorded awake time through to the stored stages', () => {
    const [night] = normalizeSleep(
      [
        {
          date: '2026-09-17T05:00:00.000Z',
          source: 'watch',
          core: 5,
          deep: 1,
          rem: 1,
          awake: 0.25,
          inBedStart: '2026-09-17T04:00:00.000Z',
          inBedEnd: '2026-09-17T11:30:00.000Z',
        },
      ],
      { tz: 'America/Chicago', referenceKey: '2026-09-17', windowStartKey: '2026-09-17' }
    );
    expect(night.stages).toEqual({ deep: 60, rem: 60, core: 300, awake: 15 });
    expect(night.asleepMinutes).toBe(420);
    // In bed comes from the timestamps, so it can be a little longer than
    // asleep + awake: it includes the time taken to fall asleep.
    expect(night.inBedMinutes).toBe(450);
  });
});

describe('the chart row for a night', () => {
  it('splits a night with stage data into the four recorded stages', () => {
    const [night] = sleepSeries();
    const row = sleepStageRow(night);
    expect(row.hasStages).toBe(true);
    expect(row.unrecorded).toBe(0);
    expect(row.deep).toBe(night.stages.deep);
    expect(row.core).toBe(night.stages.core);
    expect(row.rem).toBe(night.stages.rem);
    expect(row.awake).toBe(night.stages.awake);
    expect(row.deep + row.core + row.rem + row.awake).toBeCloseTo(night.asleepMinutes + night.stages.awake, 1);
  });

  it('draws a night with no stage split as its in-bed window, with no stage invented', () => {
    const row = sleepStageRow({
      key: '2026-08-14',
      asleepMinutes: 0,
      inBedMinutes: 126,
      durationMinutes: 126,
      bedtime: '2026-08-14T19:43:32.000Z',
      wakeTime: '2026-08-14T21:49:55.000Z',
      stages: { deep: 0, rem: 0, core: 0, awake: 0 },
      source: 'test device',
    });
    expect(row.hasStages).toBe(false);
    expect(row.unrecorded).toBe(126);
    expect(row.deep + row.core + row.rem + row.awake).toBe(0);
    // The totals are untouched, so the tooltip and the table can state them.
    expect(row.asleep).toBe(0);
    expect(row.inBed).toBe(126);
  });
});

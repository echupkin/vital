import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY, workoutList } from '@/lib/adapters/dataset';
import { dayKey } from '@/lib/analytics/windows';
import {
  filterWorkouts,
  MIN_COMPARABLE_WORKOUTS,
  weeklyWorkoutCounts,
  workoutDayKey,
  workoutGroupComparison,
  workoutTotals,
  workoutTypes,
  workoutViews,
  WORKOUT_COMPARISON_RULE,
} from '@/lib/analytics';

describe('workout day keys (dataset timezone, not UTC slices)', () => {
  it('resolves the calendar day in the dataset timezone', () => {
    // Stored as 2026-04-06T01:27Z, which is 2026-04-05 20:27 in America/Chicago.
    const record = workoutList().find(w => w.start_time === '2026-04-06T01:27:00.000Z');
    expect(record).toBeDefined();
    expect(workoutDayKey(record!)).toBe('2026-04-05');
    expect(record!.start_time.slice(0, 10)).toBe('2026-04-06');
    expect(workoutDayKey(record!)).toBe(dayKey(record!.start_time));
  });

  it('derives every session key from the shared day-key helper', () => {
    for (const view of workoutViews()) {
      expect(view.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(view.key >= '2026-03-21' && view.key <= REFERENCE_KEY).toBe(true);
    }
  });
});

describe('workout filtering (SPEC §7)', () => {
  it('filters by activity type, date range and sort order', () => {
    const all = workoutViews();
    const running = filterWorkouts({ type: 'Running', days: 365, sort: 'date-desc' }, all);
    expect(running.views.length).toBeGreaterThan(0);
    expect(running.views.every(v => v.workout_type === 'Running')).toBe(true);
    expect(running.inWindowCount).toBeGreaterThanOrEqual(running.views.length);

    const asc = filterWorkouts({ type: 'all', days: 365, sort: 'date-asc' }, all);
    const keys = asc.views.map(v => v.start_time);
    expect([...keys].sort()).toEqual(keys);

    const desc = filterWorkouts({ type: 'all', days: 365, sort: 'date-desc' }, all);
    expect([...desc.views.map(v => v.start_time)].sort().reverse()).toEqual(desc.views.map(v => v.start_time));
  });

  it('narrows by date range without inventing sessions', () => {
    const all = workoutViews();
    const thirty = filterWorkouts({ type: 'all', days: 30, sort: 'date-desc' }, all);
    const ninety = filterWorkouts({ type: 'all', days: 90, sort: 'date-desc' }, all);
    expect(thirty.views.length).toBeLessThanOrEqual(ninety.views.length);
    expect(thirty.views.every(v => v.key >= thirty.window.startKey)).toBe(true);
    expect(thirty.totals.sessions).toBe(thirty.views.length);
  });

  it('lists activity types with their counts, computed from the records', () => {
    const types = workoutTypes();
    expect(types.map(t => t.type)).toEqual(['Cycling', 'Running', 'Strength', 'Swimming', 'Walking', 'Yoga']);
    const total = types.reduce((a, t) => a + t.count, 0);
    expect(total).toBe(workoutList().length);
  });

  it('leaves distance unset rather than zero when nothing recorded it', () => {
    const noDistance = workoutViews().filter(v => !v.hasDistance);
    expect(noDistance.length).toBeGreaterThan(0);
    expect(Number.isNaN(workoutTotals(noDistance).distanceKm)).toBe(true);
    expect(workoutTotals(noDistance).distanceSessions).toBe(0);
  });
});

describe('workout comparison rule (SPEC §7: only when enough records)', () => {
  it('refuses an average below the minimum and states the rule', () => {
    const views = workoutViews();
    const rule = WORKOUT_COMPARISON_RULE;
    expect(rule).toContain(String(MIN_COMPARABLE_WORKOUTS));

    // A two-session type cannot be compared.
    const tiny = views.slice(0, 2);
    const tinyType = tiny[0].workout_type;
    const comparison = workoutGroupComparison(tiny, tinyType, tiny[0].id);
    expect(comparison.comparedSessions).toBeLessThan(MIN_COMPARABLE_WORKOUTS);
    expect(comparison.comparable).toBe(false);
    expect(comparison.unavailableReason).toContain(String(MIN_COMPARABLE_WORKOUTS));
  });

  it('compares a type once it has enough sessions, and excludes the viewed one', () => {
    const views = workoutViews();
    const running = workoutGroupComparison(views, 'Running');
    expect(running.comparable).toBe(true);
    expect(running.duration.count).toBe(running.comparedSessions);
    expect(running.duration.average).toBeGreaterThan(0);
    expect(running.distance?.count).toBeGreaterThanOrEqual(MIN_COMPARABLE_WORKOUTS);
    expect(running.avgHeartRate?.count).toBeGreaterThanOrEqual(MIN_COMPARABLE_WORKOUTS);

    const withoutOne = workoutGroupComparison(views, 'Running', views.find(v => v.workout_type === 'Running')!.id);
    expect(withoutOne.comparedSessions).toBe(running.comparedSessions - 1);
  });

  it('reports per-field counts so a partially recorded field is never averaged as if complete', () => {
    const comparison = workoutGroupComparison(workoutViews(), 'Running');
    expect(comparison.duration.count).toBe(12);
    expect(comparison.avgHeartRate!.count).toBeLessThanOrEqual(comparison.comparedSessions);
  });
});

describe('workout frequency blocks', () => {
  it('counts 7-day blocks ending on the reference day', () => {
    const blocks = weeklyWorkoutCounts(workoutViews(), 4);
    expect(blocks).toHaveLength(4);
    const last = blocks[blocks.length - 1];
    expect(last.endKey).toBe(REFERENCE_KEY);
    expect(last.startKey).toBe('2026-09-11');
    const total = blocks.reduce((a, b) => a + b.count, 0);
    const inRange = workoutViews().filter(v => v.key >= blocks[0].startKey && v.key <= REFERENCE_KEY);
    expect(total).toBe(inRange.length);
  });
});

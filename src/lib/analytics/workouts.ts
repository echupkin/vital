// ── Workouts: filtering, totals and comparison rules ────
//
// Workout records carry only the fields the dataset actually contains: type,
// start/end, duration, calories, source and (for some records) distance, average
// and maximum heart rate. No routes, elevation, pace or maps are invented.
//
// A workout's calendar day is resolved in the dataset timezone, not by slicing
// the UTC timestamp: a 20:27 CDT workout is stored as 01:27Z the next day.

import type { WorkoutRecord } from '../metrics/types';
import { REFERENCE_TZ, REFERENCE_KEY, workoutList } from '../adapters/dataset';
import { mean, sum } from './stats';
import { containsDay, dayKey, addDays, formatDayKeyLong, trailingWindow, windowRangeLabel, type DayWindow } from './windows';

export type WorkoutSort = 'date-desc' | 'date-asc' | 'duration' | 'calories' | 'distance';

export interface WorkoutFilter {
  /** Activity type, or 'all'. */
  type: string;
  /** Trailing window in days. */
  days: number;
  sort: WorkoutSort;
  /** Sort descending for the ordered sorts (date-asc is always ascending). */
  descending?: boolean;
}

export interface WorkoutView extends WorkoutRecord {
  /** Calendar day of the start, in the dataset timezone. */
  key: string;
  /** Local wall-clock start / end times. */
  startClock: string;
  endClock: string;
  /** True when distance and heart rate were recorded for this session. */
  hasDistance: boolean;
  hasHeartRate: boolean;
}

/**
 * A type with fewer than this many records is not compared: averages over two
 * or three sessions describe the sessions, not the activity.
 */
export const MIN_COMPARABLE_WORKOUTS = 4;

export const WORKOUT_COMPARISON_RULE =
  `Similar workouts are compared only when the same activity type has at least ${MIN_COMPARABLE_WORKOUTS} recorded sessions; a field (distance, average heart rate, maximum heart rate) is compared only when at least ${MIN_COMPARABLE_WORKOUTS} sessions of that type recorded it.`;

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: REFERENCE_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function workoutDayKey(record: Pick<WorkoutRecord, 'start_time'>): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(record.start_time)
    ? record.start_time
    : dayKey(record.start_time, REFERENCE_TZ);
}

export function workoutViews(records: WorkoutRecord[] = workoutList()): WorkoutView[] {
  return records.map(r => ({
    ...r,
    key: workoutDayKey(r),
    startClock: CLOCK.format(new Date(r.start_time)),
    endClock: CLOCK.format(new Date(r.end_time)),
    hasDistance: typeof r.distance_km === 'number',
    hasHeartRate: typeof r.avg_heart_rate === 'number' && typeof r.max_heart_rate === 'number',
  }));
}

export interface WorkoutTotals {
  sessions: number;
  minutes: number;
  calories: number;
  /** NaN when no session in the set recorded a distance. */
  distanceKm: number;
  distanceSessions: number;
  minutesPerSession: number;
}

export function workoutTotals(views: WorkoutView[]): WorkoutTotals {
  const distances = views.filter(v => v.hasDistance).map(v => v.distance_km as number);
  return {
    sessions: views.length,
    minutes: sum(views.map(v => v.duration_minutes)),
    calories: sum(views.map(v => v.calories_burned)),
    distanceKm: distances.length ? sum(distances) : NaN,
    distanceSessions: distances.length,
    minutesPerSession: views.length ? mean(views.map(v => v.duration_minutes)) : NaN,
  };
}

export function workoutTypes(views: WorkoutView[] = workoutViews()): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of views) counts.set(v.workout_type, (counts.get(v.workout_type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** The window a filter resolves to, and the sessions inside it. */
export interface FilteredWorkouts {
  window: DayWindow;
  views: WorkoutView[];
  totals: WorkoutTotals;
  /** Sessions in the window before the type filter was applied. */
  inWindowCount: number;
}

export function filterWorkouts(
  filter: WorkoutFilter,
  all: WorkoutView[] = workoutViews(),
  refKey: string = REFERENCE_KEY
): FilteredWorkouts {
  const window = trailingWindow(refKey, filter.days, `Last ${filter.days} days`);
  const inWindow = all.filter(v => containsDay(window, v.key));
  const typed = filter.type === 'all' ? inWindow : inWindow.filter(v => v.workout_type === filter.type);
  const sorted = [...typed].sort(comparatorFor(filter));
  return {
    window,
    views: sorted,
    totals: workoutTotals(typed),
    inWindowCount: inWindow.length,
  };
}

function comparatorFor(filter: WorkoutFilter): (a: WorkoutView, b: WorkoutView) => number {
  const dir = filter.descending === false ? 1 : -1;
  switch (filter.sort) {
    case 'date-asc':
      return (a, b) => a.start_time.localeCompare(b.start_time);
    case 'duration':
      return (a, b) => dir * (a.duration_minutes - b.duration_minutes);
    case 'calories':
      return (a, b) => dir * (a.calories_burned - b.calories_burned);
    case 'distance':
      return (a, b) => dir * ((a.distance_km ?? -1) - (b.distance_km ?? -1));
    case 'date-desc':
    default:
      return (a, b) => dir * a.start_time.localeCompare(b.start_time);
  }
}

export interface FieldComparison {
  /** How many sessions of the type recorded this field. */
  count: number;
  average: number;
  min: number;
  max: number;
  /** False when fewer than MIN_COMPARABLE_WORKOUTS sessions recorded it. */
  comparable: boolean;
}

export interface WorkoutComparison {
  type: string;
  /** Sessions of this type in the window. */
  sessions: number;
  /** Sessions compared (the selected one excluded when `exceptId` is given). */
  comparedSessions: number;
  duration: FieldComparison;
  calories: FieldComparison;
  distance: FieldComparison | null;
  avgHeartRate: FieldComparison | null;
  maxHeartRate: FieldComparison | null;
  /** True only when at least the duration comparison is possible. */
  comparable: boolean;
  rule: string;
  /** Why the comparison is unavailable, when it is. */
  unavailableReason: string | null;
}

function field(values: number[]): FieldComparison {
  return {
    count: values.length,
    average: mean(values),
    min: values.length ? Math.min(...values) : NaN,
    max: values.length ? Math.max(...values) : NaN,
    comparable: values.length >= MIN_COMPARABLE_WORKOUTS,
  };
}

/**
 * Compare the sessions of one activity type. `exceptId` removes the session
 * being viewed so it is not compared with itself.
 */
export function workoutGroupComparison(
  views: WorkoutView[],
  type: string,
  exceptId?: string
): WorkoutComparison {
  const ofType = views.filter(v => v.workout_type === type);
  const others = exceptId ? ofType.filter(v => v.id !== exceptId) : ofType;
  const distances = others.filter(v => v.hasDistance).map(v => v.distance_km as number);
  const avgHr = others.filter(v => v.hasHeartRate).map(v => v.avg_heart_rate as number);
  const maxHr = others.filter(v => v.hasHeartRate).map(v => v.max_heart_rate as number);
  const duration = field(others.map(v => v.duration_minutes));

  const comparable = duration.comparable;
  return {
    type,
    sessions: ofType.length,
    comparedSessions: others.length,
    duration,
    calories: field(others.map(v => v.calories_burned)),
    distance: distances.length ? field(distances) : null,
    avgHeartRate: avgHr.length ? field(avgHr) : null,
    maxHeartRate: maxHr.length ? field(maxHr) : null,
    comparable,
    rule: WORKOUT_COMPARISON_RULE,
    unavailableReason: comparable
      ? null
      : `Only ${others.length} comparable ${type.toLowerCase()} ${others.length === 1 ? 'session' : 'sessions'} in this window. At least ${MIN_COMPARABLE_WORKOUTS} are needed before an average is shown.`,
  };
}

/** Workouts per 7-day block ending on the reference day, most recent last. */
export interface WeeklyWorkoutCount {
  startKey: string;
  endKey: string;
  count: number;
  minutes: number;
}

export function weeklyWorkoutCounts(
  views: WorkoutView[] = workoutViews(),
  weeks = 8,
  refKey: string = REFERENCE_KEY
): WeeklyWorkoutCount[] {
  const out: WeeklyWorkoutCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const endKey = addDays(refKey, -i * 7);
    const startKey = addDays(endKey, -6);
    const inWeek = views.filter(v => v.key >= startKey && v.key <= endKey);
    out.push({
      startKey,
      endKey,
      count: inWeek.length,
      minutes: sum(inWeek.map(v => v.duration_minutes)),
    });
  }
  return out;
}

/** 'Mar 22, 2026 · 3:13 PM – 3:56 PM' */
export function workoutWhenLabel(view: WorkoutView): string {
  return `${formatDayKeyLong(view.key)} · ${view.startClock} – ${view.endClock}`;
}

export function workoutWindowLabel(win: DayWindow): string {
  return windowRangeLabel(win);
}

// ── Body goal: readings and the weight trend ────────────
//
// Weigh-ins are noisy (water, salt, timing) and irregular, so nothing here
// reads a single weigh-in as "current": current weight is the mean of the last
// seven days' weigh-ins, and the rate is the weight trend — a least-squares
// line over four weeks with recent weeks counting more (analytics/weight-trend).
// Days without a weigh-in are simply absent — nothing is carried forward or
// filled in.

import { addDays, diffDays } from '../analytics/windows';
import { linearSlope, mean } from '../analytics/stats';
import { weightTrendSlope } from '../analytics/weight-trend';
import { CURRENT_DAYS, RECENT_TREND_DAYS, START_SEARCH_DAYS, TREND_DAYS } from './constants';

export interface DayValue {
  key: string;
  value: number;
}

/** A value averaged from the readings between two days. */
export interface Reading {
  value: number;
  from: string;
  to: string;
  count: number;
}

export function between(points: DayValue[], from: string, to: string): DayValue[] {
  return points.filter(p => p.key >= from && p.key <= to && Number.isFinite(p.value));
}

function readingOf(points: DayValue[]): Reading | null {
  if (points.length === 0) return null;
  return {
    value: mean(points.map(p => p.value)),
    from: points[0].key,
    to: points[points.length - 1].key,
    count: points.length,
  };
}

/**
 * The mean of the last `days` days' readings up to `today`. When there are none
 * in that span, the latest reading within the trend window stands in for it.
 */
export function currentReading(points: DayValue[], today: string, days = CURRENT_DAYS): Reading | null {
  const recent = between(points, addDays(today, -(days - 1)), today);
  if (recent.length > 0) return readingOf(recent);
  const older = between(points, addDays(today, -(TREND_DAYS - 1)), today);
  return older.length ? readingOf(older.slice(-1)) : null;
}

/**
 * The reading as of `day`, measured the same way as "current": the mean of the
 * seven days up to it, or failing that the nearest reading within a week. Where
 * a goal started is read this way, from the data, every time it is shown — so
 * on the day a goal is set, start and current are the same number.
 */
export function readingNear(points: DayValue[], day: string): Reading | null {
  const trailing = between(points, addDays(day, -(CURRENT_DAYS - 1)), day);
  if (trailing.length) return readingOf(trailing);
  const wide = between(points, addDays(day, -START_SEARCH_DAYS), addDays(day, START_SEARCH_DAYS));
  if (!wide.length) return null;
  const nearest = [...wide].sort((a, b) => Math.abs(diffDays(day, a.key)) - Math.abs(diffDays(day, b.key)))[0];
  return readingOf([nearest]);
}

export interface WeightTrend {
  current: Reading | null;
  /** The weight trend over the trend window, recent weeks counting more, kg/week. Negative when losing. */
  rateKgPerWeek: number | null;
  /** A plain (equal-weight) least-squares slope over the last two weeks, kg/week. */
  recentRateKgPerWeek: number | null;
  /** `rateKgPerWeek` as % of current weight per week. */
  ratePct: number | null;
  /** Weigh-ins inside the trend window. */
  weighIns: number;
  from: string;
  to: string;
}

export function weightTrend(points: DayValue[], today: string): WeightTrend {
  const from = addDays(today, -(TREND_DAYS - 1));
  const window = between(points, from, today);
  const recent = between(points, addDays(today, -(RECENT_TREND_DAYS - 1)), today);
  const perDay = weightTrendSlope(window, today);
  const recentPerDay = linearSlope(recent, 3);
  const current = currentReading(points, today);
  const rateKgPerWeek = perDay === null ? null : perDay * 7;
  return {
    current,
    rateKgPerWeek,
    recentRateKgPerWeek: recentPerDay === null ? null : recentPerDay * 7,
    ratePct: rateKgPerWeek !== null && current ? (rateKgPerWeek / current.value) * 100 : null,
    weighIns: window.length,
    from,
    to: today,
  };
}

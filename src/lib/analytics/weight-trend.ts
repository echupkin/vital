// ── The weight trend ────────────────────────────────────
//
// One definition of "the weight trend", used everywhere the app shows a rate of
// weight change: the Body pages' pace, the energy balance and the Routine
// recovery indicator. It is a least-squares line through the last 28 days of
// weigh-ins, with each weigh-in counted by its age: a half-life of 14 days, so
// today's counts 1×, two weeks ago ½× and four weeks ago ¼×.
//
// Why weighted: an equal-weight slope over four weeks is slow to show a change
// of pace. Why a half-life as long as 14 days: daily weigh-ins swing with
// water, salt and timing, and a shorter half-life lets one day move the rate
// noticeably. At 14 days one +1.5 kg weigh-in moves the rate about 0.12 kg a
// week (0.08 unweighted), while a stall shows about a fifth sooner.
//
// Pages name it plainly — "weight trend", over the window below — without
// explaining the weighting. The window's wording lives here so every page says
// the same thing.

import { diffDays } from './windows';
import { weightedSlope } from './stats';

/** Days of weigh-ins the trend is fitted over. */
export const WEIGHT_TREND_DAYS = 28;
/** Age, in days, at which a weigh-in counts half as much as today's. */
export const WEIGHT_TREND_HALF_LIFE_DAYS = 14;

/** The trend's window, for hints and "over the …" phrases. */
export const WEIGHT_TREND_WINDOW = `last ${WEIGHT_TREND_DAYS} days`;

/** How much each point counts, by its age on `today`. */
export function trendWeights(points: { key: string }[], today: string): number[] {
  return points.map(p => 2 ** (-Math.max(0, diffDays(p.key, today)) / WEIGHT_TREND_HALF_LIFE_DAYS));
}

/**
 * The weight trend in kg/day from weigh-ins already limited to the window
 * ending `today`. Null with fewer than `minPoints` weigh-ins.
 */
export function weightTrendSlope(points: { key: string; value: number }[], today: string, minPoints = 4): number | null {
  return weightedSlope(points, trendWeights(points, today), minPoints);
}

// ── Body goal: the evidence-based numbers in one place ──
//
// Every threshold the goal engine uses, with where it comes from. They are
// population guidelines, not prescriptions: the pages say so, and the reader can
// set their own pace over the recommended one.

import { WEIGHT_TREND_DAYS } from '../analytics/weight-trend';

/** Energy in one kg of body-weight change (the usual 3,500 kcal/lb). */
export const KCAL_PER_KG = 7700;

/** Days the weight trend and the energy balance are measured over (see analytics/weight-trend). */
export const TREND_DAYS = WEIGHT_TREND_DAYS;
/** The shorter, more recent trend shown beside it. */
export const RECENT_TREND_DAYS = 14;
/** Days averaged for "current" weight and body fat (a 7-day mean smooths water swings). */
export const CURRENT_DAYS = 7;
/** Days either side of the goal's start day searched for a starting reading. */
export const START_SEARCH_DAYS = 7;

/** A logged day below this share of the window's median calories is treated as a partial log. */
export const PARTIAL_LOG_SHARE = 0.6;
/** Minimum complete logged days and weigh-ins before maintenance is estimated from them. */
export const MIN_ENERGY_LOGGED_DAYS = 10;
export const MIN_ENERGY_WEIGH_INS = 4;
/** Minimum days with both basal and active energy before the device estimate is shown. */
export const MIN_DEVICE_DAYS = 7;
/** Weight-based and device maintenance estimates "agree" within this many kcal/day. */
export const ENERGY_AGREEMENT_KCAL = 250;

/** Within this distance of the target the goal is reached and the guidance turns to maintenance. */
export const AT_GOAL_WEIGHT_SHARE = 0.01; // ±1 % of body weight
export const AT_GOAL_BODY_FAT_POINTS = 0.5;
/**
 * A weight trend smaller than this (% of body weight a week, either way) is
 * holding steady: without a goal it reads as maintaining, and at a goal it is
 * inside the maintenance range.
 */
export const STEADY_PCT = 0.25;

/**
 * Recommended pace, % of body weight per week.
 *
 * Cutting: leaner people lose more lean mass at a given rate, so the band
 * narrows as body fat falls (Helms et al. 2014; Garthe et al. 2011: ~0.5–1 %
 * BW/week preserves lean mass in trained, lean people).
 * Bulking: past ~0.25–0.5 % BW/week most of the extra is fat in trained people
 * (Iraki et al. 2019).
 */
export const CUT_BANDS = {
  lean: { min: 0.5, max: 0.75 },
  moderate: { min: 0.5, max: 1.0 },
  higher: { min: 0.75, max: 1.0 },
  unknown: { min: 0.5, max: 1.0 },
} as const;
export const BULK_BAND = { min: 0.25, max: 0.5 } as const;

/**
 * Body-fat % below which a person counts as "lean", and above which "higher",
 * by sex. Used only when sex is set in Settings: without it no sex's bands are
 * assumed and the general cutting range applies.
 */
export const BODY_FAT_BANDS = {
  male: { lean: 15, higher: 25 },
  female: { lean: 23, higher: 32 },
} as const;

/**
 * Low body-fat targets, by sex. Essential fat is the minimum the body needs
 * (about 2–5 % in men, 10–13 % in women; American Council on Exercise);
 * "very lean" is the bottom of the athletic range, below which body fat is
 * contest-level — hard to hold and costly to energy, hormones and recovery.
 */
export const LOW_BODY_FAT = {
  male: { essential: 5, veryLean: 8 },
  female: { essential: 13, veryLean: 15 },
} as const;

/** Rates above which the page says the pace carries extra cost. */
export const CUT_RISK_PCT = 1.0;
export const BULK_RISK_PCT = 0.5;

/**
 * Protein, g per kg of body weight per day (Morton et al. 2018; Helms et al.
 * 2014: up to ~2.2 g/kg is useful in a deficit).
 */
export const PROTEIN_G_PER_KG = {
  cut: { min: 1.6, max: 2.2 },
  bulk: { min: 1.6, max: 2.0 },
  maintain: { min: 1.6, max: 2.0 },
} as const;

/** Fat floor for hormone health, g per kg of body weight. */
export const FAT_FLOOR_G_PER_KG = 0.6;
/** Typical share of calories from fat when it is not pushed to the floor. */
export const FAT_TYPICAL_SHARE = 0.25;
/** Fiber, g per 1,000 kcal eaten (Dietary Guidelines for Americans). */
export const FIBER_G_PER_1000_KCAL = 14;

/** Half-width of the calorie target range. */
export const CALORIE_RANGE_HALF = 75;
/**
 * Half-width of the wider "OK" calorie range, as a share of the target's
 * middle. A day's intake swings and food logs are commonly off by 10 % or
 * more, so a day within this of the target is fine; the weekly average is
 * what moves the trend.
 */
export const CALORIE_OK_SHARE = 0.1;
/** The "OK" protein floor, as a share of the target floor. */
export const PROTEIN_OK_SHARE = 0.85;

/** Share of a weight change assumed to be lean mass in the "realistic" composition scenario. */
export const REALISTIC_LEAN_SHARE = { cut: 0.2, bulk: 0.4 } as const;
/** Share assumed in the "ideal" scenario. */
export const IDEAL_LEAN_SHARE = { cut: 0, bulk: 0.6 } as const;
/** A change smaller than this (kg) is too small to measure a lean share from. */
export const MIN_CHANGE_FOR_SHARE_KG = 1.5;

/** Macro energy, kcal per g. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;
/** A day whose macros and calories disagree by more than this is flagged. */
export const MACRO_MISMATCH_KCAL = 150;
/** Share of checked days that must be flagged before the derived fat replaces the reported fat. */
export const DERIVED_FAT_SHARE = 0.3;

/** How long until the trend is re-checked and the calorie target adjusted. */
export const CHECK_IN_WEEKS = 2;
export const CHECK_IN_ADJUST_KCAL = { min: 150, max: 200 } as const;

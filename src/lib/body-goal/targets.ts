// ── Body goal: calorie and macro targets ────────────────
//
// Calories come from maintenance plus the effective pace in energy. Protein is
// set per kg of body weight (higher in a deficit), fat has a floor for hormone
// health, fiber scales with what is eaten, and carbs take the rest. Every
// target is a range: the numbers are guides for a two-week check-in, not a
// prescription to the gram.

import {
  CALORIE_OK_SHARE,
  CALORIE_RANGE_HALF,
  CHECK_IN_ADJUST_KCAL,
  CHECK_IN_WEEKS,
  FAT_FLOOR_G_PER_KG,
  FAT_TYPICAL_SHARE,
  FIBER_G_PER_1000_KCAL,
  KCAL_PER_G,
  KCAL_PER_KG,
  PROTEIN_G_PER_KG,
  PROTEIN_OK_SHARE,
} from './constants';
import type { GoalPhase } from './phase';

export interface Range {
  min: number;
  max: number;
}

export interface NutritionTargets {
  /** kcal/day, or null without a maintenance estimate. */
  calories: Range | null;
  /** A wider range around the calorie target that is still fine on a given day. */
  caloriesOk: Range | null;
  /** The daily energy difference the pace asks for (negative = deficit). */
  dailyEnergyDelta: number;
  protein: Range;
  /** g per kg of lean mass at the protein range, when lean mass is known. */
  proteinPerLeanKg: Range | null;
  /** The lowest protein worth hitting every day: the bottom of the range. */
  proteinFloor: number;
  /** Below the floor but still fine on a given day: at least this much. */
  proteinOkFloor: number;
  fatFloor: number;
  /** A typical fat intake once calories allow it. */
  fat: Range | null;
  carbs: Range | null;
  fiber: Range | null;
  checkIn: string;
}

function round(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export function nutritionTargets(input: {
  phase: GoalPhase;
  maintenance: number | null;
  paceKgPerWeek: number;
  weightKg: number;
  leanKg: number | null;
}): NutritionTargets {
  const { phase, maintenance, paceKgPerWeek, weightKg, leanKg } = input;
  const dailyEnergyDelta = (paceKgPerWeek * KCAL_PER_KG) / 7;
  const perKg = PROTEIN_G_PER_KG[phase];
  const protein = { min: round(perKg.min * weightKg, 5), max: round(perKg.max * weightKg, 5) };
  const fatFloor = round(FAT_FLOOR_G_PER_KG * weightKg, 5);

  let calories: Range | null = null;
  let caloriesOk: Range | null = null;
  let fat: Range | null = null;
  let carbs: Range | null = null;
  let fiber: Range | null = null;
  if (maintenance !== null) {
    const mid = maintenance + dailyEnergyDelta;
    calories = { min: round(mid - CALORIE_RANGE_HALF, 25), max: round(mid + CALORIE_RANGE_HALF, 25) };
    const okHalf = Math.max(CALORIE_RANGE_HALF * 2, CALORIE_OK_SHARE * mid);
    caloriesOk = { min: round(mid - okHalf, 25), max: round(mid + okHalf, 25) };
    const fatTypical = Math.max(fatFloor, (FAT_TYPICAL_SHARE * mid) / KCAL_PER_G.fat);
    fat = { min: fatFloor, max: round(Math.max(fatFloor, fatTypical * 1.15), 5) };
    const proteinMid = (protein.min + protein.max) / 2;
    // Carbs are what is left: the high end with fat at its floor, the low end
    // with fat at its typical share.
    const left = (kcal: number, fatG: number) => (kcal - KCAL_PER_G.protein * proteinMid - KCAL_PER_G.fat * fatG) / KCAL_PER_G.carbs;
    const lo = Math.max(0, left(calories.min, fat.max));
    const hi = Math.max(lo, left(calories.max, fat.min));
    carbs = { min: round(lo, 10), max: round(hi, 10) };
    fiber = { min: round((calories.min / 1000) * FIBER_G_PER_1000_KCAL, 1), max: round((calories.max / 1000) * FIBER_G_PER_1000_KCAL, 1) };
  }

  return {
    calories,
    caloriesOk,
    dailyEnergyDelta,
    protein,
    proteinPerLeanKg: leanKg ? { min: protein.min / leanKg, max: protein.max / leanKg } : null,
    proteinFloor: protein.min,
    proteinOkFloor: round(PROTEIN_OK_SHARE * protein.min, 5),
    fatFloor,
    fat,
    carbs,
    fiber,
    checkIn:
      phase === 'maintain'
        ? `Re-check the weight trend every ${CHECK_IN_WEEKS} weeks; if it drifts more than a quarter of a percent a week, adjust by ${CHECK_IN_ADJUST_KCAL.min}–${CHECK_IN_ADJUST_KCAL.max} kcal.`
        : `Re-check the weight trend in ${CHECK_IN_WEEKS} weeks. If it is outside the pace you chose, adjust by ${CHECK_IN_ADJUST_KCAL.min}–${CHECK_IN_ADJUST_KCAL.max} kcal a day.`,
  };
}

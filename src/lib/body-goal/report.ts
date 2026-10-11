// ── Body goal: the whole picture in one report ──────────
//
// One pure function turns a goal and the health series into everything the
// Body and Nutrition pages, the Overview tile, the briefing and the analyst
// show, so no two surfaces can disagree about the numbers. It starts from the
// goal-free reading (reading.ts) and adds the goal: progress, pace, targets
// and arrival dates.
//
// The engine works in canonical units (kg, %, kcal, g); `system` only shapes
// the sentences it writes. It runs in the browser on the active dataset and on
// the server on the same dataset (see `inputsFromDataset`).

import {
  goalWeightScenarios,
  maintenanceRange,
  observedLeanShare,
  projectedBodyFat,
  realisticShare,
  type GoalWeightScenario,
  type LeanShare,
  type MaintenanceRange,
} from './composition';
import { activityComparison, leanEffect, rateEffect } from './effects';
import { adherence, monthlyIntake, type Adherence } from './intake';
import { effectivePace, recommendedBand, trendFit, type EffectivePace, type PaceBand, type TrendFit } from './pace';
import { goalPhase, type PhaseResult } from './phase';
import { projectArrival, type Projection } from './projection';
import { bodyReading, formatKg, formatSignedKg, type BodyGoalInputs, type BodyReading } from './reading';
import { nutritionTargets, type NutritionTargets } from './targets';
import { goalTrack, type GoalTrack } from './track';
import { readingNear, type Reading } from './trend';
import type { BodyGoal } from './types';

export { formatKg, formatSignedKg, type BodyGoalInputs };

export interface BodyGoalReport extends BodyReading {
  goal: BodyGoal;
  /** The day progress is measured from: the goal's start, or today when the data ends earlier. */
  anchor: string;
  phase: PhaseResult;
  start: { weight: Reading | null; bodyFat: Reading | null; value: number | null };
  /** 0–1 of the way from the start to the target, in the goal's unit. Data for the briefing; the pages show `track`. */
  progress: number | null;
  /** Whether the weight trend is moving the right way at a sensible pace. */
  track: GoalTrack;
  band: PaceBand | null;
  pace: EffectivePace | null;
  fit: TrendFit;
  targets: NutritionTargets | null;
  /** The weight the goal lands at: the target itself, or the realistic scenario for a body-fat goal. */
  goalWeightKg: number | null;
  scenarios: GoalWeightScenario[];
  /** For a weight goal with body-fat data: body fat at the goal weight, realistic share. */
  bodyFatAtGoal: number | null;
  projection: Projection | null;
  /** At the goal: the weights that count as holding it. */
  maintenance: MaintenanceRange | null;
  /** The lean share since the goal started, when weight moved the goal's way. */
  leanShare: LeanShare | null;
  adherence: Adherence | null;
}

export function bodyGoalReport(goal: BodyGoal, inputs: BodyGoalInputs): BodyGoalReport {
  const { series, workoutDays, today, sex, system } = inputs;
  const reading = bodyReading(inputs);
  const { weight, composition, energy } = reading;
  const anchor = goal.startedOn <= today ? goal.startedOn : today;
  const phase = goalPhase(goal, weight.current, composition.bodyFat);

  const startWeight = readingNear(series('weight_body_mass'), anchor);
  const startBodyFat = readingNear(series('body_fat_percentage'), anchor);
  const startValue = goal.kind === 'weight' ? startWeight?.value ?? null : startBodyFat?.value ?? null;
  let progress: number | null = null;
  if (startValue !== null && phase.current !== null && Math.abs(startValue - goal.target) > 1e-6) {
    progress = Math.min(1, Math.max(0, (startValue - phase.current) / (startValue - goal.target)));
  }
  if (phase.phase === 'maintain') progress = 1;

  const weightKg = weight.current?.value ?? null;
  // The lean share of a change only says something about this goal when weight
  // moved the goal's way: the share measured while gaining says nothing about a cut.
  const observed = observedLeanShare(series, anchor, today);
  const goalDirection = phase.phase === 'cut' ? -1 : phase.phase === 'bulk' ? 1 : 0;
  const leanShare = observed && Math.sign(observed.weightChangeKg) === goalDirection ? observed : null;
  // Activity is compared with the weeks before the goal, not the weeks before now.
  const activity = activityComparison(series, workoutDays, anchor, today);
  const base = {
    ...reading,
    goal, anchor, phase,
    start: { weight: startWeight, bodyFat: startBodyFat, value: startValue },
    progress, leanShare,
  };

  if (!phase.phase || weightKg === null) {
    return {
      ...base,
      band: null, pace: null, fit: 'unknown', track: goalTrack(null, 'unknown', null), targets: null,
      goalWeightKg: goal.kind === 'weight' ? goal.target : null,
      scenarios: [], bodyFatAtGoal: null, projection: null, maintenance: null,
      effects: { ...reading.effects, rate: null, lean: null, recovery: [], activity },
      adherence: null,
    };
  }

  const band = recommendedBand(phase.phase, composition.bodyFat?.value ?? null, sex);
  const pace = effectivePace(phase.phase, band, weightKg, goal.paceKgPerWeek);
  const fit = trendFit(phase.phase, band, weight.ratePct);
  const targets = nutritionTargets({ phase: phase.phase, maintenance: energy.maintenance, paceKgPerWeek: pace.kgPerWeek, weightKg, leanKg: composition.leanKg });

  let scenarios: GoalWeightScenario[] = [];
  let goalWeightKg: number | null = null;
  let bodyFatAtGoal: number | null = null;
  if (goal.kind === 'body_fat') {
    if (composition.fatKg !== null) {
      scenarios = goalWeightScenarios({ phase: phase.phase, weightKg, fatKg: composition.fatKg, targetPct: goal.target, observed: leanShare });
      goalWeightKg = phase.phase === 'maintain' ? weightKg : scenarios.find(s => s.id === 'realistic')?.goalWeightKg ?? null;
    }
  } else {
    goalWeightKg = goal.target;
    if (composition.fatKg !== null && phase.phase !== 'maintain') {
      bodyFatAtGoal = projectedBodyFat(weightKg, composition.fatKg, goal.target, realisticShare(phase.phase));
    }
  }

  const rateText = (kgPerWeek: number) => `${formatSignedKg(kgPerWeek, system)}/week`;
  const projection =
    goalWeightKg !== null
      ? projectArrival({
          phase: phase.phase,
          remainingKg: goalWeightKg - weightKg,
          weightKg,
          band,
          pace,
          trendKgPerWeek: weight.rateKgPerWeek,
          today,
          formatRate: rateText,
        })
      : null;

  return {
    ...base,
    band,
    pace,
    fit,
    track: goalTrack(phase.phase, fit, weight.ratePct),
    targets,
    goalWeightKg,
    scenarios,
    bodyFatAtGoal,
    projection,
    maintenance: phase.phase === 'maintain' ? maintenanceRange(goal, weightKg, composition.leanKg) : null,
    effects: {
      ...reading.effects,
      rate: rateEffect(phase.phase, weight.ratePct, weight.rateKgPerWeek === null ? null : formatKg(Math.abs(weight.rateKgPerWeek), system)),
      lean: leanEffect(phase.phase, leanShare, kg => formatSignedKg(kg, system)),
      activity,
    },
    months: monthlyIntake(series, today, { months: 6, proteinFloor: targets.proteinFloor }),
    adherence: adherence(series, today, targets),
  };
}

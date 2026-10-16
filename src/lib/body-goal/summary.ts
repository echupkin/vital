// ── Body goal: the compact summary for the briefing and analyst ─
//
// The same report the Body page shows, cut down to plain numbers in the
// reader's units. It is DATA for a model: it says where the reader is against
// their goal and what the numbers imply, and carries no instructions.

import { convertValue, displayUnit } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import { PHASE_LABEL } from './phase';
import type { BodyGoalReport } from './report';

function r(n: number | null | undefined, digits = 1): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export interface BodyGoalSummary {
  goal: string;
  setOn: string;
  phase: string | null;
  phaseNote: string | null;
  weightUnit: string;
  current: { weight: number | null; bodyFatPct: number | null; leanMass: number | null };
  start: { weight: number | null; bodyFatPct: number | null };
  progressPct: number | null;
  /** `perWeek` is the weight trend; `lastTwoWeeksPerWeek` is a plain slope over 14 days. */
  trend: { perWeek: number | null; pctBodyWeightPerWeek: number | null; lastTwoWeeksPerWeek: number | null; weighIns: number; comparedWithRecommended: string };
  recommendedPacePctPerWeek: { min: number; max: number } | null;
  paceInUse: { perWeek: number; pctBodyWeightPerWeek: number; source: string } | null;
  goalWeight: number | null;
  arrivalAtPaceInUse: { weeks: number; date: string } | null;
  trendNote: string | null;
  maintenanceKcal: { fromWeightTrend: number | null; fromDevice: number | null; used: number | null; agreement: string | null };
  /** Food logging in the last four weeks. Zero logged days is normal: most people do not log food. */
  foodLog: { loggedDays: number; completeDays: number; note: string | null };
  intakeKcalPerDay: number | null;
  balanceKcalPerDay: number | null;
  /** The deficit (negative) or surplus per day the weight trend implies on its own. */
  balanceFromWeightTrendKcalPerDay: number | null;
  targets: { kcal: [number, number] | null; kcalOk: [number, number] | null; proteinG: [number, number]; proteinOkMinG: number; fatFloorG: number; carbsG: [number, number] | null; fiberG: [number, number] | null; checkIn: string } | null;
  flags: string[];
  /** Whether logged macros add up to logged calories; null when nothing is logged to check. */
  logConsistency: string | null;
}

export function bodyGoalSummary(report: BodyGoalReport, system: UnitSystem): BodyGoalSummary {
  const w = (kg: number | null | undefined) => (kg === null || kg === undefined ? null : r(convertValue(kg, 'kg', system), 1));
  const unit = displayUnit('kg', system);
  const { goal, phase, weight, composition, energy, targets, projection, pace, band } = report;
  const flags: string[] = [];
  for (const item of [report.effects.rate, report.effects.lean]) if (item && item.status === 'watch') flags.push(item.text);
  for (const i of report.effects.recovery) if (i.status === 'watch' || i.status === 'warn') flags.push(i.text);

  return {
    goal: goal.kind === 'weight' ? `Reach ${w(goal.target)} ${unit} body weight` : `Reach ${r(goal.target)} % body fat`,
    setOn: goal.startedOn,
    phase: phase.phase ? PHASE_LABEL[phase.phase] : null,
    phaseNote: phase.reason,
    weightUnit: unit,
    current: { weight: w(weight.current?.value), bodyFatPct: r(composition.bodyFat?.value), leanMass: w(composition.leanKg) },
    start: { weight: w(report.start.weight?.value), bodyFatPct: r(report.start.bodyFat?.value) },
    progressPct: report.progress === null ? null : Math.round(report.progress * 100),
    trend: {
      perWeek: w(weight.rateKgPerWeek),
      pctBodyWeightPerWeek: r(weight.ratePct, 2),
      lastTwoWeeksPerWeek: w(weight.recentRateKgPerWeek),
      weighIns: weight.weighIns,
      comparedWithRecommended: report.fit,
    },
    recommendedPacePctPerWeek: band && phase.phase !== 'maintain' ? { min: band.minPct, max: band.maxPct } : null,
    paceInUse: pace ? { perWeek: w(pace.kgPerWeek)!, pctBodyWeightPerWeek: r(pace.pct, 2)!, source: pace.source } : null,
    goalWeight: w(report.goalWeightKg),
    arrivalAtPaceInUse: projection?.chosen ? { weeks: r(projection.chosen.weeks, 1)!, date: projection.chosen.arrival } : null,
    trendNote: projection?.trendNote ?? null,
    maintenanceKcal: { fromWeightTrend: r(energy.adaptive, 0), fromDevice: r(energy.device, 0), used: r(energy.maintenance, 0), agreement: energy.agreementText },
    foodLog: {
      loggedDays: energy.days.logged.length,
      completeDays: energy.days.complete.length,
      note: energy.foodLogged
        ? null
        : 'No food is logged. That is normal and not a problem: the goal is read from weigh-ins, and the calorie target (when present) comes from the device estimate of maintenance.',
    },
    intakeKcalPerDay: r(energy.intake, 0),
    balanceKcalPerDay: r(energy.balance, 0),
    balanceFromWeightTrendKcalPerDay: r(energy.trendBalance, 0),
    targets: targets
      ? {
          kcal: targets.calories ? [targets.calories.min, targets.calories.max] : null,
          kcalOk: targets.caloriesOk ? [targets.caloriesOk.min, targets.caloriesOk.max] : null,
          proteinG: [targets.protein.min, targets.protein.max],
          proteinOkMinG: targets.proteinOkFloor,
          fatFloorG: targets.fatFloor,
          carbsG: targets.carbs ? [targets.carbs.min, targets.carbs.max] : null,
          fiberG: targets.fiber ? [targets.fiber.min, targets.fiber.max] : null,
          checkIn: targets.checkIn,
        }
      : null,
    flags,
    logConsistency: report.consistency.checked > 0 ? report.consistency.summary : null,
  };
}

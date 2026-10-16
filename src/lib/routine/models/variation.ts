// ── Variation model: double progression, then a harder variation ──
//
// The stage's marker is a set count and a range (reps, hold time, distance).
// Build within the range until the working sets sit at the top of it, with the
// effort still inside the target, for enough sessions — then move to the next
// variation and build back up from the bottom of its range.
//
// A session QUALIFIES when it has at least the minimum number of working sets,
// every one of them reaches the bottom of the range, their total is within one
// "step" of every set at the top (so 12/12/10 counts for 8–12, 12/11/9 does not),
// and no set went past the effort ceiling.
//
// For reps, a set past the ceiling still counts, a rep short for each RPE point
// over it (RPE is about 10 minus reps in reserve): 12 at RPE 9.5 against a
// ceiling of 9 is judged as 11.5 at 9, the same work stopped half a rep earlier.
//
// This covers bodyweight skill paths, holds, negatives, per-side work, a long
// run that grows by distance, and assisted work (where less assistance is the
// progress — see the load suffix and the "Reduce assistance" advice).

import { easedKey } from '../deload';
import { doseText, rangeText, weightText } from '../format';
import type { PerformanceRecord } from '../records';
import type { UnitSystem } from '../../prefs';
import type { Dose, PlanRules, Stage } from '../types';
import {
  effortFactor,
  effortText,
  fallingStreak,
  headlineOf,
  loadSuffix,
  mergeRows,
  quantityFor,
  readinessLabel,
  readinessProgress,
  rpesOf,
  sumOf,
  targetRange,
  topRpe,
  trendSignal,
  valuesOf,
  valuesText,
  type Quantity,
} from './shared';
import { DELOAD_SIGNAL, easedIn, qualifyingRange, rpeCeiling, type EvaluationContext, type ModelEvaluation, type ProgressRow, type ProgressionModel } from './types';

interface SessionJudgement {
  record: PerformanceRecord;
  values: number[];
  total: number;
  inRange: boolean;
  nearTop: boolean;
  effortHigh: boolean;
  qualifies: boolean;
  /** 0–1 toward the marker's volume, or null when the dose has no range. */
  performance: number | null;
  /** 0–1: how well effort stayed inside the ceiling. */
  effort: number;
}

function slack(range: [number, number]): number {
  return Math.max(1, Math.round((range[1] - range[0]) * 0.2));
}

export function judge(record: PerformanceRecord, target: Dose | undefined, q: Quantity, ceiling: number | null): SessionJudgement {
  const values = valuesOf(record, q);
  const total = sumOf(values);
  const range = targetRange(target, q);
  const minSets = target?.sets?.[0] ?? 1;
  const counted = values.slice(0, Math.max(minSets, 1));
  const enoughSets = values.length >= minSets;
  const inRange = Boolean(range) && enoughSets && counted.every(v => v >= range![0]);
  const reachesTop = (vs: number[]) => Boolean(range) && enoughSets && vs.every(v => v >= range![0]) && sumOf(vs) >= vs.length * (range![1] - slack(range!));
  const nearTop = reachesTop(counted);
  const rpes = rpesOf(record);
  const effortHigh = ceiling !== null && rpes.some(r => r > ceiling);
  const qualifies = effortHigh && q === 'reps' ? reachesTop(creditedReps(record, ceiling!).slice(0, counted.length)) : nearTop && !effortHigh;
  // Each counted set earns up to the top of the range; the marker's total is full marks.
  const sets = Math.max(minSets, 1);
  const performance = range
    ? Math.min(inRange ? 1 : 0.95, sumOf(values.slice(0, sets).map(v => Math.min(v, range[1]))) / (sets * (range[1] - slack(range))))
    : null;
  return { record, values, total, inRange, nearTop, effortHigh, qualifies, performance, effort: effortFactor(topRpe(record), ceiling) };
}

/** Each set's reps, less one per RPE point the set went past the ceiling. */
function creditedReps(record: PerformanceRecord, ceiling: number): number[] {
  return record.sets.filter(s => s.reps !== undefined).map(s => s.reps! - Math.max(0, (s.rpe ?? 0) - ceiling));
}

function rowFor(
  j: SessionJudgement,
  stageName: string,
  stageId: string,
  q: Quantity,
  ctx: EvaluationContext
): ProgressRow {
  return {
    dates: [j.record.date],
    sessionIds: [j.record.sessionId],
    stageId,
    work: `${stageName} ${valuesText(j.values, q, ctx.system)}${loadSuffix(j.record, ctx.system)}`,
    headline: headlineOf(j.values, q, ctx.system),
    effort: effortText(j.record),
    signal: '',
    ...(j.record.notes ? { notes: j.record.notes } : {}),
  };
}

/** The dose the current stage (or step) is measured against. */
export function stageTarget(ctx: EvaluationContext): Dose | undefined {
  const step = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex] : undefined;
  return step?.advanceWhen ?? ctx.stage.advanceWhen ?? ctx.stage.prescription;
}

export const variationModel: ProgressionModel = {
  id: 'variation',
  evaluate(ctx: EvaluationContext): ModelEvaluation {
    const target = stageTarget(ctx);
    const ceiling = rpeCeiling(target, ctx.rules);
    const q = quantityFor(target, ctx.records);
    const range = targetRange(target, q);
    const qualifying = qualifyingRange(ctx.stage, ctx.rules);
    const judged = ctx.records.map(r => judge(r, target, q, ceiling));
    // Deload sessions keep their row but neither count toward the marker nor against it.
    const eased = easedIn(ctx);
    const active = judged.filter(j => !eased(j.record));

    // ── Rows: the previous stage's last sessions, then this stage ──
    const rows: (ProgressRow & { keep?: boolean })[] = [];
    if (ctx.previousStage && ctx.previousRecords.length) {
      const prevTarget = ctx.previousStage.advanceWhen ?? ctx.previousStage.prescription;
      const prevQ = quantityFor(prevTarget, ctx.previousRecords);
      const prev = ctx.previousRecords.map(r => judge(r, prevTarget, prevQ, rpeCeiling(prevTarget, ctx.rules)));
      let best = 0;
      let before: number | null = null;
      prev.forEach((j, i) => {
        // Deload sessions of the previous stage are labelled as such and left out of its trend.
        const easedPrev = ctx.eased.has(easedKey(ctx.previousStage!.id, j.record.sessionId));
        const signal =
          i === prev.length - 1
            ? `Final ${ctx.previousStage!.name.toLowerCase()} session before progression`
            : easedPrev
              ? DELOAD_SIGNAL
              : trendSignal(j.total, before, best);
        if (!easedPrev) {
          best = Math.max(best, j.total);
          before = j.total;
        }
        if (i >= prev.length - 3) {
          rows.push({ ...rowFor(j, ctx.previousStage!.name, ctx.previousStage!.id, prevQ, ctx), signal, keep: i === prev.length - 1 });
        }
      });
    }
    let best = 0;
    let prev: SessionJudgement | null = null;
    judged.forEach(j => {
      if (eased(j.record)) {
        rows.push({ ...rowFor(j, ctx.stage.name, ctx.stage.id, q, ctx), signal: DELOAD_SIGNAL });
        return;
      }
      let signal: string;
      const prevLoad = prev ? prev.record.totals.topWeightKg : null;
      const load = j.record.totals.topWeightKg;
      const lessHelp = j.record.loadMeaning === 'assistance' && prev !== null && prevLoad !== null && load !== null && load < prevLoad && j.total >= prev.total;
      const moreLoad = j.record.loadMeaning === 'added' && prev !== null && prevLoad !== null && load !== null && load > prevLoad && j.total >= prev.total;
      if (!prev) signal = j.inRange && !j.effortHigh ? `Clean ${ctx.stage.name.toLowerCase()} entry` : `${ctx.stage.name} entry`;
      else if (j.qualifies) signal = 'Meets the progression marker';
      else if (j.nearTop && j.effortHigh) signal = 'Near top of range, effort high';
      else if (lessHelp) signal = 'Same reps with less assistance';
      else if (moreLoad) signal = 'Same reps with more load';
      else signal = trendSignal(j.total, prev.total, best);
      best = Math.max(best, j.total);
      prev = j;
      rows.push({ ...rowFor(j, ctx.stage.name, ctx.stage.id, q, ctx), signal });
    });

    const last = active[active.length - 1];
    const recent = active.slice(-qualifying[1]);
    const q2 = recent.filter(j => j.qualifies).length;
    const readiness = {
      qualifying: q2,
      needed: qualifying[0],
      met: q2 >= qualifying[0],
      progress: range
        ? Math.max(0, ...recent.map(j => readinessProgress(j.performance ?? 0, j.effort, q2, qualifying[0])))
        : Math.min(1, q2 / Math.max(1, qualifying[0])),
      label: readinessLabel(q2, qualifying, 'sessions'),
      unit: 'sessions' as const,
    };

    const targetText = doseText(target, ctx.system);
    const facts: ModelEvaluation['facts'] = { stage: ctx.stage.name, target: targetText, qualifying: q2, needed: qualifying[0] };
    if (!last) {
      return {
        rows: mergeRows(rows),
        light: 'none',
        reasons: [judged.length ? `Only deload sessions of ${ctx.stage.name.toLowerCase()} so far; the next full session is judged.` : `No ${ctx.stage.name.toLowerCase()} sessions logged yet.`],
        readiness,
        nextAction: `Start ${ctx.stage.name.toLowerCase()} at ${doseText(ctx.stage.prescription ?? target, ctx.system) || 'an easy, controlled volume'}.`,
        target,
        facts,
      };
    }
    facts.lastWork = valuesText(last.values, q, ctx.system);
    facts.lastTotal = last.total;
    const lastEffort = effortText(last.record);
    if (lastEffort) facts.lastEffort = lastEffort;

    const reasons: string[] = [];
    const sets = target?.sets ? rangeText([target.sets[0], target.sets[0]]) : String(last.values.length);
    const topBand = range ? `${rangeText([Math.max(range[0], range[1] - Math.max(1, Math.round((range[1] - range[0]) / 2))), range[1]])}${q === 'durationS' ? ' s' : ''}` : '';
    const qualText = rangeText(qualifying);
    const step = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex] : undefined;
    const nextStep = ctx.path.currentStepIndex !== undefined ? ctx.stage.steps?.[ctx.path.currentStepIndex + 1] : undefined;

    let light: ModelEvaluation['light'];
    let nextAction: string;
    if (fallingStreak(active.map(j => j.total))) {
      light = 'red';
      reasons.push('Performance fell in each of the last two sessions.');
      nextAction = `Hold ${ctx.stage.name.toLowerCase()} and drop a set until the numbers recover; check sleep, soreness and joints before pushing again.`;
    } else if (readiness.met) {
      light = 'green';
      reasons.push(
        recent.some(j => j.qualifies && j.effortHigh)
          ? `The marker (${targetText}) was met in ${q2} of the last ${recent.length} sessions, counting a set a rep short for each RPE point past ${ceiling}.`
          : `The marker (${targetText}) was met in ${q2} of the last ${recent.length} sessions with effort inside the target.`
      );
      if (nextStep) nextAction = `Move on to ${nextStep.name.toLowerCase()} within ${ctx.stage.name.toLowerCase()}.`;
      else if (ctx.nextStage) nextAction = `Move to ${ctx.nextStage.name.toLowerCase()}: start at ${doseText(ctx.nextStage.prescription ?? ctx.nextStage.advanceWhen, ctx.system) || 'the bottom of its range'} and build back up.`;
      else nextAction = `This is the last stage of the path: keep ${ctx.stage.name.toLowerCase()} at ${targetText}, or add a harder stage.`;
    } else if (last.nearTop && last.effortHigh && !last.qualifies) {
      light = 'yellow-green';
      reasons.push(`The latest work (${facts.lastWork}) meets the ${range ? rangeText(range) : ''} range, but effort reached ${lastEffort}, above the RPE ${ceiling} ceiling.`);
      nextAction = `Repeat ${sets}×${topBand} with consistent form and lower perceived effort for ${qualText} sessions. Do not move on while sets are near failure.`;
    } else if (q2 > 0) {
      light = 'yellow-green';
      reasons.push(`${readiness.label}; one more at the marker earns the next ${step ? 'step' : 'stage'}.`);
      nextAction = `Repeat ${targetText} for ${qualifying[0] - q2} more session${qualifying[0] - q2 === 1 ? '' : 's'}.`;
    } else {
      light = 'yellow';
      reasons.push(last.inRange ? `In range (${facts.lastWork}) but not yet at the top of it.` : `Still building toward ${targetText}.`);
      nextAction = range
        ? `Keep adding ${q === 'reps' ? 'reps' : q === 'durationS' ? 'time' : 'distance'} toward ${sets}×${rangeText([range[1], range[1]])}${q === 'durationS' ? ' s' : ''} (last: ${facts.lastWork}).`
        : `Keep building ${ctx.stage.name.toLowerCase()} (last: ${facts.lastWork}).`;
      if (last.record.loadMeaning === 'assistance' && last.record.totals.topWeightKg) {
        nextAction += ` Once every set reaches the top, reduce the assistance (now ${weightText(last.record.totals.topWeightKg, ctx.system)}) and build back up.`;
      }
      if (last.effortHigh) reasons.push(`Effort reached ${lastEffort}, above the RPE ${ceiling} ceiling.`);
    }
    if (last.record.loadMeaning === 'assistance' && light === 'green' && !ctx.nextStage) {
      nextAction = 'Reduce the assistance and build the reps back up.';
    }

    return { rows: mergeRows(rows), light, reasons, readiness, nextAction, target, facts };
  },
};

/**
 * Rows for sessions of a stage the model is not judging — work the reader
 * keeps doing alongside the current stage (negatives next to assisted pull-ups)
 * or tries ahead of it. Each row is judged against its own stage's marker, and
 * `note` says how the stage relates to the current one.
 */
export function stageRows(
  stage: Stage,
  records: PerformanceRecord[],
  rules: PlanRules,
  system: UnitSystem,
  note: (record: PerformanceRecord) => string
): ProgressRow[] {
  const target = stage.advanceWhen ?? stage.prescription;
  const q = quantityFor(target, records);
  const ceiling = rpeCeiling(target, rules);
  let best = 0;
  return records.map((record, i) => {
    const j = judge(record, target, q, ceiling);
    const signal = j.qualifies
      ? 'Meets its marker'
      : trendSignal(j.total, i ? judge(records[i - 1], target, q, ceiling).total : null, best);
    best = Math.max(best, j.total);
    return {
      dates: [record.date],
      sessionIds: [record.sessionId],
      stageId: stage.id,
      work: `${stage.name} ${valuesText(j.values, q, system)}${loadSuffix(record, system)}`,
      headline: headlineOf(j.values, q, system),
      effort: effortText(record),
      signal: `${note(record)} · ${signal.charAt(0).toLowerCase()}${signal.slice(1)}`,
      ...(record.notes ? { notes: record.notes } : {}),
    };
  });
}

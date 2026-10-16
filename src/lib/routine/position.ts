// ── Where the reader is in the plan ─────────────────────
//
//   planWeek        1-based week of the plan for a day (clamped to the plan)
//   planPosition    every calendar block with its position and whether its targets were met
//   phaseViews      the milestones, with the current one worked out from the data
//   deloadStatus    a deload running now, or weeks since the last one against the plan's rule
//
// Target checks use the logged sessions of the target's path: a target counts
// as met when any session from the block's start onward reached its dose.

import { addDays, diffDays, formatDayKeyShort } from '../analytics/windows';
import { DELOAD_DAYS, plannedWindows, windowOn, type DeloadWindow } from './deload';
import type { UnitSystem } from '../prefs';
import { doseText } from './format';
import { judge } from './models/variation';
import { quantityFor } from './models/shared';
import type { PerformanceRecord } from './records';
import type { Block, Path, Phase, TrainingPlan } from './types';

export function planWeek(plan: TrainingPlan, today: string): number {
  const days = diffDays(plan.startDate, today);
  return Math.min(plan.durationWeeks, Math.max(1, Math.floor(days / 7) + 1));
}

export function planStarted(plan: TrainingPlan, today: string): boolean {
  return today >= plan.startDate;
}

export function blockDates(plan: TrainingPlan, block: Block): { from: string; to: string } {
  const from = addDays(plan.startDate, (block.startWeek - 1) * 7);
  return { from, to: addDays(from, block.weeks * 7 - 1) };
}

export function currentBlocks(plan: TrainingPlan, week: number): Block[] {
  return plan.blocks.filter(b => week >= b.startWeek && week < b.startWeek + b.weeks);
}

export interface BlockTargetView {
  label: string;
  pathId?: string;
  dose: string;
  /** null when the target has no dose or no path to check against. */
  met: boolean | null;
}

export interface BlockView {
  id: string;
  name: string;
  kind?: Block['kind'];
  from: string;
  to: string;
  weeks: [number, number];
  goals: string[];
  targets: BlockTargetView[];
  /** Calendar position only: blocks are periods, not milestones (see phases). */
  status: 'past' | 'current' | 'future';
}

export function planPosition(
  plan: TrainingPlan,
  recordsByPath: Map<string, PerformanceRecord[]>,
  today: string,
  system: UnitSystem
): BlockView[] {
  const week = planWeek(plan, today);
  return plan.blocks.map(block => {
    const { from, to } = blockDates(plan, block);
    const targets: BlockTargetView[] = block.targets.map(t => {
      let met: boolean | null = null;
      if (t.dose && t.pathId) {
        const records = (recordsByPath.get(t.pathId) ?? []).filter(r => r.date >= from && r.date <= today);
        const q = quantityFor(t.dose, records);
        met = records.some(r => judge(r, t.dose, q, null).inRange);
      }
      return { label: t.label, ...(t.pathId ? { pathId: t.pathId } : {}), dose: doseText(t.dose, system), met };
    });
    const started = planStarted(plan, today);
    const status: BlockView['status'] =
      !started || week < block.startWeek ? 'future' : week < block.startWeek + block.weeks && today <= to ? 'current' : 'past';
    return {
      id: block.id,
      name: block.name,
      ...(block.kind ? { kind: block.kind } : {}),
      from,
      to,
      weeks: [block.startWeek, block.startWeek + block.weeks - 1],
      goals: block.goals,
      targets,
      status,
    };
  });
}

export interface DeloadStatus {
  /** Days a deload started (blocks already begun, plus logged and detected deloads). */
  lastDeload: string | null;
  weeksSince: number;
  status: 'none' | 'ok' | 'due' | 'overdue' | 'in-deload';
  text: string;
  /** The plan's rule: how often, and how much to cut (fractions). Null without one. */
  rule: { everyWeeks: [number, number]; volumeReduction: [number, number] } | null;
  /** While in a deload: where it came from and its last day. */
  window: DeloadWindow | null;
}

/** `detected`: deload starts read from the sessions (see deload.ts). */
export function deloadStatus(plan: TrainingPlan, today: string, detected: string[] = []): DeloadStatus {
  const rule = plan.rules.deload ?? null;
  const windows = [...plannedWindows(plan), ...detected.map(from => ({ from, to: addDays(from, DELOAD_DAYS - 1), source: 'detected' as const }))];
  const now = windowOn(windows, today);
  if (now) {
    const block = now.source === 'block' ? plan.blocks.find(b => b.kind === 'deload' && blockDates(plan, b).from === now.from) : undefined;
    const text = block
      ? `${block.name} is running this week.`
      : `Deload since ${formatDayKeyShort(now.from)} (${now.source === 'detected' ? 'read from lighter sessions at lower effort' : 'recorded'}); progress resumes after ${formatDayKeyShort(now.to)}.`;
    return { lastDeload: now.from, weeksSince: 0, status: 'in-deload', text, rule, window: now };
  }
  const starts = windows.map(w => w.from).filter(d => d <= today);
  const lastDeload = starts.sort().pop() ?? null;
  const since = Math.floor(diffDays(lastDeload ?? plan.startDate, today) / 7);
  const base = { lastDeload, weeksSince: since, rule, window: null };
  if (!rule) return { ...base, status: 'none', text: 'This plan has no deload rule.' };
  const [lo, hi] = rule.everyWeeks;
  const reduce = `${Math.round(rule.volumeReduction[0] * 100)}–${Math.round(rule.volumeReduction[1] * 100)}%`;
  const since_ = lastDeload ? `since the last deload (${lastDeload})` : 'since the plan started';
  if (since >= hi) return { ...base, status: 'overdue', text: `${since} weeks ${since_}; the plan calls for one every ${lo}–${hi}. Cut sets by ${reduce} for a week.` };
  if (since >= lo) return { ...base, status: 'due', text: `${since} weeks ${since_}: a deload is due (cut sets by ${reduce} for a week), sooner if recovery slips.` };
  return { ...base, status: 'ok', text: `${since} week${since === 1 ? '' : 's'} ${since_}; next due in ${lo - since}–${hi - since} weeks.` };
}

// ── Phases: milestones reached by progress ──────────────

export interface PhaseTargetView {
  label: string;
  pathId?: string;
  optional: boolean;
  /** null when the target cannot be checked against data (no path). */
  met: boolean | null;
  /** When it was first met, when known. */
  metOn: string | null;
  /**
   * What the page shows. `done` only once the stage is mastered or the dose
   * reached; a stage that has begun is `in-progress`, even where beginning it is
   * all the phase asks (`met`). Null when the target cannot be checked.
   */
  state: 'done' | 'in-progress' | 'not-started' | null;
  /** The day it was done, or, in progress, the day it began. */
  stateOn: string | null;
}

export interface PhaseView {
  id: string;
  name: string;
  index: number;
  goals: string[];
  targets: PhaseTargetView[];
  expectedWeeks?: [number, number];
  notes?: string;
  status: 'complete' | 'current' | 'upcoming';
  /** Day the phase's last required target was met. */
  completedOn: string | null;
  /** Day the phase became current (the previous phase's completion), when known. */
  since: string | null;
  /** Required, checkable targets met / total. */
  progress: { met: number; total: number };
}

/** What the phase check needs to know about each path right now. */
export interface PathState {
  path: Path;
  currentIndex: number;
  /** The current stage's marker is met (ready to move on). */
  ready: boolean;
  records: PerformanceRecord[];
  /** The same records, by stage id. */
  byStage: Map<string, PerformanceRecord[]>;
}

function stageIndex(path: Path, stageId: string): number {
  return path.stages.findIndex(s => s.id === stageId);
}

/**
 * Earliest day the path was on `fromIndex` or a later stage: a recorded stage
 * change, or a logged session on one of those stages. Null when neither exists —
 * a path sitting on its first stage with nothing logged has not started it.
 */
function reachedOn(state: PathState, fromIndex: number): string | null {
  const { path } = state;
  const days = [
    ...path.history.filter(h => stageIndex(path, h.stageId) >= fromIndex).map(h => h.startedOn),
    ...path.stages.slice(fromIndex).flatMap(s => (state.byStage.get(s.id) ?? []).slice(0, 1).map(r => r.date)),
  ].sort();
  return days[0] ?? null;
}

type TargetCheck = Pick<PhaseTargetView, 'met' | 'metOn' | 'state' | 'stateOn'>;
const UNCHECKED: TargetCheck = { met: null, metOn: null, state: null, stateOn: null };

function checkTarget(t: Phase['targets'][number], paths: Map<string, PathState>): TargetCheck {
  const state = t.pathId ? paths.get(t.pathId) : undefined;
  if (!state) return UNCHECKED;
  // A dose: reached in any session on the named stage (or on the path, without one).
  if (t.dose) {
    const records = t.stageId ? state.byStage.get(t.stageId) ?? [] : state.records;
    const q = quantityFor(t.dose, records);
    const hit = records.find(r => judge(r, t.dose, q, null).inRange);
    if (hit) return { met: true, metOn: hit.date, state: 'done', stateOn: hit.date };
    return { met: false, metOn: null, ...(records.length ? { state: 'in-progress', stateOn: records[0].date } : { state: 'not-started', stateOn: null }) };
  }
  if (t.stageId) {
    const i = stageIndex(state.path, t.stageId);
    if (i < 0) return UNCHECKED;
    const mastered = state.currentIndex > i || (state.currentIndex === i && state.ready);
    const masteredOn = state.currentIndex > i ? reachedOn(state, i + 1) : mastered ? state.records[state.records.length - 1]?.date ?? null : null;
    const began = state.currentIndex >= i ? reachedOn(state, i) : null;
    const view: Pick<TargetCheck, 'state' | 'stateOn'> = mastered
      ? { state: 'done', stateOn: masteredOn }
      : began
        ? { state: 'in-progress', stateOn: began }
        : { state: 'not-started', stateOn: null };
    if ((t.reach ?? 'mastered') === 'started') return { met: Boolean(began), metOn: began, ...view };
    return { met: mastered, metOn: masteredOn, ...view };
  }
  return UNCHECKED;
}

/**
 * The plan's phases with their status. A phase is complete when every required,
 * checkable target is met; the current phase is the first one that is not.
 * A phase with nothing checkable counts as complete once a later phase shows
 * progress, so an unverifiable milestone never holds the reader back.
 */
export function phaseViews(plan: TrainingPlan, paths: Map<string, PathState>, system: UnitSystem): PhaseView[] {
  const checked = plan.phases.map(phase => {
    const targets: PhaseTargetView[] = phase.targets.map(t => ({
      label: t.label || doseText(t.dose, system),
      ...(t.pathId ? { pathId: t.pathId } : {}),
      optional: Boolean(t.optional),
      ...checkTarget(t, paths),
    }));
    const required = targets.filter(t => !t.optional && t.met !== null);
    const met = required.filter(t => t.met).length;
    const anyProgress = targets.some(t => t.met === true);
    return { phase, targets, required, met, anyProgress };
  });

  const complete = checked.map((c, i) =>
    c.required.length > 0 ? c.met === c.required.length : checked.slice(i + 1).some(later => later.anyProgress)
  );
  const current = complete.findIndex(done => !done);

  let previousDone: string | null = null;
  return checked.map((c, i) => {
    const days = c.required.map(t => t.metOn).filter((d): d is string => Boolean(d)).sort();
    const completedOn = complete[i] ? days[days.length - 1] ?? null : null;
    const view: PhaseView = {
      id: c.phase.id,
      name: c.phase.name,
      index: i,
      goals: c.phase.goals,
      targets: c.targets,
      ...(c.phase.expectedWeeks ? { expectedWeeks: c.phase.expectedWeeks } : {}),
      ...(c.phase.notes ? { notes: c.phase.notes } : {}),
      status: complete[i] && (current === -1 || i < current) ? 'complete' : i === current ? 'current' : 'upcoming',
      completedOn,
      since: i === current ? previousDone : null,
      progress: { met: c.met, total: c.required.length },
    };
    if (complete[i]) previousDone = completedOn ?? previousDone;
    return view;
  });
}

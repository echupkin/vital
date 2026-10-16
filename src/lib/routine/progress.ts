// ── Routine progress: the shared pipeline ───────────────
//
// `buildRoutine` turns a stored plan plus the reader's data into everything the
// Workouts page, the path detail page and the analyst's tools show:
//
//   for every path
//     1. collect the current stage's sessions (since it began) and the previous
//        stage's, from the workout sources and Apple Health workouts;
//     2. let the path's progression model judge them (models/);
//     3. apply what every model shares:
//          a hold      → red (regress) or at most yellow (hold), with its reason
//          recovery    → a `warn` gate caps the light at yellow, `watch` at yellow-green
//                        (body weight is a callout only and caps nothing)
//          deloads     → a deload running (planned, recorded or read from lighter,
//                         easier sessions) pauses progress; it and an overdue
//                         deload replace "move on" advice
//   for the plan
//     the current phase (from the data), calendar blocks, what session is next,
//     adherence, deload timing, recovery.
//
// Pure: everything it reads is passed in, so it runs the same in tests, in the
// API routes and in the analyst's tools.

import type { WorkoutRecord } from '../metrics/types';
import type { UnitSystem } from '../prefs';
import type { TrainingSession } from '../workout-sources/types';
import { doseText } from './format';
import { MODEL_PARAM_SPECS } from './model-params';
import { PROGRESSION_MODELS, type Light, type ModelEvaluation, type ProgressRow, type Readiness } from './models';
import type { EvaluationContext } from './models/types';
import { stageRows } from './models/variation';
import { LIGHT_ORDER } from './models/types';
import { detectDeloads, easedKey } from './deload';
import { formatDayKeyShort } from '../analytics/windows';
import { currentBlocks, deloadStatus, phaseViews, planPosition, planWeek, type BlockView, type DeloadStatus, type PathState, type PhaseView } from './position';
import { recordsForStage, stageNeedsExerciseData, type PerformanceRecord } from './records';
import { holdsProgression, recoveryIndicators, recoverySummary, type DayValue, type RecoveryIndicator } from './recovery';
import { cadenceView, type CadenceView } from './cadence';
import { adherence, completedSessions, nextSession, type Adherence, type NextSessionView } from './schedule';
import type { Path, PathHold, StoredPlan, TrainingPlan } from './types';
import { untrackedExercises, type UntrackedExercise } from './untracked';
import { workoutViews, type WorkoutView } from './workout-view';

export interface StageView {
  id: string;
  name: string;
  index: number;
  status: 'done' | 'current' | 'upcoming';
  /**
   * The stage's marker is met: every stage the path has moved past, and the
   * current one once performance reaches it (on its last step, when it has steps).
   */
  complete: boolean;
  startedOn: string | null;
  expectedWeeks?: [number, number];
  target: string;
  steps: string[];
}

export interface PathProgress {
  areaId: string;
  areaName: string;
  pathId: string;
  pathName: string;
  model: string;
  modelLabel: string;
  priority: Path['priority'];
  stage: StageView;
  step: { index: number; name: string; count: number } | null;
  nextStage: { id: string; name: string } | null;
  stages: StageView[];
  light: Light;
  /**
   * False when the current stage can only be seen through a workout source and
   * none is connected: its light is 'none' because nothing *can* be read, not
   * because nothing was done.
   */
  tracked: boolean;
  reasons: string[];
  /** What holds the path back from where performance alone would put it: recovery caps its light, a deload replaces moving on. */
  heldBack: ('recovery' | 'deload')[];
  readiness: Readiness | null;
  nextAction: string;
  target: string;
  prescription: string;
  cues: string[];
  checks: string[];
  hold: PathHold | null;
  rows: ProgressRow[];
  lastSession: { date: string; work: string } | null;
  facts: ModelEvaluation['facts'];
}

export interface RoutineOverview {
  planId: string;
  revision: number;
  title: string;
  goal: string;
  context: string[];
  startDate: string;
  durationWeeks: number;
  week: number;
  started: boolean;
  /** Calendar blocks running this week (deloads, peaks, tapers). */
  currentBlocks: string[];
  blocks: BlockView[];
  /** Milestones; the current one is worked out from the data, never from the date. */
  phases: PhaseView[];
  currentPhase: { index: number; count: number; name: string; since: string | null; progress: PhaseView['progress'] } | null;
  next: NextSessionView;
  adherence: Adherence;
  deload: DeloadStatus;
  recovery: { status: 'ok' | 'watch' | 'warn' | 'unknown'; text: string; indicators: RecoveryIndicator[] };
  lights: TrainingPlan['rules']['lights'];
  doNotProgressIf: string[];
  paths: PathProgress[];
  /** The rhythm of training and rest days: the repeating pattern and this week. */
  cadence: CadenceView;
  /** Each session template as a day of training (the "Workout A" pages). */
  workouts: WorkoutView[];
  /** Recently logged exercises no stage recognises (so they count toward nothing). */
  untracked: UntrackedExercise[];
  /** Whether exercise-level sessions can be read at all (see `RoutineInputs.exerciseData`). */
  exerciseData: boolean;
}

export interface RoutineInputs {
  stored: StoredPlan;
  sessions: TrainingSession[];
  workouts: WorkoutRecord[];
  series: (metricId: string) => DayValue[];
  today: string;
  dayOf: (iso: string) => string;
  system: UnitSystem;
  /**
   * Whether exercise-level sessions (sets, reps, load) can be read: a workout
   * source is connected, or demo data is served. Without them only stages
   * matched by Apple Health workout type can be judged. Defaults to true.
   */
  exerciseData?: boolean;
}

/** Why a path shows no light when no workout source is connected. */
export const NOT_TRACKED_REASON =
  'Not tracked: this stage is recognised by its exercises, and no workout source (such as Hevy) is connected, so its sessions cannot be seen. Apple Health records only a workout\'s type and duration.';

function capLight(light: Light, cap: Light): Light {
  if (light === 'none') return light;
  return LIGHT_ORDER.indexOf(light) > LIGHT_ORDER.indexOf(cap) ? cap : light;
}

function stageStart(path: Path, stageId: string): string | null {
  const entries = path.history.filter(h => h.stageId === stageId);
  return entries.length ? entries[entries.length - 1].startedOn : null;
}

/** Records of every stage of a path, keyed by stage id. */
function pathRecords(path: Path, inputs: RoutineInputs): Map<string, PerformanceRecord[]> {
  const out = new Map<string, PerformanceRecord[]>();
  for (const stage of path.stages) out.set(stage.id, recordsForStage(stage, inputs.sessions, inputs.workouts, { dayOf: inputs.dayOf }));
  return out;
}

const COUNT_SUFFIX = / · \d+ sessions$/;

/**
 * One row per training day: the current stage's work leads, other stages'
 * work from the same day sits under it (`also`), and consecutive days with
 * identical work merge into one row ("Sep 18 / Sep 22 · 2 sessions").
 */
export function rowsByDay(rows: ProgressRow[], path: Path, currentStageId: string): ProgressRow[] {
  const order = (id: string) => (id === currentStageId ? -1 : path.stages.findIndex(s => s.id === id));
  const days = new Map<string, ProgressRow[]>();
  for (const row of rows) {
    row.dates.forEach((date, i) => {
      const single: ProgressRow = {
        ...row,
        dates: [date],
        sessionIds: row.sessionIds[i] !== undefined ? [row.sessionIds[i]] : [],
        signal: row.signal.replace(COUNT_SUFFIX, ''),
      };
      days.set(date, [...(days.get(date) ?? []), single]);
    });
  }
  const perDay: ProgressRow[] = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entries]) => {
      const [lead, ...rest] = entries.sort((a, b) => order(a.stageId) - order(b.stageId));
      return rest.length ? { ...lead, also: rest } : lead;
    });

  const same = (a: ProgressRow, b: ProgressRow) =>
    a.stageId === b.stageId && a.work === b.work && (a.also ?? []).map(x => x.work).join('|') === (b.also ?? []).map(x => x.work).join('|');
  const out: ProgressRow[] = [];
  for (const row of perDay) {
    const prev = out[out.length - 1];
    if (prev && same(prev, row) && !/before progression/.test(prev.signal) && !/before progression/.test(row.signal)) {
      prev.dates.push(...row.dates);
      prev.sessionIds.push(...row.sessionIds);
      prev.signal = `${prev.signal.replace(COUNT_SUFFIX, '')} · ${prev.dates.length} sessions`;
      continue;
    }
    out.push({ ...row, dates: [...row.dates], sessionIds: [...row.sessionIds] });
  }
  return out;
}

/**
 * What a path's model judges for the stage at `index`: its sessions since it
 * began and the previous stage's before that. With `before`, only sessions
 * before that day, as the path stood then.
 */
function modelContext(
  plan: TrainingPlan,
  path: Path,
  index: number,
  byStage: Map<string, PerformanceRecord[]>,
  deload: DeloadStatus,
  inputs: RoutineInputs,
  eased: Set<string>,
  before?: string
): EvaluationContext {
  const stage = path.stages[index];
  const previousStage = index > 0 ? path.stages[index - 1] : null;
  const startedOn = stageStart(path, stage.id);
  const records = (byStage.get(stage.id) ?? []).filter(r => (!startedOn || r.date >= startedOn) && (!before || r.date < before));
  const previousRecords = previousStage
    ? (byStage.get(previousStage.id) ?? []).filter(r => !startedOn || r.date < startedOn)
    : [];
  const today = before ?? inputs.today;
  return {
    path,
    stage,
    nextStage: index + 1 < path.stages.length ? path.stages[index + 1] : null,
    records,
    previousRecords,
    previousStage,
    rules: plan.rules,
    blocks: currentBlocks(plan, planWeek(plan, today)),
    eased,
    deloadWindow: before ? null : deload.window,
    today,
    system: inputs.system,
  };
}

/** The history reason of a stage the data moved a path on to. */
const MOVED_ON_REASON = (from: string) => `Moved on from logged sessions after the ${from.toLowerCase()} marker was met`;

/**
 * The plan as the data has moved it on: a path whose current stage's marker
 * was met, and which then has a session logged on its next stage, is on that
 * stage from that session's day. A try at the next stage before the marker is
 * met stays "ahead" work. Worked out on every read, never stored, like the
 * phases; a hold, or steps still to go within the stage, keeps a path where it is.
 */
export function followLoggedStages(
  plan: TrainingPlan,
  stageRecords: Map<string, Map<string, PerformanceRecord[]>>,
  eased: Map<string, Set<string>>,
  deload: DeloadStatus,
  inputs: RoutineInputs
): TrainingPlan {
  let next: TrainingPlan | null = null;
  for (const [a, area] of plan.focusAreas.entries()) {
    for (const [p, stored] of area.paths.entries()) {
      const byStage = stageRecords.get(stored.id);
      if (stored.hold || !byStage) continue;
      let path = stored;
      for (;;) {
        const index = Math.max(0, path.stages.findIndex(s => s.id === path.currentStageId));
        const stage = path.stages[index];
        const following = path.stages[index + 1];
        if (!following) break;
        if (stage.steps?.length && path.currentStepIndex !== undefined && path.currentStepIndex < stage.steps.length - 1) break;
        const startedOn = stageStart(path, stage.id);
        const days = [...new Set((byStage.get(following.id) ?? []).map(r => r.date).filter(d => !startedOn || d >= startedOn))].sort();
        const from = days.find(d => {
          const ctx = modelContext(plan, path, index, byStage, deload, inputs, eased.get(path.id) ?? new Set(), d);
          return Boolean(PROGRESSION_MODELS[path.model].evaluate(ctx).readiness?.met);
        });
        if (!from) break;
        path = {
          ...path,
          currentStageId: following.id,
          currentStepIndex: undefined,
          history: [...path.history, { stageId: following.id, startedOn: from, reason: MOVED_ON_REASON(stage.name) }],
        };
      }
      if (path === stored) continue;
      next ??= structuredClone(plan);
      next.focusAreas[a].paths[p] = path;
    }
  }
  return next ?? plan;
}

export function evaluatePath(
  plan: TrainingPlan,
  areaId: string,
  areaName: string,
  path: Path,
  byStage: Map<string, PerformanceRecord[]>,
  recoveryCap: { cap: Light; reasons: string[] },
  deload: DeloadStatus,
  inputs: RoutineInputs,
  /** This path's deload sessions (`stageId:sessionId`). */
  eased: Set<string> = new Set()
): PathProgress {
  const index = Math.max(0, path.stages.findIndex(s => s.id === path.currentStageId));
  const ctx = modelContext(plan, path, index, byStage, deload, inputs, eased);
  const { stage, nextStage: nextStageDef, records, previousStage, blocks } = ctx;
  const startedOn = stageStart(path, stage.id);

  const evaluation = PROGRESSION_MODELS[path.model].evaluate(ctx);

  let light = evaluation.light;
  let reasons = [...evaluation.reasons];
  let nextAction = evaluation.nextAction;
  let readiness = evaluation.readiness;
  const heldBack: PathProgress['heldBack'] = [];
  const tracked = inputs.exerciseData !== false || !stageNeedsExerciseData(stage);

  if (!tracked) {
    light = 'none';
    reasons = [NOT_TRACKED_REASON];
    readiness = null;
    // Not "Start …": the stage may well be under way; it just can't be seen.
    const dose = doseText(evaluation.target, inputs.system);
    nextAction = `Train ${stage.name.toLowerCase()}${dose ? ` at ${dose}` : ''}.`;
  }
  if (path.hold) {
    light = path.hold.kind === 'regress' ? 'red' : capLight(light, 'yellow');
    reasons.unshift(`${path.hold.kind === 'regress' ? 'Regress' : 'On hold'} since ${path.hold.since}: ${path.hold.reason}`);
    nextAction =
      path.hold.kind === 'regress'
        ? `Step back to ${previousStage ? previousStage.name.toLowerCase() : 'an easier version'} or cut the volume until "${path.hold.reason}" has resolved.`
        : `Hold ${stage.name.toLowerCase()} at an easy, pain-free volume; do not progress until "${path.hold.reason}" has resolved.`;
  } else if (light !== 'none' && LIGHT_ORDER.indexOf(light) > LIGHT_ORDER.indexOf(recoveryCap.cap)) {
    light = recoveryCap.cap;
    heldBack.push('recovery');
    reasons.push(...recoveryCap.reasons);
    if (evaluation.light === 'green') nextAction = `Performance says move on, but recovery does not: repeat ${doseText(evaluation.target, inputs.system)} until ${recoveryCap.reasons.join(' ').replace(/\.$/, '').toLowerCase()} settles.`;
  }
  const deloadNow = blocks.find(b => b.kind === 'deload');
  const inDeload = deload.status === 'in-deload';
  const pausedHere = records.filter(r => eased.has(easedKey(stage.id, r.sessionId)));
  if (!path.hold && tracked) {
    const window = deload.window;
    const inWindow = window ? pausedHere.filter(r => r.date >= window.from && r.date <= window.to) : [];
    if (inDeload && window && inWindow.length) {
      // Paused, not held back: only a path performance would move on is waiting on the deload.
      if (evaluation.light === 'green') heldBack.push('deload');
      reasons.unshift(`Deload since ${formatDayKeyShort(window.from)}: its lighter sessions don't count for or against progress.`);
      nextAction = `Keep ${stage.name.toLowerCase()} light until ${formatDayKeyShort(window.to)}, then pick up where you left off: ${evaluation.nextAction.charAt(0).toLowerCase()}${evaluation.nextAction.slice(1)}`;
    } else if ((deloadNow || inDeload || deload.status === 'overdue') && evaluation.light === 'green') {
      heldBack.push('deload');
      nextAction = `${deloadNow ? deloadNow.name : inDeload ? 'Deload week' : 'Deload overdue'}: keep ${stage.name.toLowerCase()} and cut sets by a third to a half this week; progress after it.`;
    } else if (records.length && pausedHere.some(r => r.sessionId === records[records.length - 1].sessionId)) {
      reasons.push(`The ${formatDayKeyShort(records[records.length - 1].date)} session was lighter at a lower effort, so it doesn't count against progress.`);
    }
  }

  // Readiness is about performance: a hold, recovery cap or deload does not undo it.
  const onLastStep = path.currentStepIndex === undefined || path.currentStepIndex >= (stage.steps?.length ?? 0) - 1;
  const currentComplete = Boolean(readiness?.met) && onLastStep;
  const stages: StageView[] = path.stages.map((s, i) => ({
    id: s.id,
    name: s.name,
    index: i,
    status: i < index ? 'done' : i === index ? 'current' : 'upcoming',
    complete: i < index || (i === index && currentComplete),
    startedOn: stageStart(path, s.id),
    ...(s.expectedWeeks ? { expectedWeeks: s.expectedWeeks } : {}),
    target: doseText(s.advanceWhen ?? s.prescription, inputs.system),
    steps: (s.steps ?? []).map(x => x.name),
  }));
  const stepIndex = path.currentStepIndex;
  const lastRow = records.length ? evaluation.rows[evaluation.rows.length - 1] : null;

  // The whole path, not just the stage being judged: sessions on other stages
  // (kept in rotation, or tried ahead) sit in the same table, each judged against
  // its own stage. Weekly volume rows stay on their own.
  const shown = new Set(evaluation.rows.flatMap(r => r.sessionIds.map(id => `${r.stageId}:${id}`)));
  const others: ProgressRow[] =
    path.model === 'volume'
      ? []
      : path.stages.flatMap((s, i) => {
          // The current stage's own sessions are all shown, except tries from before it began.
          const extra = (byStage.get(s.id) ?? []).filter(r => !shown.has(`${s.id}:${r.sessionId}`));
          if (extra.length === 0) return [];
          const note = (r: PerformanceRecord) =>
            i === index
              ? 'Tried before this stage began'
              : i > index
                ? 'Ahead of the current stage'
                : startedOn && r.date >= startedOn
                  ? 'Alongside the current stage'
                  : 'Earlier stage';
          return stageRows(s, extra, plan.rules, inputs.system, note);
        });
  const rows = others.length ? rowsByDay([...evaluation.rows, ...others], path, stage.id) : evaluation.rows;

  return {
    areaId,
    areaName,
    pathId: path.id,
    pathName: path.name,
    model: path.model,
    modelLabel: MODEL_PARAM_SPECS[path.model].label,
    priority: path.priority,
    stage: stages[index],
    step: stepIndex !== undefined && stage.steps?.[stepIndex] ? { index: stepIndex, name: stage.steps[stepIndex].name, count: stage.steps.length } : null,
    nextStage: nextStageDef ? { id: nextStageDef.id, name: nextStageDef.name } : null,
    stages,
    light,
    tracked,
    reasons,
    heldBack,
    readiness,
    nextAction,
    target: doseText(evaluation.target, inputs.system),
    prescription: doseText(stage.prescription, inputs.system),
    cues: stage.cues,
    checks: stage.checks,
    hold: path.hold ?? null,
    rows,
    lastSession: lastRow ? { date: lastRow.dates[lastRow.dates.length - 1], work: lastRow.work } : null,
    facts: evaluation.facts,
  };
}

export function buildRoutine(inputs: RoutineInputs): RoutineOverview {
  const { stored, today, system } = inputs;
  const week = planWeek(stored.plan, today);

  const completed = completedSessions(stored.plan, inputs.sessions, inputs.workouts, inputs.dayOf);
  const trainingDays = [
    ...new Set([...inputs.sessions.map(s => inputs.dayOf(s.startTime)), ...completed.map(c => c.date)]),
  ];
  const indicators = recoveryIndicators({ series: inputs.series, trainingDays, today, system }, stored.plan.rules.recoveryGates);
  const summary = recoverySummary(indicators);
  // Body weight is a callout on the recovery page, never a reason to hold a path.
  const warn = indicators.filter(i => holdsProgression(i) && i.status === 'warn');
  const watch = indicators.filter(i => holdsProgression(i) && i.status === 'watch');
  const recoveryCap = warn.length
    ? { cap: 'yellow' as Light, reasons: warn.map(i => `${i.label}: ${i.text}`) }
    : watch.length
      ? { cap: 'yellow-green' as Light, reasons: watch.map(i => `${i.label}: ${i.text}`) }
      : { cap: 'green' as Light, reasons: [] };

  const stageRecords = new Map(stored.plan.focusAreas.flatMap(a => a.paths).map(p => [p.id, pathRecords(p, inputs)]));
  const deloads = detectDeloads(stored.plan, stageRecords);
  const deload = deloadStatus(stored.plan, today, deloads.starts);
  // From here on, each path stands where the data has moved it.
  const plan = followLoggedStages(stored.plan, stageRecords, deloads.eased, deload, inputs);

  const recordsByPath = new Map<string, PerformanceRecord[]>();
  const states = new Map<string, PathState>();
  const paths: PathProgress[] = [];
  for (const area of plan.focusAreas) {
    for (const path of area.paths) {
      const byStage = stageRecords.get(path.id)!;
      const records = [...byStage.values()].flat().sort((a, b) => a.startTime.localeCompare(b.startTime));
      recordsByPath.set(path.id, records);
      const progress = evaluatePath(plan, area.id, area.name, path, byStage, recoveryCap, deload, inputs, deloads.eased.get(path.id));
      paths.push(progress);
      states.set(path.id, {
        path,
        currentIndex: progress.stage.index,
        ready: progress.stage.complete,
        records,
        byStage,
      });
    }
  }
  const phases = phaseViews(plan, states, system);
  const current = phases.find(p => p.status === 'current') ?? null;
  const next = nextSession(plan, completed, today, week, system);

  return {
    planId: stored.id,
    revision: stored.revision,
    title: plan.title,
    goal: plan.goal,
    context: plan.context,
    startDate: plan.startDate,
    durationWeeks: plan.durationWeeks,
    week,
    started: today >= plan.startDate,
    currentBlocks: currentBlocks(plan, week).map(b => b.name),
    blocks: planPosition(plan, recordsByPath, today, system),
    phases,
    currentPhase: current
      ? { index: current.index, count: phases.length, name: current.name, since: current.since, progress: current.progress }
      : null,
    next,
    adherence: countableAdherence(plan, adherence(plan, completed, today, week), inputs.exerciseData !== false),
    deload,
    recovery: { ...summary, indicators },
    lights: plan.rules.lights,
    doNotProgressIf: plan.rules.doNotProgressIf,
    paths,
    cadence: cadenceView(plan, completed, next, today, week, trainingDays),
    workouts: workoutViews(plan, paths, completed, next, deload, system),
    untracked: untrackedExercises(plan, inputs.sessions, inputs.dayOf, today),
    exerciseData: inputs.exerciseData !== false,
  };
}

/**
 * Without a workout source, sessions of a workout whose paths are matched by
 * exercise can't be seen, so a low count would say the reader is behind when
 * nothing can be read. Adherence is then unknown rather than counted.
 */
function countableAdherence(plan: TrainingPlan, counted: Adherence, exerciseData: boolean): Adherence {
  if (exerciseData) return counted;
  const unseen = plan.templates.some(t =>
    t.slots.every(slot =>
      slot.pathIds.every(id => {
        const path = plan.focusAreas.flatMap(a => a.paths).find(p => p.id === id);
        return !path || path.stages.every(stageNeedsExerciseData);
      })
    )
  );
  if (!unseen) return counted;
  return {
    ...counted,
    completed: 0,
    ratio: null,
    status: 'unknown',
    text: 'Sessions are not counted: no workout source is connected, so logged workouts cannot be matched to this plan.',
  };
}

/**
 * Place each path on the stage the reader is actually training.
 *
 * For a plan created after training has already begun: the furthest stage with
 * a session in the last `recentDays` becomes current, and each stage that was
 * trained gets a history entry from its first session. Paths with no matching
 * sessions are left on their first stage.
 */
export function inferCurrentStages(
  plan: TrainingPlan,
  sessions: TrainingSession[],
  workouts: WorkoutRecord[],
  dayOf: (iso: string) => string,
  today: string,
  recentDays = 42
): { plan: TrainingPlan; changes: string[] } {
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - recentDays * 86_400_000).toISOString().slice(0, 10);
  const changes: string[] = [];
  const next: TrainingPlan = structuredClone(plan);
  for (const area of next.focusAreas) {
    for (const path of area.paths) {
      const firsts = path.stages.map(stage => {
        const recs = recordsForStage(stage, sessions, workouts, { dayOf });
        return { stage, first: recs[0]?.date ?? null, recent: recs.some(r => r.date >= cutoff) };
      });
      let current = -1;
      firsts.forEach((f, i) => {
        if (f.recent) current = i;
      });
      if (current < 0) continue;
      path.currentStageId = firsts[current].stage.id;
      path.currentStepIndex = undefined;
      path.history = firsts
        .slice(0, current + 1)
        .filter(f => f.first)
        .map(f => ({ stageId: f.stage.id, startedOn: f.first!, reason: 'Inferred from logged sessions' }));
      changes.push(`${path.name}: ${firsts[current].stage.name} (since ${firsts[current].first})`);
    }
  }
  return { plan: next, changes };
}

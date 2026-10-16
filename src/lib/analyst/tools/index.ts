// ── Analyst tools: the training plan (SERVER ONLY) ──────
//
// The tools a configured model may call during one question. Read tools look at
// the routine and the logged sessions; write tools create or change the plan.
//
// Every write goes through src/lib/routine/actions.ts — the same path as the
// Workouts page's buttons — so it is validated as a whole plan, stored as a new
// revision, and reported as a PlanChange the reader can undo. A plan is
// configuration: no tool can store a measurement.
//
// Tool results are handed back to the model as JSON and also kept for the
// grounding check, so a number the model quotes from a tool result is not
// flagged as invented.

import type { UnitSystem } from '../../prefs';
import { applyPlanOps, type PlanOp } from '../../routine/patch';
import { archiveActivePlan, createPlan, PlanInputError, updateActivePlan } from '../../routine/actions';
import { loadRoutineContext, routineFor, type RoutineDeps } from '../../routine/service';
import { REFERENCE_PLANS, referencePlan } from '../../routine/templates';
import { MODEL_PARAM_SPECS } from '../../routine/model-params';
import { findPath } from '../../routine/validate';
import type { PlanChange, TrainingPlan } from '../../routine/types';
import type { PathProgress, RoutineOverview } from '../../routine/progress';
import { loadExerciseTemplates } from '../../workout-sources/store';
import { nameKey } from '../../routine/records';
import type { ToolSpec } from '../provider';
import { redactCredentials, scrubForModel } from '../scrub';
import { checkArgs, type Schema } from './args';
import type { DataAccess } from '../dataAccess';
import { DATA_TOOLS } from './data';
import { policyGate } from './capability-tool';
import { getTrainingSessions } from './training-sessions';

export const MAX_TOOL_RESULT_CHARS = 14_000;
export const MAX_WRITES_PER_QUESTION = 3;

export interface ToolContext {
  /** The on-demand data readers; absent when the question is answered from the fixed context. */
  data?: DataAccess;
  system: UnitSystem;
  deps: RoutineDeps;
  /** Changes made during this question, in order. */
  changes: PlanChange[];
}

export interface ToolOutcome {
  content: unknown;
  isError?: boolean;
}

export interface AnalystTool {
  name: string;
  kind: 'read' | 'write';
  description: string;
  parameters: Schema & { type: 'object' };
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

// ── Plan schema, for the model ──────────────────────────

const PLAN_SCHEMA_TEXT = `A plan is JSON (ranges are [min,max] or a single number):
{ title, goal, context: [string], startDate: "YYYY-MM-DD", durationWeeks: 1–104,
  focusAreas: [{ id?, name, paths: [{ id?, name, model: ${Object.keys(MODEL_PARAM_SPECS).map(m => `"${m}"`).join('|')}, params?, priority: "primary"|"secondary",
      currentStageId?, stages: [{ id?, name,
        match: { names: [exercise names as logged, plus aliases], templateIds?: [workout-source template ids], workoutTypes?: [Apple Health types e.g. "Running"] },
        prescription?: Dose, advanceWhen?: Dose, qualifyingSessions?: range, cues: [string], checks: [string],
        steps?: [{ name, advanceWhen?: Dose }], expectedWeeks?: range, notes? }] }] }],
  rules: { qualifyingSessions: range, effort?: { rpe?: range, rir?: range }, lights: { green: [string], yellow: [string], red: [string] },
    doNotProgressIf: [string], deload?: { everyWeeks: range, volumeReduction: [0.3,0.5] },
    recoveryGates: [{ signal: "resting_hr"|"hrv"|"sleep_hours"|"body_weight_rate"|"training_load", rule: "rising"|"falling"|"below"|"above", threshold, severity: "watch"|"warn", note? }] },
  phases: [{ id?, name, goals: [string], expectedWeeks?: range, targets: [{ label, pathId?, stageId?, reach?: "started"|"mastered", dose?: Dose, optional? }] }],
  blocks: [{ id?, name, startWeek, weeks, kind?: "build"|"deload"|"peak"|"taper"|"test", goals: [string], targets: [{ pathId?, label, dose?: Dose }], scheduleOverride?: Schedule }],
  templates: [{ id?, name, minutes?, warmup?: [string], slots: [{ pathIds: [pathId], dose?: Dose, optional?, rotate?, note? }] }],
  schedule: Schedule }
Dose: { sets?, reps?, perSide?, load?: { kg?, pct1rm?, assistanceKg? }, durationS?, holdS?, eccentricS?, distanceM?, paceSPerKm?, hrZone?, effort?: { rpe?, rir? }, weeklyVolume?: { metric: "sets"|"distanceM"|"durationS", range } }
Schedule (pick what the person asked for — never assume a cadence):
  { kind: "cycle", days: [templateId | "rest", …] (any length: ["a","b","rest"], ["full","rest"], ["daily"]), advance: "on-completion"|"calendar" }
  { kind: "weekdays", days: { mon: templateId, thu: templateId, … } }
  { kind: "frequency", sessionsPerWeek: range, rotation: [templateId, …], minRestHours? }
Phases are the plan's milestones, reached by progress: the current phase is the first whose required targets are not met, worked out from the logged sessions — never from the date, so nobody is "behind". Every phase target must be checkable: a stage started or mastered on a path (pathId + stageId + reach), or a dose reached on a stage (pathId + stageId + dose; without stageId any stage of the path counts, so name the stage when easier variations could satisfy the dose). A target with only a pathId is refused; put aims no session can show in the phase's goals. expectedWeeks is only a guide. Use blocks only for true calendar periods (deload weeks, a peak, a taper, a test week).
Ids are optional (derived from names as lowercase-dashed); slots, targets and schedules refer to those ids.
Models: ${Object.entries(MODEL_PARAM_SPECS).map(([id, s]) => `${id} — ${s.description}${Object.keys(s.params).length ? ` params: ${Object.entries(s.params).map(([k, p]) => `${k} (${p.description})`).join(', ')}` : ''}`).join(' | ')}`;

// ── Result shaping ──────────────────────────────────────

export function pathSummary(p: PathProgress, rows = 4) {
  return {
    pathId: p.pathId,
    path: p.pathName,
    area: p.areaName,
    model: p.model,
    stage: p.stage.name,
    stageId: p.stage.id,
    step: p.step?.name ?? null,
    stageStartedOn: p.stage.startedOn,
    nextStage: p.nextStage?.name ?? null,
    light: p.light,
    // false: no workout source is connected, so this stage's sessions cannot be seen (not "not trained").
    tracked: p.tracked,
    reasons: p.reasons,
    readiness: p.readiness?.label ?? null,
    marker: p.target,
    nextAction: p.nextAction,
    hold: p.hold,
    recentSessions: p.rows.slice(-rows).map(r => ({
      dates: r.dates,
      work: r.work,
      total: r.headline,
      effort: r.effort,
      signal: r.signal,
      notes: r.notes,
      ...(r.also?.length ? { sameDayOtherStages: r.also.map(a => ({ work: a.work, total: a.headline, effort: a.effort, signal: a.signal })) } : {}),
    })),
  };
}

export function overviewSummary(r: RoutineOverview, detailPathId?: string) {
  return {
    planId: r.planId,
    revision: r.revision,
    title: r.title,
    goal: r.goal,
    ...(r.exerciseData
      ? {}
      : { exerciseData: 'There is no connected workout source: paths with tracked=false cannot be judged, and their sessions are unknown rather than missed. Suggest connecting one in Settings → Sources.' }),
    week: r.started ? r.week : `starts ${r.startDate}`,
    currentPhase: r.currentPhase
      ? { phase: `${r.currentPhase.index + 1} of ${r.currentPhase.count}`, name: r.currentPhase.name, since: r.currentPhase.since, milestones: `${r.currentPhase.progress.met} of ${r.currentPhase.progress.total} required` }
      : r.phases.length ? 'all phases complete' : null,
    phases: r.phases.map(p => ({ name: p.name, status: p.status, targets: p.targets.map(t => `${t.state === 'done' ? 'done' : t.state === 'in-progress' ? `in progress${t.met ? ', which this phase counts as reached' : ''}` : t.state === 'not-started' ? 'not yet' : 'unchecked'}: ${t.label}${t.optional ? ' (optional)' : ''}`) })),
    calendarBlocksThisWeek: r.currentBlocks,
    nextSession: { due: r.next.due.label, why: r.next.why, slots: r.next.due.templates.flatMap(t => t.slots.map(s => `${s.stageName}${s.dose ? ` — ${s.dose}` : ''}${s.optional ? ' (optional)' : ''}`)) },
    adherence: r.adherence.text,
    deload: r.deload.text,
    recovery: { status: r.recovery.status, summary: r.recovery.text, indicators: r.recovery.indicators.map(i => ({ signal: i.signal, status: i.status, text: i.text })) },
    paths: r.paths.map(p => (detailPathId === p.pathId ? pathSummary(p, 12) : pathSummary(p))),
    // Logged in the last 90 days but matched by no stage, so counted toward nothing.
    untrackedExercises: r.untracked.map(u => ({ name: u.name, templateId: u.templateId, sessions: u.sessions, lastDate: u.lastDate })),
  };
}

async function routineNow(ctx: ToolContext): Promise<{ routine: RoutineOverview | null; plan: TrainingPlan | null; revision: number | null; today: string }> {
  const rc = await loadRoutineContext(ctx.deps);
  return {
    routine: rc.stored ? routineFor(rc, rc.stored, ctx.system) : null,
    plan: rc.stored?.plan ?? null,
    revision: rc.stored?.revision ?? null,
    today: rc.today,
  };
}

const NO_PLAN = { error: 'There is no active training plan. Use create_training_plan (see get_reference_plan for complete examples).' };

function writeBudget(ctx: ToolContext): ToolOutcome | null {
  return ctx.changes.length >= MAX_WRITES_PER_QUESTION
    ? { isError: true, content: { error: `At most ${MAX_WRITES_PER_QUESTION} plan changes per question. Summarise what was done and ask the reader to continue.` } }
    : null;
}

async function write(ctx: ToolContext, fn: () => Promise<PlanChange>): Promise<ToolOutcome> {
  const blocked = writeBudget(ctx);
  if (blocked) return blocked;
  try {
    const change = await fn();
    ctx.changes.push(change);
    return { content: { ok: true, change: { kind: change.kind, planId: change.planId, revision: change.toRevision, summary: change.summary, diff: change.diff } } };
  } catch (error) {
    if (error instanceof PlanInputError) return { isError: true, content: { error: 'The plan was not saved.', problems: error.errors.slice(0, 25) } };
    return { isError: true, content: { error: error instanceof Error ? error.message : 'The plan could not be saved.' } };
  }
}

function today(ctx: ToolContext): Promise<string> {
  return loadRoutineContext(ctx.deps).then(c => c.today);
}

// ── Tools ───────────────────────────────────────────────

export const ANALYST_TOOLS: AnalystTool[] = [
  {
    name: 'get_routine_progress',
    kind: 'read',
    description:
      'The active training plan evaluated against the logged sessions: the current phase (worked out from progress) and every phase\'s milestones, plan week and calendar blocks, the next session, adherence, deload timing, recovery indicators, and for every progression path its current stage, light (green / yellow-green / yellow / red / none), reasons, readiness for the next stage, next action and recent sessions. Pass pathId for that path\'s full recent history.',
    parameters: { type: 'object', properties: { pathId: { type: 'string', description: 'Optional path id for more session history.' } }, additionalProperties: false },
    async run(args, ctx) {
      const { routine } = await routineNow(ctx);
      if (!routine) return { content: NO_PLAN };
      return { content: overviewSummary(routine, args.pathId as string | undefined) };
    },
  },
  {
    name: 'get_training_plan',
    kind: 'read',
    description: 'The active plan document (JSON) with its id and revision — read it before changing it with update_training_plan.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      const { plan, revision } = await routineNow(ctx);
      if (!plan) return { content: NO_PLAN };
      return { content: { revision, plan } };
    },
  },
  getTrainingSessions,
  {
    name: 'search_exercise_templates',
    kind: 'read',
    description: 'Search the workout source\'s exercise catalogue by name, to use exact names and template ids in stage match rules.',
    parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string', maxLength: 80 } }, additionalProperties: false },
    async run(args, ctx) {
      const words = nameKey(String(args.query)).split(' ').filter(Boolean);
      const templates = await loadExerciseTemplates({ env: ctx.deps.env, fetchImpl: ctx.deps.fetchImpl });
      const hits = templates.filter(t => words.every(w => nameKey(t.name).includes(w))).slice(0, 20);
      return { content: { matches: hits.map(t => ({ name: t.name, templateId: t.id, kind: t.kind, primaryMuscle: t.primaryMuscle, custom: t.custom })) } };
    },
  },
  {
    name: 'get_reference_plan',
    kind: 'read',
    description: `A complete example plan, to show the expected shape. Examples, not defaults — adapt everything to the person. ids: ${REFERENCE_PLANS.map(r => `${r.id} (${r.label})`).join(', ')}.`,
    parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string', enum: REFERENCE_PLANS.map(r => r.id) } }, additionalProperties: false },
    async run(args, ctx) {
      const v = referencePlan(String(args.id), await today(ctx));
      return v.ok ? { content: v.plan } : { isError: true, content: { error: v.errors.join(' ') } };
    },
  },
  {
    name: 'create_training_plan',
    kind: 'write',
    description: `Create a new training plan and make it the active one (the previous plan is archived; the reader can undo). Fit it to the person's own goal, discipline, equipment, schedule and history — ask first if something important is missing.\n${PLAN_SCHEMA_TEXT}`,
    parameters: {
      type: 'object',
      required: ['plan', 'summary'],
      properties: {
        plan: { type: 'object', description: 'The plan document.' },
        inferStagesFromHistory: { type: 'boolean', description: 'Place each path on the stage the logged sessions show (default true).' },
        summary: { type: 'string', maxLength: 200, description: 'One line: what was created and why.' },
      },
      additionalProperties: false,
    },
    run(args, ctx) {
      return write(ctx, async () =>
        (await createPlan(args.plan, { inferStages: args.inferStagesFromHistory !== false, meta: { source: 'analyst', summary: String(args.summary) } }, ctx.deps)).change
      );
    },
  },
  {
    name: 'update_training_plan',
    kind: 'write',
    description:
      'Edit the active plan with patch ops, applied in order and validated as a whole plan. op "set" replaces the value at path, "remove" deletes it, "insert" adds value to the list at path (at index, or appended). Paths are dot-separated keys; key[x] selects a list item by id (or by position when x is a number). Example: {"op":"set","path":"focusAreas[push].paths[horizontal-push].stages[decline-push-up].advanceWhen","value":{"sets":[3,4],"reps":[8,12]}}. Read get_training_plan first.',
    parameters: {
      type: 'object',
      required: ['ops', 'summary'],
      properties: {
        ops: {
          type: 'array',
          maxItems: 24,
          items: {
            type: 'object',
            required: ['op', 'path'],
            properties: { op: { type: 'string', enum: ['set', 'remove', 'insert'] }, path: { type: 'string', maxLength: 300 }, value: {}, index: { type: 'integer', minimum: 0 } },
          },
        },
        summary: { type: 'string', maxLength: 200 },
      },
      additionalProperties: false,
    },
    run(args, ctx) {
      return write(ctx, async () => {
        let patched: unknown;
        const result = await updateActivePlan(
          plan => {
            try {
              patched = applyPlanOps(plan, args.ops as PlanOp[]);
            } catch (error) {
              throw new PlanInputError([error instanceof Error ? error.message : String(error)]);
            }
            return patched;
          },
          { source: 'analyst', summary: String(args.summary) },
          ctx.deps
        );
        return result.change;
      });
    },
  },
  {
    name: 'set_current_stage',
    kind: 'write',
    description: 'Move a progression path to a stage (forward to progress, back to regress), optionally to a step within it, recording today as its start.',
    parameters: {
      type: 'object',
      required: ['pathId', 'stageId', 'reason'],
      properties: {
        pathId: { type: 'string' },
        stageId: { type: 'string' },
        stepIndex: { type: 'integer', minimum: 0 },
        reason: { type: 'string', maxLength: 200 },
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const on = await today(ctx);
      return write(ctx, async () => {
        let label = '';
        const result = await updateActivePlan(
          plan => {
            const hit = findPath(plan, String(args.pathId));
            if (!hit) throw new PlanInputError([`No path "${String(args.pathId)}".`]);
            const stage = hit.path.stages.find(s => s.id === args.stageId);
            if (!stage) throw new PlanInputError([`Path "${hit.path.id}" has no stage "${String(args.stageId)}" (stages: ${hit.path.stages.map(s => s.id).join(', ')}).`]);
            hit.path.currentStageId = stage.id;
            hit.path.currentStepIndex = args.stepIndex as number | undefined;
            hit.path.history.push({ stageId: stage.id, startedOn: on, reason: String(args.reason), ...(args.stepIndex !== undefined ? { stepIndex: args.stepIndex as number } : {}) });
            label = `${hit.path.name} → ${stage.name}`;
            return plan;
          },
          { source: 'analyst', summary: String(args.reason) },
          ctx.deps
        );
        return { ...result.change, summary: `${label}: ${String(args.reason)}` };
      });
    },
  },
  {
    name: 'set_path_hold',
    kind: 'write',
    description: 'Pause progression on a path ("hold") or mark it for regression ("regress") — e.g. when the reader reports pain or discomfort. The routine then shows the path as yellow (hold) or red (regress) with the reason until the hold is cleared.',
    parameters: {
      type: 'object',
      required: ['pathId', 'kind', 'reason'],
      properties: { pathId: { type: 'string' }, kind: { type: 'string', enum: ['hold', 'regress'] }, reason: { type: 'string', maxLength: 200 } },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const on = await today(ctx);
      return write(ctx, async () =>
        (
          await updateActivePlan(
            plan => {
              const hit = findPath(plan, String(args.pathId));
              if (!hit) throw new PlanInputError([`No path "${String(args.pathId)}".`]);
              hit.path.hold = { kind: args.kind === 'regress' ? 'regress' : 'hold', reason: String(args.reason), since: on };
              return plan;
            },
            { source: 'analyst', summary: `${args.kind === 'regress' ? 'Regress' : 'Hold'} ${String(args.pathId)}: ${String(args.reason)}` },
            ctx.deps
          )
        ).change
      );
    },
  },
  {
    name: 'clear_path_hold',
    kind: 'write',
    description: 'Clear a hold or regression on a path once the reader says it has resolved.',
    parameters: { type: 'object', required: ['pathId'], properties: { pathId: { type: 'string' } }, additionalProperties: false },
    run(args, ctx) {
      return write(ctx, async () =>
        (
          await updateActivePlan(
            plan => {
              const hit = findPath(plan, String(args.pathId));
              if (!hit) throw new PlanInputError([`No path "${String(args.pathId)}".`]);
              delete hit.path.hold;
              return plan;
            },
            { source: 'analyst', summary: `Cleared the hold on ${String(args.pathId)}` },
            ctx.deps
          )
        ).change
      );
    },
  },
  {
    name: 'record_deload',
    kind: 'write',
    description: 'Record that a deload started: it runs for a week, pauses progress and resets the deload timer. Deloads are also read from the sessions (fewer reps at a clearly lower RPE across most paths trained that day), so record one only when the data cannot show it, such as when effort is not logged.',
    parameters: { type: 'object', properties: { startedOn: { type: 'string', description: 'YYYY-MM-DD; default today.' } }, additionalProperties: false },
    async run(args, ctx) {
      const on = typeof args.startedOn === 'string' ? args.startedOn : await today(ctx);
      return write(ctx, async () =>
        (await updateActivePlan(plan => ({ ...plan, deloads: [...plan.deloads, on] }), { source: 'analyst', summary: `Deload recorded from ${on}` }, ctx.deps)).change
      );
    },
  },
  {
    name: 'archive_training_plan',
    kind: 'write',
    description: 'Put the active plan away (it is kept and can be restored).',
    parameters: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } }, additionalProperties: false },
    run(args, ctx) {
      return write(ctx, () => archiveActivePlan({ source: 'analyst', summary: String(args.summary) }, ctx.deps));
    },
  },
];

/** The tools offered for a question: the training plan, plus the health data when it is fetched on demand. */
export function availableTools(ctx: Pick<ToolContext, 'data'>): AnalystTool[] {
  return ctx.data ? [...DATA_TOOLS, ...ANALYST_TOOLS] : ANALYST_TOOLS;
}

export function toolSpecs(tools: AnalystTool[] = ANALYST_TOOLS): ToolSpec[] {
  return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> }));
}

/** Run one call: unknown tools and bad arguments come back as errors the model can fix. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const offered = availableTools(ctx);
  const tool = offered.find(t => t.name === name);
  // Withheld by the AI privacy setting: nothing is read, whatever the arguments.
  const blocked = tool ? policyGate(tool.name, ctx) : null;
  let outcome: ToolOutcome;
  if (!tool) outcome = { isError: true, content: { error: `There is no tool "${name}". Tools: ${offered.map(t => t.name).join(', ')}.` } };
  else if (blocked) outcome = blocked;
  else if ('__unparseable' in args) outcome = { isError: true, content: { error: 'The arguments were not valid JSON.' } };
  else {
    const problems = checkArgs(tool.parameters, args);
    if (problems.length) outcome = { isError: true, content: { error: 'Invalid arguments.', problems } };
    else {
      try {
        outcome = await tool.run(args, ctx);
      } catch (error) {
        outcome = { isError: true, content: { error: scrubForModel(error instanceof Error ? error.message : 'The tool failed.') } };
      }
    }
  }
  // Whatever a tool says, no credential of the process or of the question's environment goes with it.
  let content = redactCredentials(JSON.stringify(outcome.content), ctx.deps.env);
  if (content.length > MAX_TOOL_RESULT_CHARS) content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
  return { content, isError: Boolean(outcome.isError) };
}

/** Several changes in one question, reported (and undone) as one. */
export function combineChanges(changes: PlanChange[]): PlanChange | null {
  if (changes.length === 0) return null;
  if (changes.length === 1) return changes[0];
  const first = changes[0];
  const last = changes[changes.length - 1];
  const samePlan = changes.every(c => c.planId === last.planId);
  const base = samePlan ? first : changes.find(c => c.planId === last.planId) ?? last;
  return {
    kind: base.kind === 'create' ? 'create' : last.kind === 'archive' ? 'archive' : 'update',
    planId: last.planId,
    planTitle: last.planTitle,
    fromRevision: base.fromRevision,
    toRevision: last.toRevision,
    previousActivePlanId: base.previousActivePlanId,
    summary: changes.map(c => c.summary).join('; '),
    diff: changes.flatMap(c => c.diff),
  };
}

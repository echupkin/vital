import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics/windows';
import type { WorkoutRecord } from '../metrics/types';
import type { TrainingSession, TrainingSet } from '../workout-sources/types';
import { buildRoutine, inferCurrentStages, type RoutineInputs } from './progress';
import { deloadStatus, planWeek } from './position';
import { adherence, completedSessions, nextSession } from './schedule';
import { validatePlan } from './validate';
import type { TrainingPlan } from './types';

// ── Builders ────────────────────────────────────────────

const dayOf = (iso: string) => iso.slice(0, 10);

function session(date: string, exercises: { name: string; sets: Partial<TrainingSet>[]; assisted?: boolean; notes?: string }[]): TrainingSession {
  return {
    id: `s:${date}:${exercises.map(e => e.name).join('+')}`,
    sourceId: 'test',
    title: 'Session',
    startTime: `${date}T18:00:00.000Z`,
    endTime: `${date}T18:30:00.000Z`,
    exercises: exercises.map(e => ({
      sourceTemplateId: null,
      name: e.name,
      loadMeaning: e.assisted ? 'assistance' : 'added',
      sets: e.sets.map((s, i) => ({ index: i, kind: 'normal', ...s })),
      ...(e.notes ? { notes: e.notes } : {}),
    })),
  };
}

const reps = (list: number[], rpe?: number[], weightKg?: number): Partial<TrainingSet>[] =>
  list.map((r, i) => ({ reps: r, ...(rpe ? { rpe: rpe[i] } : {}), ...(weightKg !== undefined ? { weightKg } : {}) }));

function plan(input: Record<string, unknown>): TrainingPlan {
  const v = validatePlan({
    title: 'Test plan',
    goal: 'Test',
    startDate: '2026-08-01',
    durationWeeks: 12,
    templates: [{ id: 'all', name: 'All', slots: [{ pathIds: ['push'] }] }],
    schedule: { kind: 'cycle', days: ['all', 'rest'] },
    ...input,
  });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.plan;
}

function run(p: TrainingPlan, sessions: TrainingSession[], today: string, extra: Partial<RoutineInputs> = {}) {
  return buildRoutine({
    stored: { id: 'plan-test', status: 'active', plan: p, revision: 1, createdAt: '', updatedAt: '' },
    sessions,
    workouts: [],
    series: () => [],
    today,
    dayOf,
    system: 'metric',
    ...extra,
  });
}

// The push-up progression from the routine design: floor push-ups at 3–4 × 10–15,
// then decline push-ups at 3–4 × 8–12, working at 1–3 reps in reserve (RPE 7–9).
const RIR = { rpe: [7, 9], rir: [1, 3] };
function pushPlan(extra: Record<string, unknown> = {}, pathExtra: Record<string, unknown> = {}) {
  return plan({
    focusAreas: [
      {
        id: 'upper',
        name: 'Push',
        paths: [
          {
            id: 'push',
            name: 'Horizontal push',
            currentStageId: 'decline',
            history: [
              { stageId: 'floor', startedOn: '2026-08-01' },
              { stageId: 'decline', startedOn: '2026-09-08' },
            ],
            stages: [
              { id: 'floor', name: 'Floor push-up', match: { names: ['Push Up'] }, advanceWhen: { sets: [3, 4], reps: [10, 15], effort: RIR } },
              { id: 'decline', name: 'Decline push-up', match: { names: ['Decline Push Up'] }, advanceWhen: { sets: [3, 4], reps: [8, 12], effort: RIR } },
              { id: 'close-grip', name: 'Close-grip push-up', match: { names: ['Diamond Push Up'] }, prescription: { sets: [3, 3], reps: [8, 12] } },
            ],
            ...pathExtra,
          },
        ],
      },
    ],
    rules: { qualifyingSessions: [2, 3], effort: RIR },
    ...extra,
  });
}

const EXAMPLE = [
  session('2026-08-25', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-08-28', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-09-04', [{ name: 'Push Up', sets: reps([15, 12, 9], [8, 8.5, 9]) }]),
  session('2026-09-08', [{ name: 'Decline Push Up', sets: reps([8, 8, 8], [7.5, 8, 8.5]) }]),
  session('2026-09-11', [{ name: 'Decline Push Up', sets: reps([12, 10, 8], [8, 9, 9.5]) }]),
  session('2026-09-15', [{ name: 'Decline Push Up', sets: reps([12, 11, 9], [8.5, 9, 9.5]) }]),
  session('2026-09-18', [{ name: 'Decline Push Up', sets: reps([12, 12, 10], [8.5, 9, 9.5]) }]),
];

// ── The worked example ──────────────────────────────────

describe('variation model on the decline push-up example', () => {
  const routine = run(pushPlan(), EXAMPLE, '2026-09-18');
  const push = routine.paths[0];

  it('reproduces the session table', () => {
    expect(push.rows.map(r => [r.dates.join(' / '), r.work, r.headline])).toEqual([
      ['2026-08-25 / 2026-08-28', 'Floor push-up 15/12/9', '36 reps'],
      ['2026-09-04', 'Floor push-up 15/12/9', '36 reps'],
      ['2026-09-08', 'Decline push-up 8/8/8', '24 reps'],
      ['2026-09-11', 'Decline push-up 12/10/8', '30 reps'],
      ['2026-09-15', 'Decline push-up 12/11/9', '32 reps'],
      ['2026-09-18', 'Decline push-up 12/12/10', '34 reps'],
    ]);
    expect(push.rows.map(r => r.signal).slice(1)).toEqual([
      'Final floor push-up session before progression',
      'Clean decline push-up entry',
      'Rapid volume increase',
      'New best',
      'Meets the progression marker',
    ]);
  });

  it('counts a set past the effort ceiling a rep short per RPE point', () => {
    // 12/12/10 at RPE 8.5/9/9.5 is judged as 12/12/9.5 at RPE 9: still within a step of the top.
    expect(push.light).toBe('yellow-green');
    expect(push.reasons[0]).toBe('1 of 2–3 qualifying sessions; one more at the marker earns the next stage.');
    expect(push.stage.name).toBe('Decline push-up');
    expect(push.nextStage?.name).toBe('Close-grip push-up');
    expect(push.readiness).toMatchObject({ qualifying: 1, needed: 2, met: false });
    expect(push.nextAction).toBe('Repeat 3–4 × 8–12 RPE 7–9 for 1 more session.');
  });

  it('lights yellow-green when effort past the ceiling costs the session the marker', () => {
    // 12/12/10 at RPE 9/9.5/10 is judged as 12/11.5/9: below the step from the top.
    const hard = [...EXAMPLE.slice(0, -1), session('2026-09-18', [{ name: 'Decline Push Up', sets: reps([12, 12, 10], [9, 9.5, 10]) }])];
    const p = run(pushPlan(), hard, '2026-09-18').paths[0];
    expect(p.rows[p.rows.length - 1].signal).toBe('Near top of range, effort high');
    expect(p.light).toBe('yellow-green');
    expect(p.reasons[0]).toContain('RPE 9–10, above the RPE 9 ceiling');
    expect(p.readiness).toMatchObject({ qualifying: 0, needed: 2, met: false });
    expect(p.nextAction).toBe(
      'Repeat 3×10–12 with consistent form and lower perceived effort for 2–3 sessions. Do not move on while sets are near failure.'
    );
  });

  it('turns green on top-of-range sets that went half a point past the ceiling', () => {
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 9, 9.5]) }])];
    const p = run(pushPlan(), more, '2026-09-22').paths[0];
    expect(p.light).toBe('green');
    expect(p.readiness?.met).toBe(true);
    expect(p.reasons[0]).toBe('The marker (3–4 × 8–12 RPE 7–9) was met in 2 of the last 3 sessions, counting a set a rep short for each RPE point past 9.');
  });

  it('marks the current stage complete once its marker is met, not before', () => {
    expect(push.stages.map(s => [s.status, s.complete])).toEqual([['done', true], ['current', false], ['upcoming', false]]);
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 9, 9.5]) }])];
    const p = run(pushPlan(), more, '2026-09-22').paths[0];
    expect(p.stages.map(s => [s.status, s.complete])).toEqual([['done', true], ['current', true], ['upcoming', false]]);
    expect(p.stage.complete).toBe(true);
  });

  it('keeps a complete stage complete while recovery caps the light', () => {
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 9, 9.5]) }])];
    const sleep = Array.from({ length: 7 }, (_, i) => ({ key: addDays('2026-09-22', i - 6), value: 5 * 60 }));
    const gated = pushPlan({ rules: { qualifyingSessions: [2, 3], effort: RIR, recoveryGates: [{ signal: 'sleep_hours', rule: 'below', threshold: 6, severity: 'warn' }] } });
    const p = run(gated, more, '2026-09-22', { series: id => (id === 'sleep_analysis' ? sleep : []) }).paths[0];
    expect(p.light).toBe('yellow');
    expect(p.stage.complete).toBe(true);
  });

  it('does not mark a stage complete while it has steps to go', () => {
    const stages = pushPlan().focusAreas[0].paths[0].stages.map(s =>
      s.id === 'decline' ? { ...s, steps: [{ name: 'Feet on a bench', advanceWhen: s.advanceWhen }, { name: 'Feet on a box' }] } : s
    );
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 9, 9.5]) }])];
    const onFirst = run(pushPlan({}, { stages, currentStepIndex: 0 }), more, '2026-09-22').paths[0];
    expect(onFirst.readiness?.met).toBe(true);
    expect(onFirst.stage.complete).toBe(false);
  });

  it('fills the bar toward the marker, not just by qualifying sessions', () => {
    // 12/12/10 reaches the marker's volume and qualifies once; RPE 9.5 is half a point past the ceiling.
    expect(push.readiness!.progress).toBeCloseTo(0.925, 3);
    const decline = (d: string, r: number[], rpe: number[]) => session(d, [{ name: 'Decline Push Up', sets: reps(r, rpe) }]);
    const progress = (sessions: TrainingSession[]) => run(pushPlan(), sessions, '2026-09-18').paths[0].readiness!.progress;
    const early = progress([decline('2026-09-08', [6, 6, 6], [7, 7, 7])]);
    expect(early).toBeGreaterThan(0.3);
    expect(early).toBeLessThan(0.5);
    expect(progress([decline('2026-09-08', [12, 12, 11], [8, 8, 8.5])])).toBeCloseTo(0.95, 3);
    expect(progress([decline('2026-09-08', [12, 12, 11], [8, 8, 8.5]), decline('2026-09-11', [12, 12, 12], [8, 8, 8])])).toBe(1);
  });

  it('turns green and moves on once the marker is met at the target effort', () => {
    const more = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
    ];
    const p = run(pushPlan(), more, '2026-09-25').paths[0];
    expect(p.light).toBe('green');
    expect(p.readiness?.met).toBe(true);
    expect(p.nextAction).toMatch(/^Move to close-grip push-up: start at 3 × 8–12/);
  });

  it('turns red when performance falls two sessions running', () => {
    const worse = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([10, 9, 8], [9, 9, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([9, 8, 6], [9, 9.5, 10]) }]),
    ];
    const p = run(pushPlan(), worse, '2026-09-25').paths[0];
    expect(p.light).toBe('red');
    expect(p.nextAction).toMatch(/drop a set/);
  });

  it('reports nothing logged for a stage with no sessions', () => {
    const p = run(pushPlan({}, { currentStageId: 'close-grip', history: [{ stageId: 'close-grip', startedOn: '2026-09-20' }] }), EXAMPLE, '2026-09-21').paths[0];
    expect(p.light).toBe('none');
    expect(p.nextAction).toMatch(/^Start close-grip push-up/);
  });
});

// ── Shared overrides ────────────────────────────────────

describe('holds, recovery gates and deloads', () => {
  it('a hold caps the light at yellow and replaces the advice', () => {
    const p = run(pushPlan({}, { hold: { kind: 'hold', reason: 'mild shoulder discomfort', since: '2026-09-16' } }), EXAMPLE, '2026-09-18').paths[0];
    expect(p.light).toBe('yellow');
    expect(p.reasons[0]).toBe('On hold since 2026-09-16: mild shoulder discomfort');
    expect(p.nextAction).toMatch(/do not progress until "mild shoulder discomfort" has resolved/);
  });

  it('a regress hold turns the light red', () => {
    const p = run(pushPlan({}, { hold: { kind: 'regress', reason: 'elbow pain', since: '2026-09-16' } }), EXAMPLE, '2026-09-18').paths[0];
    expect(p.light).toBe('red');
    expect(p.nextAction).toMatch(/^Step back to floor push-up/);
  });

  it('a warn-level recovery gate caps the light at yellow', () => {
    const sleep = Array.from({ length: 7 }, (_, i) => ({ key: `2026-09-${String(12 + i).padStart(2, '0')}`, value: 5 * 60 }));
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], effort: RIR, recoveryGates: [{ signal: 'sleep_hours', rule: 'below', threshold: 6, severity: 'warn' }] } });
    const routine = run(p, EXAMPLE, '2026-09-18', { series: id => (id === 'sleep_analysis' ? sleep : []) });
    expect(routine.recovery.status).toBe('warn');
    expect(routine.paths[0].light).toBe('yellow');
    expect(routine.paths[0].heldBack).toEqual(['recovery']);
    expect(routine.paths[0].reasons.some(r => r.startsWith('Sleep: 5 h'))).toBe(true);
  });

  it('a body-weight gate is a callout only: it caps no light', () => {
    // Losing about 1 kg a week, past a warn-level gate at -0.5 kg/week.
    const weight = Array.from({ length: 28 }, (_, i) => ({ key: addDays('2026-09-18', i - 27), value: 80 - i / 7 }));
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }])];
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], effort: RIR, recoveryGates: [{ signal: 'body_weight_rate', rule: 'below', threshold: -0.5, severity: 'warn' }] } });
    const routine = run(p, more, '2026-09-22', { series: id => (id === 'weight_body_mass' ? weight : []) });
    expect(routine.recovery.indicators.find(i => i.signal === 'body_weight_rate')?.status).toBe('warn');
    expect(routine.recovery.status).toBe('unknown');
    expect(routine.recovery.text).toMatch(/Body-weight trend is outside the plan’s range \(a callout only; it does not hold progression\)\.$/);
    expect(routine.paths[0].light).toBe('green');
    expect(routine.paths[0].heldBack).toEqual([]);
    expect(routine.paths[0].nextAction).toMatch(/^Move to close-grip push-up/);
  });

  it('holds nothing back while recovery is inside the limits and no deload is due', () => {
    const p = run(pushPlan(), EXAMPLE, '2026-09-18').paths[0];
    expect(p.heldBack).toEqual([]);
  });

  it('a deload block replaces "move on" advice', () => {
    const more = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
    ];
    const p = run(pushPlan({ blocks: [{ name: 'Deload week', startWeek: 8, weeks: 1, kind: 'deload' }] }), more, '2026-09-25').paths[0];
    expect(p.light).toBe('green');
    expect(p.heldBack).toEqual(['deload']);
    expect(p.nextAction).toMatch(/^Deload week: keep decline push-up and cut sets/);
  });
});

// ── Other models ────────────────────────────────────────

function liftPlan(model: string, stage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return plan({
    focusAreas: [{ name: 'Lifts', paths: [{ id: 'push', name: 'Bench', model, stages: [{ id: 'bench', name: 'Bench press', match: { names: ['Bench Press (Barbell)'] }, ...stage }] }] }],
    rules: { qualifyingSessions: [1, 1] },
    ...extra,
  });
}

describe('load model', () => {
  const stage = { prescription: { sets: [3, 3], reps: [5, 5], effort: { rpe: [7, 8.5] } } };

  it('adds the increment once every set reaches the top at the target effort', () => {
    const p = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [7, 8, 8.5], 80) }])], '2026-09-11').paths[0];
    expect(p.light).toBe('green');
    expect(p.rows[0].work).toBe('Bench press 3×5 @ 80 kg');
    expect(p.rows[0].headline).toBe('e1RM 93.5 kg');
    expect(p.nextAction).toBe('Add 2.5 kg: next session 82.5 kg for 3×5.');
  });

  it('holds when reps are made but effort was too high, and backs off after two misses', () => {
    const hard = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [8.5, 9, 9.5], 80) }])], '2026-09-11').paths[0];
    expect(hard.light).toBe('yellow-green');
    expect(hard.readiness!.progress).toBeCloseTo(0.85, 3);
    const missed = run(liftPlan('load', stage), [
      session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 4, 3], [9, 10, 10], 85) }]),
      session('2026-09-13', [{ name: 'Bench Press (Barbell)', sets: reps([5, 3, 3], [9, 10, 10], 85) }]),
    ], '2026-09-14').paths[0];
    expect(missed.light).toBe('red');
    // One-session window: 5/3/3 is 11 of 15 reps, and RPE 10 leaves a quarter of the effort share.
    expect(missed.readiness!.progress).toBeCloseTo((11 / 15) * (0.8 + 0.1 * 0.25), 3);
    expect(missed.nextAction).toBe('Back off 10% to 77.5 kg for 3×5 and build up again.');
  });

  it('shows loads in pounds for an imperial reader', () => {
    const p = run(liftPlan('load', stage), [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([5, 5, 5], [7, 8, 8], 100) }])], '2026-09-11', { system: 'imperial' }).paths[0];
    expect(p.rows[0].work).toBe('Bench press 3×5 @ 220 lb');
  });
});

describe('percentage model', () => {
  it('prescribes from the running block and checks the sessions against it', () => {
    const p = liftPlan('percentage', { prescription: { sets: [3, 3], reps: [3, 3] } }, {
      blocks: [{ name: 'Peak', startWeek: 1, weeks: 12, kind: 'peak', targets: [{ pathId: 'push', label: 'Bench 3×3 @ 85–90%', dose: { sets: [3, 3], reps: [3, 3], load: { pct1rm: [85, 90] } } }] }],
    });
    (p.focusAreas[0].paths[0] as { params?: Record<string, unknown> }).params = { oneRepMaxKg: 100 };
    const r = run(p, [session('2026-09-10', [{ name: 'Bench Press (Barbell)', sets: reps([3, 3, 3], [8, 8, 8.5], 87.5) }])], '2026-09-11').paths[0];
    expect(r.nextAction).toBe('Next: 3 × 3 @ 85–90% 1RM (≈ 85–90 kg).');
    expect(r.rows[0].signal).toBe('On target');
    expect(r.light).toBe('green');
  });
});

describe('volume model', () => {
  const runPlan = plan({
    focusAreas: [{ name: 'Running', paths: [{ id: 'push', name: 'Weekly volume', model: 'volume', params: { metric: 'distanceM', maxWeeklyIncreasePct: 10 },
      stages: [{ id: 'base', name: 'Base', match: { names: [], workoutTypes: ['Running'] }, prescription: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } }, advanceWhen: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } } }] }] }],
    rules: { qualifyingSessions: [2, 2] },
    startDate: '2026-08-03',
  });
  const run_ = (id: string, date: string, km: number): WorkoutRecord => ({
    id, workout_type: 'Running', start_time: `${date}T12:00:00.000Z`, end_time: `${date}T12:50:00.000Z`,
    duration_minutes: km * 5.5, calories_burned: 400, source: 'Apple Watch', distance_km: km,
  });

  it('flags a week that ramps faster than the plan allows', () => {
    const workouts = [run_('a', '2026-09-01', 8), run_('b', '2026-09-03', 8), run_('c', '2026-09-08', 10), run_('d', '2026-09-10', 12)];
    const p = run(runPlan, [], '2026-09-15', { workouts }).paths[0];
    expect(p.light).toBe('yellow');
    expect(p.reasons[0]).toBe('Last week was 38% above the week before; the plan allows 10%.');
    expect(p.readiness!.progress).toBeCloseTo(0.95, 3);
    expect(p.rows.map(r => r.work)).toEqual(['Week of Aug 31: 16 km', 'Week of Sep 7: 22 km', 'Week of Sep 14: 0 km']);
  });

  it('turns green after enough weeks on target', () => {
    const workouts = [run_('a', '2026-09-01', 10), run_('b', '2026-09-03', 11), run_('c', '2026-09-08', 11), run_('d', '2026-09-10', 11)];
    const p = run(runPlan, [], '2026-09-15', { workouts }).paths[0];
    expect(p.readiness).toMatchObject({ qualifying: 2, met: true, unit: 'weeks' });
    expect(p.light).toBe('green');
  });
});

describe('maintain model', () => {
  it('is green inside the range and yellow below it', () => {
    const p = plan({
      focusAreas: [{ name: 'Mobility', paths: [{ id: 'push', name: 'Hang', model: 'maintain', stages: [{ name: 'Dead hang', match: { names: ['Dead Hang'] }, prescription: { sets: [3, 3], holdS: [30, 60] } }] }] }],
    });
    const hold = (d: string, s: number[]) => session(d, [{ name: 'Dead Hang', sets: s.map(x => ({ durationS: x })) }]);
    expect(run(p, [hold('2026-09-10', [40, 35, 30])], '2026-09-11').paths[0].light).toBe('green');
    expect(run(p, [hold('2026-09-10', [40, 35, 20])], '2026-09-11').paths[0].light).toBe('yellow');
  });
});

// ── Schedule ────────────────────────────────────────────

describe('schedule', () => {
  const templates = [
    { id: 'a', name: 'Upper', slots: [{ pathIds: ['push'] }, { pathIds: ['push', 'pull'], optional: true, rotate: true }] },
    { id: 'b', name: 'Lower', slots: [{ pathIds: ['legs'] }] },
  ];
  const areas = [{ name: 'All', paths: [
    { id: 'push', name: 'Push', stages: [{ name: 'Push up', match: { names: ['Push Up'] } }] },
    { id: 'pull', name: 'Pull', stages: [{ name: 'Row', match: { names: ['Row'] } }] },
    { id: 'legs', name: 'Legs', stages: [{ name: 'Squat', match: { names: ['Squat'] } }] },
  ] }];
  const withSchedule = (schedule: unknown, extra: Record<string, unknown> = {}) => plan({ focusAreas: areas, templates, schedule, startDate: '2026-09-01', ...extra });
  const upper = (d: string) => session(d, [{ name: 'Push Up', sets: reps([10]) }]);
  const lower = (d: string) => session(d, [{ name: 'Squat', sets: reps([10]) }]);
  const next = (p: TrainingPlan, sessions: TrainingSession[], today: string) =>
    nextSession(p, completedSessions(p, sessions, [], dayOf), today, planWeek(p, today), 'metric');

  it('A/B/rest on completion follows what was actually done', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'] });
    expect(next(p, [upper('2026-09-10')], '2026-09-11').due.label).toBe('Lower');
    // B yesterday → today is the rest day; B two days ago → the rest day passed.
    expect(next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-12').due.kind).toBe('rest');
    expect(next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-13').due.label).toBe('Upper');
    const today = next(p, [upper('2026-09-10'), lower('2026-09-11')], '2026-09-11');
    expect(today.doneToday).toBe(true);
    expect(today.due.kind).toBe('rest');
    expect(today.today?.label).toBe('Lower');
  });

  it('rotates an optional slot session to session', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b'] });
    const first = next(p, [], '2026-09-02').due.templates[0].slots[1];
    const second = next(p, [upper('2026-09-02'), lower('2026-09-03')], '2026-09-04').due.templates[0].slots[1];
    expect([first.pathId, second.pathId]).toEqual(['push', 'pull']);
    // Today's session shows the slots as trained, not the next rotation.
    expect(next(p, [upper('2026-09-02'), lower('2026-09-03'), upper('2026-09-04')], '2026-09-04').today?.templates[0].slots[1].pathId).toBe('pull');
    expect(second.optional).toBe(true);
  });

  it('on/off and every-day cycles', () => {
    const onOff = withSchedule({ kind: 'cycle', days: ['a', 'rest'] });
    expect(next(onOff, [upper('2026-09-10')], '2026-09-11').due.kind).toBe('rest');
    expect(next(onOff, [upper('2026-09-10')], '2026-09-12').due.label).toBe('Upper');
    const daily = withSchedule({ kind: 'cycle', days: ['a'] });
    expect(next(daily, [upper('2026-09-10')], '2026-09-11').due.label).toBe('Upper');
  });

  it('calendar cycles count from the anchor', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'], advance: 'calendar', anchorDate: '2026-09-01' });
    expect(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(d => next(p, [], d).due.label)).toEqual(['Upper', 'Lower', 'Rest day', 'Upper']);
  });

  it('calendar cycles move on to the next training day once today is logged', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'], advance: 'calendar', anchorDate: '2026-09-01' });
    const done = next(p, [lower('2026-09-02')], '2026-09-02');
    expect(done.due.label).toBe('Upper');
    expect(done.upcoming.map(d => d.label)).toEqual(['Lower', 'Rest day', 'Upper']);
  });

  it('fixed weekdays', () => {
    const p = withSchedule({ kind: 'weekdays', days: { mon: 'a', thu: 'b' } });
    // 2026-09-14 is a Monday.
    expect(next(p, [], '2026-09-14').due.label).toBe('Upper');
    expect(next(p, [], '2026-09-15').due.kind).toBe('rest');
    expect(next(p, [], '2026-09-15').upcoming[0].label).toBe('Thu: Lower');
    // Monday's session logged: Thursday is next, and Monday is only coming up again.
    const done = next(p, [upper('2026-09-14')], '2026-09-14');
    expect(done.due.label).toBe('Thu: Lower');
    expect(done.upcoming.map(d => d.label)).toEqual(['Mon: Upper', 'Thu: Lower']);
    expect(done.why).toBe('Already trained today; Thu is next in the weekly schedule.');
    expect(done.today?.label).toBe('Upper');
    expect(next(p, [], '2026-09-14').today).toBeNull();
  });

  it('N sessions a week rests once the week is full', () => {
    const p = withSchedule({ kind: 'frequency', sessionsPerWeek: [2, 3], rotation: ['a', 'b'] });
    expect(next(p, [upper('2026-09-14')], '2026-09-15').due.label).toBe('Lower');
    const full = next(p, [upper('2026-09-14'), lower('2026-09-15'), upper('2026-09-16')], '2026-09-17');
    expect(full.due.kind).toBe('rest');
    expect(full.why).toBe('3 of 2–3 sessions this week.');
  });

  it('a block can override the schedule', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b'] }, {
      blocks: [{ name: 'Deload', startWeek: 2, weeks: 1, kind: 'deload', scheduleOverride: { kind: 'weekdays', days: { wed: 'a' } } }],
    });
    expect(next(p, [], '2026-09-09').scheduleKind).toBe('weekdays');
  });

  it('adherence compares logged with planned sessions', () => {
    const p = withSchedule({ kind: 'cycle', days: ['a', 'b', 'rest'] });
    const done = completedSessions(p, [upper('2026-09-10'), lower('2026-09-11')], [], dayOf);
    const a = adherence(p, done, '2026-09-14', planWeek(p, '2026-09-14'));
    expect(a).toMatchObject({ windowDays: 14, planned: 9, completed: 2, status: 'watch' });
  });
});

// ── Plan-level views ────────────────────────────────────

describe('phases', () => {
  const phased = (phases: unknown[]) => pushPlan({ phases });

  it('puts the reader in the first phase whose milestones are not all met, whatever the date', () => {
    const p = phased([
      { name: 'Foundation', targets: [{ pathId: 'push', stageId: 'floor', label: 'Floor push-ups mastered' }] },
      { name: 'Declines', expectedWeeks: [3, 5], targets: [
        { pathId: 'push', stageId: 'decline', reach: 'started', label: 'Decline push-ups' },
        { pathId: 'push', stageId: 'decline', label: 'Decline push-ups mastered' },
      ] },
      { name: 'Close grip', targets: [{ pathId: 'push', stageId: 'close-grip', reach: 'started', label: 'Close-grip push-ups' }] },
    ]);
    // Far into the plan by the calendar; the data still says phase 2.
    const r = run(p, EXAMPLE, '2026-10-20');
    expect(r.phases.map(x => x.status)).toEqual(['complete', 'current', 'upcoming']);
    expect(r.currentPhase).toMatchObject({ index: 1, name: 'Declines', since: '2026-09-08', progress: { met: 1, total: 2 } });
    expect(r.phases[0].completedOn).toBe('2026-09-08');
    expect(r.phases[1].targets.map(t => t.met)).toEqual([true, false]);
    // Begun is not done: both decline targets show in progress until the stage is mastered.
    expect(r.phases[1].targets.map(t => [t.state, t.stateOn])).toEqual([
      ['in-progress', '2026-09-08'],
      ['in-progress', '2026-09-08'],
    ]);
    expect(r.phases[0].targets[0]).toMatchObject({ state: 'done', stateOn: '2026-09-08' });
    expect(r.phases[2].targets[0]).toMatchObject({ state: 'not-started', stateOn: null });
  });

  it('moves on once the stage is mastered, and optional or unverifiable targets never hold a phase open', () => {
    const more = [
      ...EXAMPLE,
      session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
      session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
    ];
    const p = phased([
      { name: 'Declines', targets: [
        { pathId: 'push', stageId: 'decline', label: 'Decline push-ups mastered' },
        { pathId: 'push', dose: { sets: [3, 3], reps: [20, 25] }, label: '3×20 push-ups', optional: true },
      ] },
      { name: 'Mobility', goals: ['Stretch daily'], targets: [{ label: 'Daily stretching' }] },
      { name: 'Close grip', targets: [{ pathId: 'push', stageId: 'close-grip', reach: 'started', label: 'Close-grip push-ups' }] },
    ]);
    const r = run(p, more, '2026-09-25');
    expect(r.phases.map(x => x.status)).toEqual(['complete', 'current', 'upcoming']);
    const all = run(p, more, '2026-09-25').phases[0];
    expect(all.progress).toEqual({ met: 1, total: 1 });
  });

  it('checks a dose on the named stage only, or on any stage without one', () => {
    const p = phased([{ name: 'Volume', targets: [
      { pathId: 'push', dose: { sets: [3, 3], reps: [12, 15] }, label: 'any stage 3×12' },
      { pathId: 'push', stageId: 'decline', dose: { sets: [3, 3], reps: [12, 15] }, label: 'decline 3×12' },
      { pathId: 'push', stageId: 'floor', dose: { sets: [3, 3], reps: [15, 20] }, label: 'floor 3×15' },
    ] }]);
    // Floor 15/12/9 misses 3×12; declines reach 12/12/10 → still not every set at 12.
    expect(run(p, EXAMPLE, '2026-09-18').phases[0].targets.map(t => t.met)).toEqual([false, false, false]);
    const more = [...EXAMPLE, session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8, 8]) }])];
    expect(run(p, more, '2026-09-22').phases[0].targets.map(t => t.met)).toEqual([true, true, false]);
    // A dose not yet reached is in progress once its stage has sessions.
    expect(run(p, more, '2026-09-22').phases[0].targets.map(t => t.state)).toEqual(['done', 'done', 'in-progress']);
  });

  it('does not count a first stage as started until something is logged on it', () => {
    const p = phased([{ name: 'Start', targets: [{ pathId: 'push', stageId: 'floor', reach: 'started', label: 'Floor push-ups' }] }]);
    const fresh = pushPlan({ phases: p.phases }, { currentStageId: 'floor', history: [] });
    expect(run(fresh, [], '2026-09-18').phases[0].targets[0].met).toBe(false);
    expect(run(fresh, EXAMPLE.slice(0, 1), '2026-09-18').phases[0].targets[0]).toMatchObject({ met: true, metOn: '2026-08-25' });
  });

  it('rejects a phase target on a stage the path does not have', () => {
    const v = validatePlan({ ...pushPlan(), phases: [{ name: 'X', targets: [{ pathId: 'push', stageId: 'nope', label: 'x' }] }] });
    expect(v.ok ? [] : v.errors).toEqual([expect.stringContaining('"nope" is not a stage of path "push"')]);
  });
});

describe('plan position and deloads', () => {
  it('reports the week, block status and target checks', () => {
    const p = pushPlan({
      blocks: [
        { name: 'Month 1', startWeek: 1, weeks: 4, targets: [
          { pathId: 'push', label: 'Push-ups 3×10–15', dose: { sets: [3, 3], reps: [10, 15] } },
          { pathId: 'push', label: 'Push-ups 3×16–20', dose: { sets: [3, 3], reps: [16, 20] } },
        ] },
        { name: 'Month 2', startWeek: 5, weeks: 4 },
        { name: 'Month 3', startWeek: 9, weeks: 4 },
      ],
    });
    const r = run(p, EXAMPLE, '2026-09-18');
    expect(r.week).toBe(7);
    // Blocks are calendar periods: past / current / future, never "behind".
    expect(r.blocks.map(b => b.status)).toEqual(['past', 'current', 'future']);
    // Any stage of the path counts: 12/12/10 decline push-ups meet 3×10–15; nothing reached 16.
    expect(r.blocks[0].targets.map(t => t.met)).toEqual([true, false]);
  });

  it('deloads fall due by the plan rule', () => {
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], deload: { everyWeeks: [4, 6], volumeReduction: [0.3, 0.5] } } });
    expect(deloadStatus(p, '2026-08-20').status).toBe('ok');
    expect(deloadStatus(p, '2026-09-01').status).toBe('due');
    expect(deloadStatus(p, '2026-09-18').status).toBe('overdue');
    expect(deloadStatus({ ...p, deloads: ['2026-09-07'] }, '2026-09-18').status).toBe('ok');
    expect(deloadStatus(p, '2026-09-18').rule).toEqual({ everyWeeks: [4, 6], volumeReduction: [0.3, 0.5] });
    expect(deloadStatus(pushPlan(), '2026-09-18')).toMatchObject({ status: 'none', rule: null });
  });

  it('a recorded or detected deload runs for a week', () => {
    const p = pushPlan({ rules: { qualifyingSessions: [2, 3], deload: { everyWeeks: [4, 6], volumeReduction: [0.3, 0.5] } } });
    expect(deloadStatus({ ...p, deloads: ['2026-09-29'] }, '2026-10-05')).toMatchObject({ status: 'in-deload', window: { source: 'recorded', to: '2026-10-05' } });
    expect(deloadStatus({ ...p, deloads: ['2026-09-29'] }, '2026-10-06')).toMatchObject({ status: 'ok', lastDeload: '2026-09-29' });
    expect(deloadStatus(p, '2026-09-30', ['2026-09-29'])).toMatchObject({ status: 'in-deload', window: { source: 'detected' } });
  });
});

describe('deload sessions pause progress', () => {
  // Decline push-ups and assisted pull-ups, trained together.
  const pushPull = () => {
    const base = pushPlan();
    return plan({
      focusAreas: [
        ...base.focusAreas,
        {
          id: 'back',
          name: 'Pull',
          paths: [
            {
              id: 'pull',
              name: 'Pull-up',
              currentStageId: 'assisted',
              history: [{ stageId: 'assisted', startedOn: '2026-09-08' }],
              stages: [{ id: 'assisted', name: 'Assisted pull-up', match: { names: ['Pull Up'] }, advanceWhen: { sets: [3, 4], reps: [5, 8], effort: RIR } }],
            },
          ],
        },
      ],
      templates: [{ id: 'all', name: 'All', slots: [{ pathIds: ['push'] }, { pathIds: ['pull'] }] }],
      rules: { qualifyingSessions: [2, 3], effort: RIR, deload: { everyWeeks: [4, 6], volumeReduction: [0.3, 0.5] } },
    });
  };
  const day = (date: string, push: number[], pushRpe: number, pull: number[], pullRpe: number) =>
    session(date, [
      { name: 'Decline Push Up', sets: reps(push, push.map(() => pushRpe)) },
      { name: 'Pull Up', sets: reps(pull, pull.map(() => pullRpe)) },
    ]);
  const before = [
    day('2026-09-18', [12, 12, 10], 9.5, [5, 5, 4], 9.5),
    day('2026-09-22', [12, 12, 10], 9.5, [5, 5, 5], 9.5),
    day('2026-09-25', [12, 12, 11], 9.5, [6, 6, 5], 9.5),
  ];
  const deloadDay = day('2026-09-29', [8, 8, 8], 7.5, [4, 4, 4], 7.5);

  it('labels the previous stage\'s deload sessions after the path moves on', () => {
    const ready = [
      day('2026-09-18', [12, 12, 11], 9, [5, 5, 4], 9),
      day('2026-09-22', [12, 12, 11], 9, [5, 5, 5], 9),
      day('2026-09-25', [12, 12, 12], 9, [6, 6, 5], 9),
    ];
    const eased = [day('2026-09-29', [8, 8, 8], 7.5, [4, 4, 4], 7.5), day('2026-10-02', [8, 8, 8], 7.5, [4, 4, 4], 7.5)];
    const next = session('2026-10-06', [{ name: 'Diamond Push Up', sets: reps([8, 8, 8], [8, 8, 8]) }, { name: 'Pull Up', sets: reps([6, 6, 6], [8, 8, 8]) }]);
    const push = run(pushPull(), [...ready, ...eased, next], '2026-10-06').paths[0];
    expect(push.stage).toMatchObject({ id: 'close-grip', startedOn: '2026-10-06' });
    const signal = (date: string) => push.rows.find(r => r.dates.includes(date))?.signal;
    expect(signal('2026-09-29')).toBe('Deload session · progress paused');
    expect(signal('2026-10-02')).toBe('Final decline push-up session before progression');
  });

  it('reads the deload from the sessions and keeps the pre-deload light', () => {
    const withDeload = run(pushPull(), [...before, deloadDay], '2026-09-29');
    const without = run(pushPull(), before, '2026-09-29');
    expect(withDeload.deload).toMatchObject({ status: 'in-deload', lastDeload: '2026-09-29', window: { source: 'detected' } });
    const push = withDeload.paths.find(p => p.pathId === 'push')!;
    expect(push.light).toBe(without.paths.find(p => p.pathId === 'push')!.light);
    // Yellow-green before the deload: paused, but not "ready to move on after the deload".
    expect(push.heldBack).not.toContain('deload');
    expect(push.reasons[0]).toMatch(/^Deload since Sep 29/);
    expect(push.rows[push.rows.length - 1].signal).toBe('Deload session · progress paused');
  });

  it('judges the first session after the deload against the ones before it', () => {
    const r = run(pushPull(), [...before, deloadDay, day('2026-10-07', [12, 12, 12], 8.5, [6, 6, 6], 9)], '2026-10-07');
    expect(r.deload.status).toBe('ok');
    const push = r.paths.find(p => p.pathId === 'push')!;
    expect(push.heldBack).not.toContain('deload');
    // Not "New best" off an 8/8/8 deload session: 12/12/12 meets the marker.
    expect(push.rows[push.rows.length - 1].signal).toBe('Meets the progression marker');
  });

  it('still calls fewer reps at the same effort a regression', () => {
    const r = run(pushPull(), [...before, day('2026-09-29', [8, 8, 8], 9.5, [4, 4, 4], 9.5)], '2026-09-29');
    expect(r.deload.status).not.toBe('in-deload');
    const push = r.paths.find(p => p.pathId === 'push')!;
    expect(push.rows[push.rows.length - 1].signal).not.toMatch(/Deload/);
  });
});

describe('exercise matching', () => {
  it('treats "Pull Ups" and "Pull Up" as the same exercise', async () => {
    const { nameKey } = await import('./records');
    expect(nameKey('Scapular Pull Ups')).toBe(nameKey('Scapular Pull Up'));
    expect(nameKey('Push Ups')).toBe(nameKey('push-up'));
    expect(nameKey('Press')).toBe('press');
  });

  it('shows every stage of the path, labelling work done alongside the current stage', () => {
    const p = pushPlan();
    const both = [...EXAMPLE, session('2026-09-22', [
      { name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 9, 9]) },
      { name: 'Push Up', sets: reps([15, 15, 12], [7, 7.5, 8]) },
    ])];
    const path = run(p, both, '2026-09-22').paths[0];
    // One row per day: the current stage leads, the other stage's work sits under it.
    const last = path.rows[path.rows.length - 1];
    expect(last.dates).toEqual(['2026-09-22']);
    expect(last.work).toBe('Decline push-up 12/12/11');
    expect(last.also?.map(a => a.work)).toEqual(['Floor push-up 15/15/12']);
    expect(last.also?.[0].signal).toMatch(/^Alongside the current stage · /);
    expect(new Set(path.rows.flatMap(r => r.dates)).size).toBe(path.rows.flatMap(r => r.dates).length);
    // The light still judges only the current stage.
    expect(path.stage.name).toBe('Decline push-up');
    expect(path.lastSession?.work).toBe('Decline push-up 12/12/11');
  });

  it('ignores a "(Bodyweight)" qualifier but keeps other equipment distinct', () => {
    const p = pushPlan({}, { currentStageId: 'decline', history: [] });
    const logged = (name: string) => [session('2026-09-10', [{ name, sets: reps([10, 10, 10]) }])];
    expect(run(p, logged('Decline Push Up (Bodyweight)'), '2026-09-11').paths[0].rows).toHaveLength(1);
    expect(run(p, logged('Decline Push Up (Weighted)'), '2026-09-11').paths[0].rows).toHaveLength(0);
  });
});

describe('inferCurrentStages', () => {
  it('places each path on the furthest stage trained recently, with history', () => {
    const p = pushPlan({}, { currentStageId: 'floor', history: [] });
    const { plan: inferred, changes } = inferCurrentStages(p, EXAMPLE, [], dayOf, '2026-09-18');
    const path = inferred.focusAreas[0].paths[0];
    expect(path.currentStageId).toBe('decline');
    expect(path.history.map(h => [h.stageId, h.startedOn])).toEqual([
      ['floor', '2026-08-25'],
      ['decline', '2026-09-08'],
    ]);
    expect(changes).toEqual(['Horizontal push: Decline push-up (since 2026-09-08)']);
  });
});

describe('moving on from logged sessions', () => {
  // Decline push-ups mastered: 2 qualifying sessions after the worked example.
  const MASTERED = [
    ...EXAMPLE,
    session('2026-09-22', [{ name: 'Decline Push Up', sets: reps([12, 12, 11], [8, 8.5, 9]) }]),
    session('2026-09-25', [{ name: 'Decline Push Up', sets: reps([12, 12, 12], [8, 8.5, 9]) }]),
  ];
  const diamond = (date: string) => session(date, [{ name: 'Diamond Push Up', sets: reps([8, 8, 8], [8, 8, 8]) }]);
  const started = { phases: [{ name: 'Close grip', targets: [{ pathId: 'push', stageId: 'close-grip', reach: 'started', label: 'Close-grip push-ups' }] }] };

  it('moves to the next stage once its marker is met and the next stage is logged', () => {
    const r = run(pushPlan(started), [...MASTERED, diamond('2026-09-29')], '2026-09-29');
    const push = r.paths[0];
    expect(push.stage).toMatchObject({ id: 'close-grip', startedOn: '2026-09-29' });
    expect(push.stages.map(s => s.status)).toEqual(['done', 'done', 'current']);
    expect(push.rows.map(row => row.signal)).toContain('Final decline push-up session before progression');
    expect(push.lastSession?.work).toBe('Close-grip push-up 8/8/8');
    expect(r.phases[0].targets[0]).toMatchObject({ met: true, metOn: '2026-09-29', state: 'in-progress', stateOn: '2026-09-29' });
  });

  it('keeps a try at the next stage before the marker is met as work ahead', () => {
    const r = run(pushPlan(started), [...EXAMPLE, diamond('2026-09-20')], '2026-09-20');
    const push = r.paths[0];
    expect(push.stage.id).toBe('decline');
    expect(push.rows[push.rows.length - 1].signal).toMatch(/^Ahead of the current stage · /);
    expect(r.phases[0].targets[0].met).toBe(false);
  });

  it('moves on from the first next-stage session after the marker is met', () => {
    const push = run(pushPlan(), [...MASTERED, diamond('2026-09-20'), diamond('2026-09-29')], '2026-09-29').paths[0];
    expect(push.stage).toMatchObject({ id: 'close-grip', startedOn: '2026-09-29' });
    // The early try still shows, labelled as before the stage began.
    const early = push.rows.flatMap(row => [row, ...(row.also ?? [])]).find(row => row.dates.includes('2026-09-20') && row.stageId === 'close-grip');
    expect(early?.signal).toMatch(/^Tried before this stage began · /);
  });

  it('leaves a path on hold where it is', () => {
    const hold = { hold: { kind: 'hold', reason: 'elbow ache', since: '2026-09-26' } };
    expect(run(pushPlan({}, hold), [...MASTERED, diamond('2026-09-29')], '2026-09-29').paths[0].stage.id).toBe('decline');
  });

  it('does not store the move: the plan keeps its own current stage', () => {
    const p = pushPlan();
    run(p, [...MASTERED, diamond('2026-09-29')], '2026-09-29');
    expect(p.focusAreas[0].paths[0].currentStageId).toBe('decline');
  });
});

// ── No workout source ───────────────────────────────────

describe('without a workout source', () => {
  const noSource = { exerciseData: false };

  it('marks a path matched by exercise as not tracked, rather than as nothing logged', () => {
    const r = run(pushPlan(), [], '2026-09-21', noSource);
    const p = r.paths[0];
    expect(r.exerciseData).toBe(false);
    expect(p.tracked).toBe(false);
    expect(p.light).toBe('none');
    expect(p.readiness).toBeNull();
    expect(p.reasons).toEqual([expect.stringMatching(/no workout source \(such as Hevy\) is connected/)]);
    // The stage's own guidance is still given, without assuming it hasn't begun.
    expect(p.nextAction).toBe('Train decline push-up at 3–4 × 8–12 RPE 7–9.');
    expect(r.workouts[0].domains[0].slots[0]).toMatchObject({ tracked: false, suggestion: null });
  });

  it('does not count sessions it cannot see as missed', () => {
    const counted = run(pushPlan(), [], '2026-09-21').adherence;
    expect(counted.status).toBe('watch');
    const unseen = run(pushPlan(), [], '2026-09-21', noSource).adherence;
    expect(unseen).toMatchObject({ status: 'unknown', ratio: null, completed: 0 });
    expect(unseen.text).toMatch(/not counted/);
  });

  it('keeps a hold the reader set', () => {
    const hold = { kind: 'hold', since: '2026-09-15', reason: 'Sore wrist' };
    const p = run(pushPlan({}, { hold }), [], '2026-09-21', noSource).paths[0];
    expect(p.tracked).toBe(false);
    expect(p.hold).toMatchObject({ reason: 'Sore wrist' });
    expect(p.reasons[0]).toMatch(/Sore wrist/);
    expect(p.reasons[1]).toMatch(/no workout source/);
    expect(p.nextAction).toMatch(/Sore wrist/);
  });

  it('still judges and counts paths matched by Apple Health workout type', () => {
    const runPlan = plan({
      focusAreas: [{ name: 'Running', paths: [{ id: 'push', name: 'Weekly volume', model: 'volume', params: { metric: 'distanceM', maxWeeklyIncreasePct: 10 },
        stages: [{ id: 'base', name: 'Base', match: { names: [], workoutTypes: ['Running'] }, prescription: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } }, advanceWhen: { weeklyVolume: { metric: 'distanceM', range: [20000, 25000] } } }] }] }],
      rules: { qualifyingSessions: [2, 2] },
      startDate: '2026-08-03',
    });
    const workouts: WorkoutRecord[] = ['2026-09-08', '2026-09-10', '2026-09-12'].map((date, i) => ({
      id: `r${i}`, workout_type: 'Running', start_time: `${date}T12:00:00.000Z`, end_time: `${date}T12:50:00.000Z`,
      duration_minutes: 55, calories_burned: 400, source: 'Apple Watch', distance_km: 7,
    }));
    const r = run(runPlan, [], '2026-09-15', { ...noSource, workouts });
    expect(r.paths[0].tracked).toBe(true);
    expect(r.paths[0].light).not.toBe('none');
    expect(r.adherence.status).not.toBe('unknown');
    expect(r.adherence.completed).toBeGreaterThan(0);
  });

  it('tracks every path when a source is connected (the default)', () => {
    const r = run(pushPlan(), EXAMPLE, '2026-09-21');
    expect(r.exerciseData).toBe(true);
    expect(r.paths.every(p => p.tracked)).toBe(true);
  });
});

// ── Analyst retrieval (SPEC §8) ─────────────────────────
//
// Retrieval selects only the summaries and bounded record windows the question
// needs. A handler never reads the dataset directly: everything it may cite
// arrives in the bundle, and the bundle records how many records were read.

import { REFERENCE_KEY, seriesFor, workoutList } from '../adapters/dataset';
import { getMetric } from '../metrics/registry';
import { compareWindows, type WindowComparison } from '../analytics/comparisons';
import { coverageSentence } from '../analytics/coverage';
import { computeRelationship, MIN_PAIRED_OBSERVATIONS } from '../analytics/relationships';
import { max as maxOf, mean, median, min as minOf, stddev } from '../analytics/stats';
import { containsDay, trailingWindow, windowDays, windowRangeLabel, type DayWindow } from '../analytics/windows';
import { workoutViews, weeklyWorkoutCounts } from '../analytics/workouts';
import type { RetrievedPair, RetrievedSummary, RetrievedWorkouts, RetrievalBundle } from './types';

/** Hard cap on how much of a series may be selected for one question. */
export const MAX_POINTS_PER_SERIES = 90;

/** Raised when a requested summary cannot be built at all. */
export class AnalysisNotAvailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisNotAvailable';
  }
}

interface SummarySpec {
  metricId: string;
  days: number;
}

interface PairSpec {
  x: string;
  y: string;
  alignment: 'same-day' | 'lagged';
  lagDays?: number;
  days?: number;
  /** Split the paired days by the median of X. */
  splitByX?: boolean;
}

interface WorkoutSpec {
  days: number;
}
interface RetrievalSpec {
  summaries?: SummarySpec[];
  pairs?: PairSpec[];
  workouts?: WorkoutSpec;
}

/** Exactly what each handler is allowed to see. */
export const RETRIEVAL_SPECS: Record<string, RetrievalSpec> = {
  'rhr-week-over-week': {
    summaries: [
      { metricId: 'resting_heart_rate', days: 7 },
      { metricId: 'heart_rate_variability', days: 7 },
    ],
  },
  'sleep-1-month': { summaries: [{ metricId: 'sleep_analysis', days: 30 }] },
  'sleep-3-months': { summaries: [{ metricId: 'sleep_analysis', days: 90 }] },
  'hrv-trend': {
    summaries: [
      { metricId: 'heart_rate_variability', days: 30 },
      { metricId: 'heart_rate_variability', days: 90 },
    ],
  },
  'steps-vs-baseline': { summaries: [{ metricId: 'step_count', days: 30 }] },
  'workout-frequency': { workouts: { days: 90 } },
  'what-changed-this-week': {
    summaries: [
      { metricId: 'sleep_analysis', days: 7 },
      { metricId: 'resting_heart_rate', days: 7 },
      { metricId: 'heart_rate_variability', days: 7 },
      { metricId: 'step_count', days: 7 },
      { metricId: 'apple_exercise_time', days: 7 },
    ],
  },
  'sleep-vs-recovery': {
    summaries: [
      { metricId: 'sleep_analysis', days: 90 },
      { metricId: 'heart_rate_variability', days: 90 },
    ],
    pairs: [{ x: 'sleep_analysis', y: 'heart_rate_variability', alignment: 'same-day', days: 90, splitByX: true }],
  },
};

function aggregationWord(metricId: string, accumulating: boolean): string {
  const meta = getMetric(metricId);
  if (accumulating) return 'daily total, complete days only';
  if (meta?.aggregationStrategy === 'latest') return 'latest recorded value';
  return 'daily average';
}

function buildSummary(metricId: string, days: number, refKey: string): { summary: RetrievedSummary; recordsRead: number } {
  const meta = getMetric(metricId);
  if (!meta) {
    throw new AnalysisNotAvailable(`No metric is registered with the id "${metricId}", so this question cannot be answered.`);
  }
  const cmp: WindowComparison = compareWindows(metricId, refKey, days, { meta, label: `Last ${days} days` });
  // Bounded selection: read at most MAX_POINTS_PER_SERIES values from the store.
  const inWindow = seriesFor(metricId).filter(p => containsDay(cmp.requestedWindow, p.key));
  const bounded = inWindow.slice(-MAX_POINTS_PER_SERIES);
  const values = bounded.map(p => p.value);
  const truncated = inWindow.length > MAX_POINTS_PER_SERIES;

  return {
    recordsRead: bounded.length,
    summary: {
      metricId,
      metricName: meta?.displayName ?? metricId,
      aggregation: aggregationWord(metricId, cmp.accumulating),
      accumulating: cmp.accumulating,
      window: cmp.evaluatedWindow,
      baselineWindow: cmp.baselineWindow,
      lengthLabel: cmp.lengthLabel,
      exclusionNote: cmp.exclusionNote,
      comparison: cmp.comparison,
      counts: cmp.counts,
      coverage: `${cmp.counts.evaluated} and ${cmp.counts.baseline} observations · ${coverageSentence(metricId)}`,
      points: bounded.map(p => ({ key: p.key, value: p.value })),
      truncated,
      aggregate: {
        mean: mean(values),
        median: median(values),
        min: minOf(values),
        max: maxOf(values),
        stddev: stddev(values),
      },
    },
  };
}

function buildPair(spec: PairSpec, refKey: string): { pair: RetrievedPair; recordsRead: number } {
  const window = trailingWindow(refKey, spec.days ?? 90);
  const result = computeRelationship(
    spec.x,
    spec.y,
    window,
    spec.alignment,
    spec.lagDays ?? 1
  );

  let split: RetrievedPair['split'] = null;
  if (spec.splitByX && result.points.length >= MIN_PAIRED_OBSERVATIONS) {
    const xs = result.points.map(p => p.x);
    const m = median(xs);
    const low = result.points.filter(p => p.x < m);
    const high = result.points.filter(p => p.x >= m);
    split = {
      medianX: m,
      low: { label: 'Below the median', days: low.length, xMean: mean(low.map(p => p.x)), yMean: mean(low.map(p => p.y)) },
      high: { label: 'At or above the median', days: high.length, xMean: mean(high.map(p => p.x)), yMean: mean(high.map(p => p.y)) },
    };
  }

  return {
    recordsRead: result.pairedCount * 2,
    pair: {
      xMetricId: spec.x,
      yMetricId: spec.y,
      alignment: spec.alignment,
      lagDays: spec.alignment === 'lagged' ? Math.max(1, Math.round(spec.lagDays ?? 1)) : 0,
      coefficient: result.valid ? result.coefficient : null,
      pairedCount: result.pairedCount,
      xCount: result.xCount,
      yCount: result.yCount,
      valid: result.valid,
      reason: result.insufficientReason,
      window,
      split,
    },
  };
}

function buildWorkouts(spec: WorkoutSpec, refKey: string): { workouts: RetrievedWorkouts; recordsRead: number } {
  const window = trailingWindow(refKey, spec.days, `Last ${spec.days} days`);
  const views = workoutViews(workoutList());
  const inWindow = views.filter(v => containsDay(window, v.key));
  const types = new Map<string, { type: string; count: number; minutes: number }>();
  for (const v of inWindow) {
    const entry = types.get(v.workout_type) ?? { type: v.workout_type, count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += v.duration_minutes;
    types.set(v.workout_type, entry);
  }
  const weeks = weeklyWorkoutCounts(views, Math.max(1, Math.round(spec.days / 7)), refKey);
  const recentWindow = trailingWindow(refKey, 30);
  const priorWindow = trailingWindow(recentWindow.startKey, 30);

  return {
    recordsRead: inWindow.length,
    workouts: {
      window,
      sessions: inWindow.length,
      sessionsPerWeek: mean(weeks.map(w => w.count)),
      minutes: inWindow.reduce((a, v) => a + v.duration_minutes, 0),
      calories: inWindow.reduce((a, v) => a + v.calories_burned, 0),
      byType: [...types.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      recent: views.filter(v => containsDay(recentWindow, v.key)).length,
      prior: views.filter(v => containsDay(priorWindow, v.key)).length,
    },
  };
}

/**
 * The selection used for a free-form question when a real provider is
 * configured and no demo handler matches. It is deliberately small and fixed:
 * every core summary over one bounded window, capped by MAX_POINTS_PER_SERIES,
 * plus the workout roll-up. Never the whole registry and never the whole dataset.
 */
export const GENERAL_HANDLER_ID = 'general';
export const GENERAL_RETRIEVAL_DAYS = 30;
/**
 * The core selection for a free-form question. Nutrition is included because a
 * free-form question is as likely to be about logged intake (caffeine, energy,
 * macros) as about sleep or activity, and because a question that spans two
 * topics must be answerable from one bundle — a question about caffeine and
 * sleep needs both series, not one of them.
 */
export const GENERAL_RETRIEVAL_METRICS = [
  'sleep_analysis',
  'resting_heart_rate',
  'heart_rate_variability',
  'step_count',
  'apple_exercise_time',
  'active_energy',
  'respiratory_rate',
  'weight_body_mass',
  // Logged nutrition intake (dietary_caffeine is the registry's "Caffeine").
  'dietary_caffeine',
  'dietary_energy',
  'dietary_carbs',
  'dietary_fat_total',
  'dietary_protein',
  'dietary_water',
];
const GENERAL_BUNDLE_SPEC: RetrievalSpec = {
  summaries: GENERAL_RETRIEVAL_METRICS.map(metricId => ({ metricId, days: GENERAL_RETRIEVAL_DAYS })),
  workouts: { days: GENERAL_RETRIEVAL_DAYS },
};

/** Build a bundle from a selection spec. */
function buildBundle(handlerId: string, spec: RetrievalSpec, refKey: string): RetrievalBundle {
  const summaries: RetrievedSummary[] = [];
  const pairs: RetrievedPair[] = [];
  let recordsRead = 0;

  for (const s of spec.summaries ?? []) {
    const built = buildSummary(s.metricId, s.days, refKey);
    summaries.push(built.summary);
    recordsRead += built.recordsRead;
  }
  for (const p of spec.pairs ?? []) {
    const built = buildPair(p, refKey);
    pairs.push(built.pair);
    recordsRead += built.recordsRead;
  }
  let workouts: RetrievedWorkouts | null = null;
  if (spec.workouts) {
    const built = buildWorkouts(spec.workouts, refKey);
    workouts = built.workouts;
    recordsRead += built.recordsRead;
  }

  const metricIds = [...new Set(summaries.map(s => s.metricId))];
  const note =
    metricIds.length + pairs.length + (workouts ? 1 : 0) === 0
      ? 'No dataset context was selected for this question.'
      : `Selected ${metricIds.length} metric summar${metricIds.length === 1 ? 'y' : 'ies'}${
          pairs.length ? `, ${pairs.length} paired comparison${pairs.length === 1 ? '' : 's'}` : ''
        }${workouts ? ' and the workout log' : ''}; ${recordsRead} records read. The rest of the dataset was not sent anywhere.`;

  return { handlerId, refKey, summaries, pairs, workouts, recordsRead, note };
}

/** Select the summaries and bounded windows a handler is allowed to see. */
export function retrieve(handlerId: string, refKey: string = REFERENCE_KEY): RetrievalBundle {
  const spec = RETRIEVAL_SPECS[handlerId] ?? { summaries: [] };
  return buildBundle(handlerId, spec, refKey);
}

/**
 * The general (free-form) selection. Used only when a real provider is
 * configured: the demo analyst never routes here, so its behaviour is unchanged.
 */
export function retrieveGeneral(refKey: string = REFERENCE_KEY): RetrievalBundle {
  return buildBundle(GENERAL_HANDLER_ID, GENERAL_BUNDLE_SPEC, refKey);
}

/** Bounded series for one metric inside a bundle. */
export function summaryOf(bundle: RetrievalBundle, metricId: string, window?: DayWindow): RetrievedSummary | undefined {
  const candidates = bundle.summaries.filter(s => s.metricId === metricId);
  if (window) {
    return candidates.find(s => s.window.startKey === window.startKey && s.window.endKey === window.endKey) ?? candidates[0];
  }
  // Prefer the shortest window (the more recent question) when several exist.
  return candidates.sort((a, b) => windowDays(a.window) - windowDays(b.window))[0];
}

export function everySummary(bundle: RetrievalBundle): RetrievedSummary[] {
  return bundle.summaries;
}

export function pairOf(bundle: RetrievalBundle, x: string, y: string): RetrievedPair | undefined {
  return bundle.pairs.find(p => p.xMetricId === x && p.yMetricId === y);
}

export function windowLabelOf(summary: RetrievedSummary): string {
  return `${summary.lengthLabel} · ${windowRangeLabel(summary.window)} vs ${windowRangeLabel(summary.baselineWindow)}`;
}

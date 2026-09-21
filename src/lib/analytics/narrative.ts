// ── Generated narrative copy ────────────────────────────
//
// Every sentence that interprets the data is produced here from the shared
// computation, so the overview can never contradict itself. Copy is deliberately
// baseline-relative and non-clinical (SPEC §8): no "normal", "healthy",
// "concerning", "safe", no implied diagnosis, no causal language.

import { getMetric } from '../metrics/registry';
import type { MetricDefinition } from '../metrics/types';
import {
  formatMetricWithUnit, formatMetricValue, formatPercent, describeChange, formatDeltaWithUnit,
  metricUnit, NO_CHANGE,
} from '../metrics/format';
import type { UnitSystem } from '../prefs';
import type { DayPoint } from '../adapters/dataset';
import { REFERENCE_KEY, isAccumulating, seriesFor as seriesForMetric } from '../adapters/dataset';
import { aggregate } from './stats';
import { compareWindows } from './comparisons';
import { computeStatus, type BaselineStatus, type StatusResult, type WithinWord } from './status';
import {
  addDays,
  formatDayKeyLong,
  makeWindow,
  previousWindow,
  trailingWindow,
  windowDays,
  windowRangeLabel,
  type DayWindow,
} from './windows';

export const BRIEFING_EVALUATED_DAYS = 7;
export const BRIEFING_BASELINE_DAYS = 30;
export const STORY_WINDOW_DAYS = 30;

export interface CategoryBriefing {
  key: 'sleep' | 'recovery' | 'activity' | 'cardiovascular';
  label: string;
  metricId: string;
  status: BaselineStatus;
  result: StatusResult;
  evaluatedWindow: DayWindow;
  baselineWindow: DayWindow;
}

export interface Briefing {
  categories: CategoryBriefing[];
  outside: CategoryBriefing[];
  within: CategoryBriefing[];
  headline: string;
  body: string;
  /** True when at least one category had enough data to make a statement. */
  anySufficient: boolean;
}

const CATEGORY_DEFS: Array<{
  key: CategoryBriefing['key'];
  label: string;
  metricId: string;
  withinWord: WithinWord;
  band: number;
}> = [
  { key: 'sleep', label: 'Sleep', metricId: 'sleep_analysis', withinWord: 'Within baseline', band: 5 },
  { key: 'recovery', label: 'Recovery', metricId: 'heart_rate_variability', withinWord: 'Stable', band: 5 },
  { key: 'activity', label: 'Activity', metricId: 'step_count', withinWord: 'Within baseline', band: 5 },
  { key: 'cardiovascular', label: 'Cardiovascular', metricId: 'resting_heart_rate', withinWord: 'Within baseline', band: 3 },
];

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function listPhrase(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sidePhrase(status: BaselineStatus): string {
  if (status === 'Above recent average') return 'above your recent average';
  if (status === 'Below recent average') return 'below your recent average';
  return 'within your recent baseline';
}

/**
 * The single briefing computation: headline, body and category chips all read
 * from the same StatusResult objects.
 */
export function buildBriefing(refKey: string): Briefing {
  const evaluatedWindow = trailingWindow(refKey, BRIEFING_EVALUATED_DAYS, `Last ${BRIEFING_EVALUATED_DAYS} days`);
  const baselineWindow = previousWindow(evaluatedWindow, BRIEFING_BASELINE_DAYS, `Prior ${BRIEFING_BASELINE_DAYS} days`);

  const categories: CategoryBriefing[] = CATEGORY_DEFS.map(def => {
    const meta = getMetric(def.metricId);
    const evaluated = seriesForMetric(def.metricId).filter(p => p.key >= evaluatedWindow.startKey && p.key <= evaluatedWindow.endKey);
    const baseline = seriesForMetric(def.metricId).filter(p => p.key >= baselineWindow.startKey && p.key <= baselineWindow.endKey);
    return {
      ...def,
      status: 'Not enough data',
      result: computeStatus({
        metricId: def.metricId,
        meta,
        evaluated,
        baseline,
        band: def.band,
        withinWord: def.withinWord,
        // The two windows differ in length, so compare daily averages.
        strategyOverride: 'avg',
      }),
      evaluatedWindow,
      baselineWindow,
    };
  }).map(c => ({ ...c, status: c.result.status }));

  const anySufficient = categories.some(c => c.result.sufficient);
  const outside = categories.filter(c => c.result.sufficient && !isWithinWord(c.status));
  const within = categories.filter(c => c.result.sufficient && isWithinWord(c.status));

  let headline: string;
  if (!anySufficient) {
    headline = 'Not enough data is available to summarise this week yet.';
  } else if (outside.length === 0) {
    headline = 'Your signals are broadly within your recent baseline.';
  } else {
    headline = `${sentenceCase(
      listPhrase(outside.map(c => `${c.label} is ${sidePhrase(c.status)}`))
    )}.`;
  }

  const bodyParts: string[] = [];
  if (within.length > 0) {
    bodyParts.push(
      `${sentenceCase(listPhrase(within.map(c => c.label.toLowerCase())))} ${
        within.length === 1 ? 'is' : 'are'
      } within your recent baseline`
    );
  }
  if (outside.length > 0) {
    bodyParts.push(
      listPhrase(outside.map(c => `${c.label.toLowerCase()} is ${sidePhrase(c.status)}`))
    );
  }
  const body =
    bodyParts.length === 0
      ? 'There is not enough recorded data in the last 7 days to compare with your prior 30 days.'
      : `${bodyParts.join(', while ')} over the last ${BRIEFING_EVALUATED_DAYS} days, compared with your prior ${BRIEFING_BASELINE_DAYS}.`;

  return { categories, outside, within, headline, body, anySufficient };
}

export function isWithinWord(status: BaselineStatus): boolean {
  return status === 'Within baseline' || status === 'Stable';
}

// ── "One thing to watch" ────────────────────────────────

export interface WatchItem {
  metricId: string;
  metricName: string;
  status: BaselineStatus;
  /** Numeric change, e.g. '+1.3 bpm', '−2.0K steps' or 'no change'. */
  changeValue: string;
  /** The same change written with its unit or noun, e.g. '−2.0K steps'. */
  changeLabel: string;
  changePercent: string | null;
  /** Where the evaluated value sits, e.g. '5h 53m'. */
  evaluatedValue: string;
  baselineValue: string;
  evaluatedWindow: DayWindow;
  baselineWindow: DayWindow;
  /** Human labels for both windows, including the complete-day note. */
  evaluatedLabel: string;
  baselineLabel: string;
  counts: { evaluated: number; baseline: number };
  /** True when the in-progress day had to be dropped from the comparison. */
  excludedIncompleteDay: boolean;
  exclusionNote: string | null;
  /** Amber accent is reserved for changes that genuinely warrant attention. */
  tone: 'neutral' | 'attention';
  reason: string;
}

export function buildWatchItem(briefing: Briefing, system: UnitSystem = 'metric'): WatchItem | null {
  const candidates = briefing.outside
    .filter(c => c.result.comparison.deltaPercent != null)
    .sort(
      (a, b) =>
        Math.abs(b.result.comparison.deltaPercent as number) -
        Math.abs(a.result.comparison.deltaPercent as number)
    );
  const top = candidates[0];
  if (!top) return null;

  const meta = getMetric(top.metricId);
  const pct = top.result.comparison.deltaPercent as number;
  const tone: 'neutral' | 'attention' = Math.abs(pct) >= 10 ? 'attention' : 'neutral';
  const changeValue = formatDeltaWithUnit(top.metricId, top.result.comparison.delta, system);

  // An accumulating metric never includes the day that is still in progress.
  const accumulating = isAccumulating(meta);
  const excluded = accumulating ? top.result.excludedEvaluatedDays : [];
  const effectiveEnd = excluded.length
    ? addDays(top.evaluatedWindow.endKey, -excluded.length)
    : top.evaluatedWindow.endKey;
  const evaluatedDays = windowDays(top.evaluatedWindow) - excluded.length;
  const baselineDays = windowDays(top.baselineWindow);

  const changeLabel =
    changeValue === NO_CHANGE
      ? NO_CHANGE
      : metricUnit(top.metricId, system)
        ? changeValue
        : `${changeValue} ${(meta?.displayName ?? top.label).toLowerCase()}`;

  const evaluatedLabel =
    excluded.length > 0
      ? `This week · ${evaluatedDays} complete days · ${windowRangeLabel(
          makeWindow(top.evaluatedWindow.startKey, effectiveEnd, top.evaluatedWindow.label)
        )}`
      : `This week · ${windowDays(top.evaluatedWindow)} days · ${windowRangeLabel(top.evaluatedWindow)}`;

  return {
    metricId: top.metricId,
    metricName: meta?.displayName ?? top.label,
    status: top.status,
    changeValue,
    changeLabel,
    changePercent: formatPercent(pct),
    evaluatedValue: formatMetricWithUnit(top.metricId, top.result.comparison.current, system),
    baselineValue: formatMetricWithUnit(top.metricId, top.result.comparison.baseline, system),
    evaluatedWindow: top.evaluatedWindow,
    baselineWindow: top.baselineWindow,
    evaluatedLabel,
    baselineLabel: `Prior baseline · ${baselineDays} days · ${windowRangeLabel(top.baselineWindow)}`,
    counts: top.result.counts,
    excludedIncompleteDay: excluded.length > 0,
    exclusionNote: excluded.length
      ? `Today (${formatDayKeyLong(REFERENCE_KEY)}) is still in progress and is excluded from this metric's comparison.`
      : null,
    tone,
    reason: reasonFor(meta, top.status),
  };
}

function reasonFor(meta: MetricDefinition | undefined, status: BaselineStatus): string {
  const name = meta?.displayName ?? 'This metric';
  if (status === 'Above recent average') {
    return `${name} sits above your prior baseline this week. This is the largest change in the week's comparison.`;
  }
  if (status === 'Below recent average') {
    return `${name} sits below your prior baseline this week. This is the largest change in the week's comparison.`;
  }
  return `${name} is within your recent baseline.`;
}

// ── Health story ────────────────────────────────────────

export interface StoryObservation {
  metricId: string;
  title: string;
  detail: string;
  status: BaselineStatus;
  windowLabel: string;
  evidence: string;
}

export interface StorySummary {
  windowDays: number;
  window: DayWindow;
  /** Opening paragraph, generated from the data. */
  paragraph: string;
  observations: StoryObservation[];
}

const STORY_METRICS = [
  { metricId: 'resting_heart_rate', band: 3, withinWord: 'Within baseline' as WithinWord },
  { metricId: 'heart_rate_variability', band: 5, withinWord: 'Stable' as WithinWord },
  { metricId: 'sleep_analysis', band: 5, withinWord: 'Within baseline' as WithinWord },
  { metricId: 'step_count', band: 5, withinWord: 'Within baseline' as WithinWord },
];

export function buildStorySummary(
  refKey: string,
  days: number = STORY_WINDOW_DAYS,
  system: UnitSystem = 'metric'
): StorySummary {
  const window = trailingWindow(refKey, days, `Last ${days} days`);
  const baselineWindow = previousWindow(window, days, `Prior ${days} days`);
  const metricName = (id: string) => getMetric(id)?.displayName ?? id;

  const results = STORY_METRICS.map(def => {
    const meta = getMetric(def.metricId);
    const points = seriesForMetric(def.metricId);
    const evaluated = points.filter(p => p.key >= window.startKey && p.key <= window.endKey);
    const baseline = points.filter(p => p.key >= baselineWindow.startKey && p.key <= baselineWindow.endKey);
    return {
      def,
      meta,
      result: computeStatus({
        metricId: def.metricId,
        meta,
        evaluated,
        baseline,
        band: def.band,
        withinWord: def.withinWord,
        strategyOverride: 'avg',
      }),
      points,
    };
  });

  const observations: StoryObservation[] = results.map(({ def, meta, result, points }) => {
    const name = metricName(def.metricId);
    const title =
      result.status === 'Not enough data'
        ? `${name}: not enough data in this period`
        : `${name}: ${isWithinWord(result.status) ? `within your ${days}-day baseline` : lowerFirst(result.status) + ` your ${days}-day baseline`}`;
    const detail = result.sufficient
      ? `Daily average ${formatMetricWithUnit(def.metricId, result.comparison.current, system)} across ${windowRangeLabel(window)}, compared with ${formatMetricWithUnit(def.metricId, result.comparison.baseline, system)} across ${windowRangeLabel(baselineWindow)}.`
      : `No comparison is shown for ${windowRangeLabel(window)}: ${
          result.counts.evaluated === 0
            ? 'there are no observations in this period'
            : 'the recorded observations are too few to compare'
        }.`;
    const inWindow = points.filter(p => p.key >= window.startKey && p.key <= window.endKey);
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const evidence =
      first && last
        ? `${inWindow.length} observations · ${formatMetricValue(def.metricId, first.value, system)} on ${formatDayKeyLong(first.key)} → ${formatMetricValue(def.metricId, last.value, system)} on ${formatDayKeyLong(last.key)}`
        : 'No observations in this period';
    void meta;
    return {
      metricId: def.metricId,
      title,
      detail,
      status: result.status,
      windowLabel: windowRangeLabel(window),
      evidence,
    };
  });

  const rhr = results.find(r => r.def.metricId === 'resting_heart_rate');
  let paragraph: string;
  if (!rhr || !rhr.result.sufficient) {
    paragraph = `Over the last ${days} days there is not enough recorded data to summarise a change in your resting heart rate.`;
  } else {
    const inWindow = rhr.points.filter(p => p.key >= window.startKey && p.key <= window.endKey);
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const avg = aggregate(inWindow.map(p => p.value), 'avg');
    const outsideCount = observations.filter(o => o.status !== 'Not enough data' && !isWithinWord(o.status)).length;
    paragraph = [
      `Across ${windowRangeLabel(window)} your resting heart rate averaged ${formatMetricWithUnit(
        'resting_heart_rate',
        avg,
        system
      )}, ${rhr.result.status === 'Not enough data' ? 'with no comparable baseline' : `${lowerFirst(rhr.result.status)} (${formatPercent(rhr.result.comparison.deltaPercent)}) versus your prior ${days} days`}.`,
      first && last
        ? `The first and last recorded values in the window were ${formatMetricValue('resting_heart_rate', first.value, system)} on ${formatDayKeyLong(first.key)} and ${formatMetricValue('resting_heart_rate', last.value, system)} on ${formatDayKeyLong(last.key)}.`
        : '',
      outsideCount === 0
        ? 'None of the tracked signals moved outside its recent baseline over this period.'
        : `${outsideCount} of the ${observations.length} tracked signals moved outside its recent baseline over this period; see the observations below.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return { windowDays: days, window, paragraph, observations };
}

// ── Trend figure labelling (defect 7) ───────────────────

export interface TrendFigure {
  metricId: string;
  metricName: string;
  unit: string;
  windowLabel: string;
  firstValue: string;
  lastValue: string;
  direction: 'up' | 'down' | 'flat';
  ariaLabel: string;
  points: DayPoint[];
}

export function buildTrendFigure(
  metricId: string,
  refKey: string,
  days: number,
  system: UnitSystem = 'metric'
): TrendFigure {
  const win = trailingWindow(refKey, days, `Last ${days} days`);
  const points = seriesForMetric(metricId).filter(p => p.key >= win.startKey && p.key <= win.endKey);
  const meta = getMetric(metricId);
  const first = points[0];
  const last = points[points.length - 1];
  const firstValue = first ? formatMetricValue(metricId, first.value, system) : '—';
  const lastValue = last ? formatMetricValue(metricId, last.value, system) : '—';
  const direction =
    !first || !last ? 'flat' : last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat';
  const unit = metricUnit(metricId, system);
  const windowLabel = windowRangeLabel(win);

  return {
    metricId,
    metricName: meta?.displayName ?? metricId,
    unit,
    windowLabel,
    firstValue,
    lastValue,
    direction,
    ariaLabel: `${meta?.displayName ?? metricId} trend, ${windowLabel}: from ${firstValue} to ${lastValue}${
      unit ? ` ${unit}` : ''
    }, ${points.length} observations.`,
    points,
  };
}
// ── Domain page series summaries ────────────────────────

export interface SeriesSummary {
  metricId: string;
  metricName: string;
  unit: string;
  /** Window the chart and the latest reading are taken from. */
  window: DayWindow;
  /** Window actually compared — complete days only for accumulating metrics. */
  evaluatedWindow: DayWindow;
  baselineWindow: DayWindow;
  points: DayPoint[];
  baselinePoints: DayPoint[];
  latest: DayPoint | undefined;
  /** Latest value formatted with unit, or 'Not enough data'. */
  latestValue: string;
  windowAverage: number;
  baselineAverage: number;
  delta: number;
  deltaPercent: number | null;
  changeValue: string;
  changePercent: string | null;
  direction: 'above' | 'below' | 'none';
  valid: boolean;
  counts: { evaluated: number; baseline: number };
  /** Days excluded because they were partial (sum metrics only). */
  excludedDays: string[];
  /** '6 complete days vs 6 complete days' */
  lengthLabel: string;
  /** Sentence stating the exclusion, or null. */
  exclusionNote: string | null;
  /** True when the metric accumulates during the current day. */
  accumulating: boolean;
}

/**
 * One call produces everything a domain card needs, using the same comparison
 * windows as the briefing so no two panels disagree. Accumulating metrics are
 * compared over complete days on both sides.
 */
export function buildSeriesSummary(
  metricId: string,
  refKey: string,
  days: number,
  system: UnitSystem = 'metric'
): SeriesSummary {
  const meta = getMetric(metricId);
  const requested = trailingWindow(refKey, days, `Last ${days} days`);
  const all = seriesForMetric(metricId);
  const points = all.filter(p => p.key >= requested.startKey && p.key <= requested.endKey);

  const cmp = compareWindows(metricId, refKey, days, { meta, label: `Last ${days} days` });
  const evaluatedWindow = cmp.evaluatedWindow;
  const baselineWindow = cmp.baselineWindow;
  const baselinePoints = all.filter(p => p.key >= baselineWindow.startKey && p.key <= baselineWindow.endKey);

  const latest = points.length ? points[points.length - 1] : all[all.length - 1];
  const change = describeChange(metricId, cmp.comparison.delta, cmp.comparison.deltaPercent, { system, days });

  return {
    metricId,
    metricName: meta?.displayName ?? metricId,
    unit: metricUnit(metricId, system),
    window: requested,
    evaluatedWindow,
    baselineWindow,
    points,
    baselinePoints,
    latest,
    latestValue: latest ? formatMetricWithUnit(metricId, latest.value, system) : 'Not enough data',
    windowAverage: cmp.comparison.current,
    baselineAverage: cmp.comparison.baseline,
    delta: cmp.comparison.delta,
    deltaPercent: cmp.comparison.deltaPercent,
    changeValue: cmp.comparison.valid ? change.value : '—',
    changePercent: change.percent,
    direction: cmp.comparison.valid ? change.direction : 'none',
    valid: cmp.comparison.valid,
    counts: { evaluated: cmp.comparison.currentCount, baseline: cmp.comparison.baselineCount },
    excludedDays: cmp.excludedDays,
    lengthLabel: cmp.lengthLabel,
    exclusionNote: cmp.exclusionNote,
    accumulating: cmp.accumulating,
  };
}

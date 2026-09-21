// ── Weekly and monthly reports (SPEC §7) ────────────────
//
// Every report is composed at render time from the shared computation: the
// period, the coverage and every figure come from the dataset, so a report can
// never drift away from the charts. Nothing here is static prose.
//
// Complete periods only: a week is the seven days ending yesterday, a month is
// the calendar month, clamped to the dataset window. Where a period is
// incomplete (the dataset starts mid-March and ends mid-September) the report
// says so and states how many days it covers.

import { getMetric } from '../metrics/registry';
import { REFERENCE_KEY, WINDOW_START_KEY } from '../adapters/dataset';
import { formatMetricWithUnit, formatPercent } from '../metrics/format';
import { countNoun, proseName } from '../metrics/prose';
import type { UnitSystem } from '../prefs';
import { compareWindows, type WindowComparison } from './comparisons';
import { workoutViews, type WorkoutView } from './workouts';
import { addDays, diffDays, formatDayKeyLong, formatDayKeyShort, windowDays, windowRangeLabel, type DayWindow } from './windows';

export type ReportKind = 'weekly' | 'monthly';

export interface ReportLine {
  metricId: string;
  metricName: string;
  value: string;
  aggregation: string;
  observations: number;
  coverage: string;
  /** Percentage change against the preceding equal-length period, when valid. */
  deltaPercent: number | null;
  deltaValue: string;
}

export interface PeriodReport {
  id: string;
  kind: ReportKind;
  title: string;
  periodLabel: string;
  rangeKey: string;
  window: DayWindow;
  /** Calendar days in the period. */
  days: number;
  /** Days actually covered by the dataset inside the period. */
  coveredDays: number;
  /** True when the period is clipped by the dataset window or still running. */
  partial: boolean;
  coverageNote: string;
  paragraphs: string[];
  lines: ReportLine[];
  highlights: string[];
}

const REPORT_METRIC_IDS = [
  'sleep_analysis',
  'resting_heart_rate',
  'heart_rate_variability',
  'step_count',
  'apple_exercise_time',
  'active_energy',
] as const;

function listPhrase(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface MetricPeriod {
  metricId: string;
  metricName: string;
  accumulating: boolean;
  comparison: WindowComparison;
  /** Per-day average for an accumulating metric; the average itself otherwise. */
  dailyAverage: number;
  observationCount: number;
  logged: boolean;
  value: string;
  aggregation: string;
  coverage: string;
  deltaPercent: number | null;
  deltaValue: string;
}

function perDayAverage(cmp: WindowComparison): number {
  if (!cmp.accumulating) return cmp.comparison.current;
  const days = cmp.evaluatedDays || 1;
  return cmp.comparison.current / days;
}

function describePeriodMetrics(
  metricIds: readonly string[],
  window: DayWindow,
  system: UnitSystem
): MetricPeriod[] {
  const days = windowDays(window);
  const endKey = window.endKey;
  return metricIds.map(metricId => {
    const meta = getMetric(metricId);
    const comparison = compareWindows(metricId, endKey, days, {
      meta,
      label: windowRangeLabel(window),
      endKey,
    });
    const accumulating = comparison.accumulating;
    const dailyAverage = perDayAverage(comparison);
    const avg = comparison.comparison;
    const logged = avg.valid && avg.currentCount > 0;
    const value = logged
      ? accumulating
        ? `${formatMetricWithUnit(metricId, avg.current, system)} in total`
        : formatMetricWithUnit(metricId, avg.current, system)
      : 'no recorded values';
    return {
      metricId,
      metricName: meta?.displayName ?? metricId,
      accumulating,
      comparison,
      dailyAverage,
      observationCount: avg.currentCount,
      logged,
      value,
      aggregation: accumulating ? 'daily total, summed over the period' : 'average of the recorded values',
      coverage: `${avg.currentCount} of ${days} days`,
      deltaPercent: avg.deltaPercent,
      deltaValue: logged ? formatMetricWithUnit(metricId, avg.delta, system) : '—',
    };
  });
}

function workoutsIn(window: DayWindow, views: WorkoutView[]): WorkoutView[] {
  return views.filter(v => v.key >= window.startKey && v.key <= window.endKey);
}

function buildReport(
  kind: ReportKind,
  window: DayWindow,
  coveredDays: number,
  expectedDays: number,
  system: UnitSystem
): PeriodReport {
  const views = workoutViews();
  const sessions = workoutsIn(window, views);
  const workoutMinutes = sessions.reduce((a, w) => a + w.duration_minutes, 0);
  const periods = describePeriodMetrics(REPORT_METRIC_IDS, window, system);
  const partial = coveredDays < expectedDays;

  // ── Paragraph 1: measurement ────────────────────────
  const clauses: string[] = [];
  for (const p of periods) {
    if (!p.logged) {
      clauses.push(`no recorded ${proseName(p.metricId)} values`);
      continue;
    }
    const noun = countNoun(p.metricId, p.observationCount);
    if (p.accumulating) {
      clauses.push(
        `${formatMetricWithUnit(p.metricId, p.dailyAverage, system)} of ${proseName(p.metricId)} a day, from ${p.observationCount} ${noun}`
      );
    } else {
      clauses.push(
        `${formatMetricWithUnit(p.metricId, p.comparison.comparison.current, system)} of ${proseName(p.metricId)}, from ${p.observationCount} ${noun}`
      );
    }
  }
  const paragraph1 = `Across ${windowRangeLabel(window)} you recorded ${listPhrase(clauses)}.`;

  // ── Paragraph 2: comparison with the preceding period ──
  const moved = periods.filter(
    p => p.logged && p.deltaPercent != null && Math.abs(p.deltaPercent) >= 5 && p.comparison.comparison.delta !== 0
  );
  const comparisonSentences = moved.map(
    p =>
      `${proseName(p.metricId)} was ${Math.abs(p.deltaPercent as number).toFixed(1)}% ${
        (p.deltaPercent as number) > 0 ? 'higher' : 'lower'
      } (${p.deltaValue})`
  );
  const paragraph2 =
    moved.length === 0
      ? `Against the preceding period (${comparisonRangeLabel(window)}), none of the tracked metrics moved by 5% or more.`
      : `Against the preceding period (${comparisonRangeLabel(window)}), ${listPhrase(comparisonSentences)}.`;

  // ── Paragraph 3: activity and workouts ───────────────
  const paragraph3 =
    sessions.length === 0
      ? `No workouts were recorded in this period.`
      : `${sessions.length} ${sessions.length === 1 ? 'workout was' : 'workouts were'} recorded, totalling ${workoutMinutes} minutes and ${sessions.reduce((a, w) => a + w.calories_burned, 0)} kcal across ${listPhrase(
          [...new Set(sessions.map(s => s.workout_type))].map(t => `${sessions.filter(s => s.workout_type === t).length} ${t.toLowerCase()}`)
        )}.`;

  // ── Coverage ─────────────────────────────────────────
  const coverageNote = `${coveredDays} of ${expectedDays} days in this period are covered by the dataset${
    partial ? ' — the period is incomplete' : ''
  }.`;

  const highlights = periods
    .filter(p => p.logged && p.deltaPercent != null && Math.abs(p.deltaPercent) >= 5)
    .map(
      p =>
        `${p.metricName} ${formatPercent(p.deltaPercent)} vs the preceding period (${comparisonRangeLabel(window)})`
    );

  return {
    id: `${kind}-${window.endKey}`,
    kind,
    title: kind === 'weekly' ? `Week ending ${formatDayKeyLong(window.endKey)}` : `Month of ${monthName(window.endKey)}`,
    periodLabel: `${windowRangeLabel(window)}, ${window.endKey.slice(0, 4)}`,
    rangeKey: `${window.startKey}..${window.endKey}`,
    window,
    days: expectedDays,
    coveredDays,
    partial,
    coverageNote,
    paragraphs: [paragraph1, paragraph2, paragraph3, reportCoverageSentence(periods)],
    lines: periods.map(p => ({
      metricId: p.metricId,
      metricName: p.metricName,
      value: p.value,
      aggregation: p.aggregation,
      observations: p.observationCount,
      coverage: p.coverage,
      deltaPercent: p.deltaPercent,
      deltaValue: p.deltaValue,
    })),
    highlights,
  };
}

function reportCoverageSentence(periods: MetricPeriod[]): string {
  const parts = periods.map(p => `${proseName(p.metricId)} ${p.coverage}`);
  return `Coverage: ${listPhrase(parts)}. Days with no record are excluded rather than counted as zero, and no value is substituted for a missing day.`;
}

function comparisonRangeLabel(window: DayWindow): string {
  const days = windowDays(window);
  const prevEnd = addDays(window.startKey, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return `${formatDayKeyShort(prevStart)} – ${formatDayKeyShort(prevEnd)}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthName(key: string): string {
  const [, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${key.slice(0, 4)}`;
}

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The 7-day blocks ending yesterday, most recent first. */
export function weeklyReportWindows(refKey: string, count = 12): DayWindow[] {
  const out: DayWindow[] = [];
  for (let i = 0; i < count; i++) {
    const endKey = addDays(refKey, -1 - i * 7);
    const startKey = addDays(endKey, -6);
    if (startKey < WINDOW_START_KEY) break;
    out.push({ startKey, endKey, label: `Week ending ${formatDayKeyLong(endKey)}` });
  }
  return out;
}

export function buildWeeklyReports(
  refKey: string = REFERENCE_KEY,
  count = 12,
  system: UnitSystem = 'metric'
): PeriodReport[] {
  return weeklyReportWindows(refKey, count).map(w => buildReport('weekly', w, 7, 7, system));
}

/** Calendar months clipped to the dataset window, most recent first. */
export function monthlyReportWindows(refKey: string = REFERENCE_KEY, count = 7): DayWindow[] {
  const out: DayWindow[] = [];
  const [refYear, refMonth] = refKey.split('-').map(Number);
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(refYear, refMonth - 1 - i, 1));
    const monthKey = d.toISOString().slice(0, 7);
    const lastDay = daysInMonth(monthKey);
    let startKey = `${monthKey}-01`;
    let endKey = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
    if (endKey > refKey) endKey = refKey;
    if (startKey < WINDOW_START_KEY) startKey = WINDOW_START_KEY;
    if (startKey > endKey) break;
    out.push({ startKey, endKey, label: monthName(startKey) });
  }
  return out;
}

export function buildMonthlyReports(
  refKey: string = REFERENCE_KEY,
  count = 7,
  system: UnitSystem = 'metric'
): PeriodReport[] {
  return monthlyReportWindows(refKey, count).map(w =>
    buildReport('monthly', w, diffDays(w.startKey, w.endKey) + 1, daysInMonth(w.startKey.slice(0, 7)), system)
  );
}

export interface ReportArchive {
  weekly: PeriodReport[];
  monthly: PeriodReport[];
}

export function buildReportArchive(
  refKey: string = REFERENCE_KEY,
  options: { weeks?: number; months?: number; system?: UnitSystem } = {}
): ReportArchive {
  const system = options.system ?? 'metric';
  return {
    weekly: buildWeeklyReports(refKey, options.weeks ?? 12, system),
    monthly: buildMonthlyReports(refKey, options.months ?? 7, system),
  };
}

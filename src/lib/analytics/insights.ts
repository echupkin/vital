// ── Evidence-gated insights (SPEC §7) ───────────────────
//
// An insight exists only when the dataset can actually support it: each one is
// built from a comparison or a paired correlation, and it is dropped entirely
// when the observation count falls below the threshold. Nothing is emitted from
// a single reading, and no insight is written by hand.

import { getMetric } from '../metrics/registry';
import { REFERENCE_KEY, seriesFor } from '../adapters/dataset';
import { formatMetricWithUnit, formatPercent } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import { compareWindows } from './comparisons';
import { coverageSentence } from './coverage';
import { computeRelationship, describeCoefficient, MIN_PAIRED_OBSERVATIONS, ASSOCIATION_NOTE } from './relationships';
import { buildWeeklyReports } from './reports';
import { trailingWindow, windowRangeLabel } from './windows';

export type InsightKind = 'trend' | 'change' | 'association' | 'report';

export interface InsightEvidence {
  metricId: string;
  metricName: string;
  windowLabel: string;
  aggregation: string;
  coverage: string;
  href: string;
}
export interface Insight {
  id: string;
  kind: InsightKind;
  /** Short observation title, generated from the comparison. */
  title: string;
  /** One-sentence explanation. */
  summary: string;
  /** The full evidence sentence, including windows and counts. */
  detail: string;
  metricId: string;
  metricIds: string[];
  windowLabel: string;
  coverage: string;
  /** Computed values the insight rests on, formatted for display. */
  computed: string[];
  /** Bounded series used for the card's chart (never the whole record set). */
  points: { key: string; value: number }[];
  evidence: InsightEvidence[];
  /** Route that opens the metric at this period. */
  href: string;
  /** Observational note, never a causal claim. */
  caveat: string;
}

/** Both sides of any comparison must carry at least this many observations. */
export const MIN_INSIGHT_OBSERVATIONS = 5;
/** A change below this magnitude is not worth a card. */
export const MIN_INSIGHT_CHANGE_PERCENT = 5;
/** A coefficient below this magnitude is reported as "very weak" and not carded. */
export const MIN_ASSOCIATION_STRENGTH = 0.2;

const CHANGE_METRICS = [
  'sleep_analysis',
  'resting_heart_rate',
  'heart_rate_variability',
  'step_count',
  'apple_exercise_time',
  'active_energy',
] as const;

const TREND_METRICS = CHANGE_METRICS;

const ASSOCIATION_PAIRS: { x: string; y: string; lag: 'same-day' | 'lagged'; question: string }[] = [
  { x: 'sleep_analysis', y: 'heart_rate_variability', lag: 'same-day', question: 'Are my sleep and my recovery aligned?' },
  { x: 'dietary_caffeine', y: 'sleep_analysis', lag: 'lagged', question: 'Is caffeine linked to the following night?' },
  { x: 'step_count', y: 'active_energy', lag: 'same-day', question: 'Do steps and active energy move together?' },
];

function metricName(id: string): string {
  return getMetric(id)?.displayName ?? id;
}

function rangeHref(metricId: string, range: string): string {
  return `/metric/${metricId}?range=${range}`;
}

/** Bounded points for an insight card: at most the evaluated window, capped. */
function windowPoints(metricId: string, startKey: string, endKey: string, cap = 90): { key: string; value: number }[] {
  return seriesFor(metricId)
    .filter(p => p.key >= startKey && p.key <= endKey)
    .slice(-cap)
    .map(p => ({ key: p.key, value: p.value }));
}

/** Every insight the dataset can currently support, most significant first. */
export function generateInsights(refKey: string = REFERENCE_KEY, system: UnitSystem = 'metric'): Insight[] {
  const out: Insight[] = [];

  // ── Changes: last 7 days against the preceding 7 ──────
  for (const metricId of CHANGE_METRICS) {
    const cmp = compareWindows(metricId, refKey, 7, { meta: getMetric(metricId) });
    const { comparison } = cmp;
    if (
      !comparison.valid ||
      comparison.deltaPercent == null ||
      comparison.delta === 0 ||
      cmp.counts.evaluated < MIN_INSIGHT_OBSERVATIONS ||
      cmp.counts.baseline < MIN_INSIGHT_OBSERVATIONS ||
      Math.abs(comparison.deltaPercent) < MIN_INSIGHT_CHANGE_PERCENT
    ) {
      continue;
    }
    const name = metricName(metricId);
    const dir = comparison.deltaPercent > 0 ? 'higher' : 'lower';
    out.push({
      id: `change-${metricId}-7d`,
      kind: 'change',
      title: `${name} is ${Math.abs(comparison.deltaPercent).toFixed(1)}% ${dir} than the preceding week`,
      summary: `${cmp.lengthLabel} compared; ${formatMetricWithUnit(metricId, comparison.current, system)} now against ${formatMetricWithUnit(metricId, comparison.baseline, system)} before.`,
      detail: `${name} averaged ${formatMetricWithUnit(metricId, comparison.current, system)} across ${windowRangeLabel(cmp.evaluatedWindow)}, against ${formatMetricWithUnit(metricId, comparison.baseline, system)} across ${windowRangeLabel(cmp.baselineWindow)} (${formatPercent(comparison.deltaPercent)}).`,
      metricId,
      metricIds: [metricId],
      windowLabel: cmp.rangeLabel,
      coverage: `${cmp.counts.evaluated} and ${cmp.counts.baseline} observations · ${coverageSentence(metricId)}`,
      computed: [
        `This period: ${formatMetricWithUnit(metricId, comparison.current, system)}`,
        `Prior period: ${formatMetricWithUnit(metricId, comparison.baseline, system)}`,
        `Change: ${formatMetricWithUnit(metricId, comparison.delta, system)} (${formatPercent(comparison.deltaPercent)})`,
        `Window: ${cmp.rangeLabel}`,
        `Coverage: ${cmp.counts.evaluated} vs ${cmp.counts.baseline} observations`,
      ],
      points: windowPoints(metricId, cmp.evaluatedWindow.startKey, cmp.evaluatedWindow.endKey),
      evidence: [
        {
          metricId,
          metricName: name,
          windowLabel: cmp.rangeLabel,
          aggregation: cmp.accumulating ? 'daily total, complete days only' : 'daily average',
          coverage: `${cmp.counts.evaluated} observations evaluated, ${cmp.counts.baseline} in the baseline`,
          href: rangeHref(metricId, '7d'),
        },
      ],
      href: rangeHref(metricId, '7d'),
      caveat: cmp.exclusionNote ?? 'A single week is a short window; day-to-day variation alone can produce a change of this size.',
    });
  }

  // ── Trends: last 90 days against the preceding 90 ─────
  for (const metricId of TREND_METRICS) {
    const cmp = compareWindows(metricId, refKey, 90, { meta: getMetric(metricId), strategyOverride: 'avg' });
    const { comparison } = cmp;
    if (
      !comparison.valid ||
      comparison.deltaPercent == null ||
      cmp.counts.evaluated < 20 ||
      cmp.counts.baseline < 20 ||
      Math.abs(comparison.deltaPercent) < MIN_INSIGHT_CHANGE_PERCENT
    ) {
      continue;
    }
    const name = metricName(metricId);
    const dir = comparison.deltaPercent > 0 ? 'higher' : 'lower';
    out.push({
      id: `trend-${metricId}-90d`,
      kind: 'trend',
      title: `${name} over 90 days is ${Math.abs(comparison.deltaPercent).toFixed(1)}% ${dir} than the 90 days before`,
      summary: `Daily average ${formatMetricWithUnit(metricId, comparison.current, system)} against ${formatMetricWithUnit(metricId, comparison.baseline, system)} in the preceding 90 days.`,
      detail: `${name} averaged ${formatMetricWithUnit(metricId, comparison.current, system)} across ${windowRangeLabel(cmp.evaluatedWindow)} and ${formatMetricWithUnit(metricId, comparison.baseline, system)} across ${windowRangeLabel(cmp.baselineWindow)} (${formatPercent(comparison.deltaPercent)}).`,
      metricId,
      metricIds: [metricId],
      windowLabel: cmp.rangeLabel,
      coverage: `${cmp.counts.evaluated} and ${cmp.counts.baseline} observations · ${coverageSentence(metricId)}`,
      computed: [
        `90-day average: ${formatMetricWithUnit(metricId, comparison.current, system)}`,
        `Previous 90-day average: ${formatMetricWithUnit(metricId, comparison.baseline, system)}`,
        `Change: ${formatPercent(comparison.deltaPercent)}`,
        `Window: ${cmp.rangeLabel}`,
      ],
      points: windowPoints(metricId, cmp.evaluatedWindow.startKey, cmp.evaluatedWindow.endKey),
      evidence: [
        {
          metricId,
          metricName: name,
          windowLabel: cmp.rangeLabel,
          aggregation: 'daily average',
          coverage: `${cmp.counts.evaluated} observations evaluated, ${cmp.counts.baseline} in the baseline`,
          href: rangeHref(metricId, '90d'),
        },
      ],
      href: rangeHref(metricId, '90d'),
      caveat: 'This compares two 90-day windows; a sustained change and a change at the edges of the window look the same here.',
    });
  }

  // ── Associations: only with enough paired days ────────
  const assocWindow = trailingWindow(refKey, 90);
  for (const pair of ASSOCIATION_PAIRS) {
    const result = computeRelationship(pair.x, pair.y, assocWindow, pair.lag, 1);
    if (!result.valid || result.coefficient == null || Math.abs(result.coefficient) < MIN_ASSOCIATION_STRENGTH) continue;
    const nameX = metricName(pair.x);
    const nameY = metricName(pair.y);
    const direction = result.coefficient > 0 ? 'moved together' : 'moved in opposite directions';
    out.push({
      id: `association-${pair.x}-${pair.y}`,
      kind: 'association',
      title: `${nameX} and ${nameY} ${direction} across ${windowRangeLabel(assocWindow)}`,
      summary: `${describeCoefficient(result.coefficient)} (r = ${result.coefficient.toFixed(2)}) across ${result.pairedCount} paired days.`,
      detail: `Pairing ${nameX} with ${nameY} on ${pair.lag === 'lagged' ? 'the following day' : 'the same day'} gives a Pearson coefficient of ${result.coefficient.toFixed(2)} across ${result.pairedCount} days that have a reading for both metrics in ${windowRangeLabel(assocWindow)}.`,
      metricId: pair.x,
      metricIds: [pair.x, pair.y],
      windowLabel: windowRangeLabel(assocWindow),
      coverage: `${result.pairedCount} paired days of ${result.xCount} ${nameX} readings and ${result.yCount} ${nameY} readings`,
      computed: [
        `Coefficient: ${result.coefficient.toFixed(2)} (${describeCoefficient(result.coefficient)})`,
        `Paired days: ${result.pairedCount}`,
        `${nameX} readings in window: ${result.xCount}`,
        `${nameY} readings in window: ${result.yCount}`,
        `Alignment: ${pair.lag === 'lagged' ? 'lagged by 1 day' : 'same day'}`,
      ],
      points: windowPoints(pair.y, assocWindow.startKey, assocWindow.endKey),
      evidence: [
        {
          metricId: pair.y,
          metricName: nameY,
          windowLabel: windowRangeLabel(assocWindow),
          aggregation: 'daily value, paired by calendar day',
          coverage: `${result.pairedCount} paired days (minimum ${MIN_PAIRED_OBSERVATIONS})`,
          href: '/trends',
        },
      ],
      href: '/trends',
      caveat: ASSOCIATION_NOTE,
    });
  }

  // ── Report: the latest complete week ─────────────────
  const [latestWeek] = buildWeeklyReports(refKey, 1, system);
  if (latestWeek && latestWeek.lines.some(l => l.observations > 0)) {
    const covered = latestWeek.lines.filter(l => l.observations > 0);
    out.push({
      id: `report-${latestWeek.id}`,
      kind: 'report',
      title: `Your latest complete week: ${latestWeek.periodLabel}`,
      summary: latestWeek.highlights.length
        ? latestWeek.highlights.join(' · ')
        : 'No tracked metric moved by 5% or more against the preceding week.',
      detail: latestWeek.paragraphs[0],
      metricId: covered[0]?.metricId ?? 'sleep_analysis',
      metricIds: covered.map(l => l.metricId),
      windowLabel: windowRangeLabel(latestWeek.window),
      coverage: latestWeek.coverageNote,
      computed: covered.map(l => `${l.metricName}: ${l.value} (${l.coverage})`),
      points: windowPoints(covered[0]?.metricId ?? 'sleep_analysis', latestWeek.window.startKey, latestWeek.window.endKey),
      evidence: covered.slice(0, 3).map(l => ({
        metricId: l.metricId,
        metricName: l.metricName,
        windowLabel: windowRangeLabel(latestWeek.window),
        aggregation: l.aggregation,
        coverage: l.coverage,
        href: rangeHref(l.metricId, '7d'),
      })),
      href: '/insights?tab=reports',
      caveat: 'Composed from this dataset at render time; no report content is written by hand.',
    });
  }

  return out;
}

export interface InsightFilterCounts {
  all: number;
  trend: number;
  change: number;
  association: number;
  report: number;
}

export function insightCounts(insights: Insight[]): InsightFilterCounts {
  return {
    all: insights.length,
    trend: insights.filter(i => i.kind === 'trend').length,
    change: insights.filter(i => i.kind === 'change').length,
    association: insights.filter(i => i.kind === 'association').length,
    report: insights.filter(i => i.kind === 'report').length,
  };
}

export function filterInsights(insights: Insight[], kind: 'all' | InsightKind): Insight[] {
  return kind === 'all' ? insights : insights.filter(i => i.kind === kind);
}

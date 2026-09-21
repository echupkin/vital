// ── Metric-aware formatting ─────────────────────────────
//
// Every number rendered anywhere in Vital goes through these helpers, which in
// turn use the registry's formatter. Raw values never reach the DOM.

import { getMetric } from './registry';
import type { MetricDefinition } from './types';
import type { UnitSystem } from '../prefs';

export const NO_CHANGE = 'no change';

// ── Unit conversion ────────────────────────────────────

interface Conversion {
  imperialUnit: string;
  toImperial: (v: number) => number;
  fromImperial: (v: number) => number;
}

const CONVERSIONS: Record<string, Conversion> = {
  kg: { imperialUnit: 'lb', toImperial: v => v * 2.2046226218, fromImperial: v => v / 2.2046226218 },
  km: { imperialUnit: 'mi', toImperial: v => v * 0.6213711922, fromImperial: v => v / 0.6213711922 },
  cm: { imperialUnit: 'in', toImperial: v => v * 0.3937007874, fromImperial: v => v / 0.3937007874 },
};

export function hasConversion(canonicalUnit: string): boolean {
  return canonicalUnit in CONVERSIONS;
}

export function convertValue(value: number, canonicalUnit: string, system: UnitSystem): number {
  if (system !== 'imperial') return value;
  const rule = CONVERSIONS[canonicalUnit];
  return rule ? rule.toImperial(value) : value;
}

/** Convert a displayed (possibly imperial) value back to its canonical unit. */
export function toCanonicalValue(value: number, canonicalUnit: string, system: UnitSystem): number {
  if (system !== 'imperial') return value;
  const rule = CONVERSIONS[canonicalUnit];
  return rule ? rule.fromImperial(value) : value;
}

export function displayUnit(canonicalUnit: string, system: UnitSystem): string {
  if (system !== 'imperial') return canonicalUnit;
  return CONVERSIONS[canonicalUnit]?.imperialUnit ?? canonicalUnit;
}

/**
 * The unit to print for a metric. An explicitly empty `shortUnit` means the
 * metric has no printable unit (a bare count), so nothing is appended.
 */
export function metricUnit(metricId: string, system: UnitSystem = 'metric'): string {
  const meta = getMetric(metricId);
  if (!meta) return '';
  if (meta.shortUnit === '') return '';
  return displayUnit(meta.shortUnit || meta.canonicalUnit, system);
}

// ── Formatter plumbing ─────────────────────────────────

/** True when the registry formatter already embeds its unit ('97.5%', '7h 12m', '1.8L'). */
function formatterEmbedsUnit(formatted: string): boolean {
  return /[a-zA-Z%°]/.test(formatted);
}

/** Format a canonical value for display, honouring the unit preference. */
export function formatMetricValue(metricId: string, value: number, system: UnitSystem = 'metric'): string {
  const meta = getMetric(metricId);
  if (!isFinite(value)) return '—';
  if (!meta) return String(value);
  return meta.formatter(convertValue(value, meta.canonicalUnit, system));
}

/** Format a value plus its unit, without duplicating a unit the formatter already shows. */
export function formatMetricWithUnit(metricId: string, value: number, system: UnitSystem = 'metric'): string {
  const meta = getMetric(metricId);
  if (!isFinite(value)) return '—';
  if (!meta) return String(value);
  const text = meta.formatter(convertValue(value, meta.canonicalUnit, system));
  if (formatterEmbedsUnit(text)) return text;
  const unit = metricUnit(metricId, system);
  return unit ? `${text} ${unit}` : text;
}

/** Signed delta, e.g. '+1.3' / '−3' / 'no change'. */
export function formatDeltaValue(metricId: string, delta: number, system: UnitSystem = 'metric'): string {
  if (!isFinite(delta)) return '—';
  if (delta === 0) return NO_CHANGE;
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${formatMetricValue(metricId, Math.abs(delta), system)}`;
}

/** Signed delta with unit, e.g. '+1.3 bpm'. */
export function formatDeltaWithUnit(metricId: string, delta: number, system: UnitSystem = 'metric'): string {
  if (!isFinite(delta)) return '—';
  if (delta === 0) return NO_CHANGE;
  const sign = delta > 0 ? '+' : '-';
  return `${sign}${formatMetricWithUnit(metricId, Math.abs(delta), system)}`;
}

/**
 * Format a duration given in minutes as hours:minutes — '1:25', '0:45', '12:03'.
 *
 * The single formatter for every workout-duration aggregate (weekly totals,
 * averages, per-week sums). Per-session durations keep their own minutes form;
 * this is for figures that accumulate across sessions, where minutes stop being
 * readable. The exact minute value belongs in a title/aria label alongside it.
 */
export function formatDurationHm(minutes: number): string {
  if (!isFinite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

/** '1:25 (85 min)' — the h:mm figure with its exact minute value kept alongside it. */
export function formatDurationHmWithExact(minutes: number): string {
  if (!isFinite(minutes)) return '—';
  return `${formatDurationHm(minutes)} (${Math.round(minutes)} min)`;
}

/**
 * Registry metrics whose canonical unit is minutes and which are only ever shown
 * as an aggregate (a weekly total, a 7-day exercise figure). These are rendered
 * as h:mm everywhere; every other metric keeps its own formatter.
 */
export const DURATION_AGGREGATE_METRIC_IDS = new Set(['apple_exercise_time']);

/** Format an aggregate value, in h:mm when the metric is a duration aggregate. */
export function formatDurationAggregate(
  metricId: string,
  value: number,
  system: UnitSystem = 'metric'
): string {
  if (DURATION_AGGREGATE_METRIC_IDS.has(metricId)) return formatDurationHm(value);
  return formatMetricWithUnit(metricId, value, system);
}

/** The exact-value form of a duration aggregate, for a tooltip / aria label. */
export function durationAggregateExact(value: number): string {
  return `${Math.round(value)} min`;
}

export function formatPercent(pct: number | null, digits = 1): string {
  if (pct == null || !isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

/** Axis ticks: registry tick formatter when present, otherwise the value formatter. */
export function formatMetricTick(metricId: string, value: number, system: UnitSystem = 'metric'): string {
  const meta = getMetric(metricId);
  if (!isFinite(value)) return '';
  if (!meta) return String(value);
  const converted = convertValue(value, meta.canonicalUnit, system);
  if (meta.tickFormatter) return meta.tickFormatter(converted);
  return meta.formatter(converted);
}

// ── Change description ────────────────────────────────

export type ChangeTone = 'neutral' | 'attention';

export interface ChangeDescription {
  /** Headline form of the change: 'no change', '+1.3 bpm', '-3 ms' … */
  value: string;
  /** Percentage form of the change, or null when the denominator was zero. */
  percent: string | null;
  /** A calm, non-judgemental phrase. Never implies good/bad. */
  phrase: string;
  tone: ChangeTone;
  /** Which side of the baseline the evaluated value sits on, for neutral cues. */
  direction: 'above' | 'below' | 'none';
}

/**
 * Describe a comparison between an evaluated window and its baseline.
 *
 * Tone is neutral by default. `attention` is used only when the metric's
 * registry definition opts in (via `attentionThreshold`) and the change
 * exceeds it — lower resting HR and higher HRV are never auto-coloured.
 */
export function describeChange(
  metricId: string,
  delta: number,
  deltaPercent: number | null,
  options: { comparisonLabel?: string; system?: UnitSystem; days?: number } = {}
): ChangeDescription {
  const { comparisonLabel = 'the previous period', system = 'metric', days } = options;
  const windowPhrase = days ? `the prior ${days} days` : comparisonLabel;

  if (!isFinite(delta)) {
    return { value: '—', percent: null, phrase: 'Not enough data to compare.', tone: 'neutral', direction: 'none' };
  }
  if (delta === 0) {
    return {
      value: NO_CHANGE,
      // A zero change has no meaningful percentage — never render a bare 0%.
      percent: null,
      phrase: `No change vs ${windowPhrase}.`,
      tone: 'neutral',
      direction: 'none',
    };
  }
  return {
    value: formatDeltaWithUnit(metricId, delta, system),
    percent: formatPercent(deltaPercent),
    phrase: `Compared with ${windowPhrase}.`,
    tone: 'neutral',
    direction: delta > 0 ? 'above' : 'below',
  };
}

export function metricOrDefaultFormatter(meta: MetricDefinition | undefined, value: number): string {
  if (!meta) return isFinite(value) ? String(value) : '—';
  return meta.formatter(value);
}
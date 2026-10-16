// ── Recovery indicators ─────────────────────────────────
//
// What the body says about readiness to progress, from Apple Health data
// already in the dataset plus the training sessions themselves:
//
//   resting_hr        mean of the last 7 days vs the 28 days before them (bpm)
//   hrv               same windows (ms)
//   sleep_hours       mean time asleep over the last 7 nights (h)
//   body_weight_rate  the weight trend: a least-squares line over 28 days with
//                     recent weeks counting more (analytics/weight-trend), kg / week
//   training_load     training sessions in the last 7 days vs the weekly mean
//                     of the 28 days before them (% change)
//
// Every indicator is reported with its numbers and windows, the readings behind
// them, and the plan's rule for it in words. A plan's recovery gates decide
// which ones matter and how much (`watch` or `warn`); without a gate an
// indicator is shown for information only. Body weight is a callout: its gate
// flags the trend on the recovery page but never holds progression back.

import { addDays } from '../analytics/windows';
import { WEIGHT_TREND_DAYS, WEIGHT_TREND_WINDOW, weightTrendSlope } from '../analytics/weight-trend';
import type { UnitSystem } from '../prefs';
import { convertValue, displayUnit } from '../metrics/format';
import type { RecoveryGate, RecoverySignalId } from './types';

export interface DayValue {
  key: string;
  value: number;
}

export type RecoveryStatus = 'ok' | 'watch' | 'warn' | 'info' | 'unknown';

export interface RecoveryIndicator {
  signal: RecoverySignalId;
  label: string;
  /** Recent value, in display units. */
  current: number | null;
  /** Comparison value, in display units (null when the signal has none). */
  baseline: number | null;
  unit: string;
  /** Plain sentence with the numbers and windows. */
  text: string;
  status: RecoveryStatus;
  gate?: RecoveryGate;
  observations: number;
  /**
   * The readings behind the numbers, oldest first, in display units: daily for
   * the health signals, one point per week (keyed by its first day) for
   * training load.
   */
  points: DayValue[];
  /** First day of the window `current` is measured over; points before it are the baseline. */
  recentFrom: string;
  /** The plan's gate in words ("Watch if …"), null without a gate. */
  rule: string | null;
  /** What to do about it, only while the gate is tripped (watch or warn). */
  advice: string | null;
}

/** Signals whose gates are callouts only: flagged, never a reason to hold progression. */
const CALLOUT_SIGNALS: ReadonlySet<RecoverySignalId> = new Set(['body_weight_rate']);

/** Whether this indicator's gate can cap the lights and hold progression. */
export function holdsProgression(i: Pick<RecoveryIndicator, 'signal' | 'gate'>): boolean {
  return Boolean(i.gate) && !CALLOUT_SIGNALS.has(i.signal);
}

/** A gated callout (body weight) outside its limit: shown, but holding nothing back. */
export function trippedCallouts(indicators: RecoveryIndicator[]): RecoveryIndicator[] {
  return indicators.filter(i => i.gate && !holdsProgression(i) && (i.status === 'watch' || i.status === 'warn'));
}

export interface RecoveryInputs {
  /** Daily series by metric id: resting_heart_rate, heart_rate_variability, sleep_analysis (minutes asleep), weight_body_mass (kg). */
  series: (metricId: string) => DayValue[];
  /** Local days on which a training session was logged. */
  trainingDays: string[];
  today: string;
  system: UnitSystem;
}

const LABELS: Record<RecoverySignalId, string> = {
  resting_hr: 'Resting heart rate',
  hrv: 'Heart rate variability',
  sleep_hours: 'Sleep',
  body_weight_rate: 'Body-weight trend',
  training_load: 'Training load',
};

/** What each signal's value is, for the rule sentence. */
const SUBJECTS: Record<RecoverySignalId, string> = {
  resting_hr: 'the 7-day average',
  hrv: 'the 7-day average',
  sleep_hours: 'average sleep over the last 7 nights',
  body_weight_rate: `the ${WEIGHT_TREND_DAYS}-day weight trend`,
  training_load: 'sessions in the last 7 days',
};

const BASELINES: Record<RecoverySignalId, string> = {
  resting_hr: 'the 28 days before',
  hrv: 'the 28 days before',
  sleep_hours: 'its baseline',
  body_weight_rate: 'its baseline',
  training_load: 'the weekly average of the 4 weeks before',
};

// General guidance, never treatment: the analyst's own rule (systemPrompt.ts)
// is to suggest a professional rather than give medical advice.
const ADVICE: Record<RecoverySignalId, string> = {
  resting_hr:
    'A raised resting heart rate often follows hard training, short sleep, stress or an oncoming cold. Keep sessions easy and sleep well until it settles back toward your usual level.',
  hrv: 'HRV away from your usual level often follows hard training, short sleep, alcohol or stress. Keep effort moderate and prioritise sleep until it settles.',
  sleep_hours: 'Short sleep slows recovery more than anything else here. Protect a regular bedtime before adding load.',
  body_weight_rate:
    'Body weight is changing faster than the plan allows. If you are losing weight, eating a little more supports recovery; if gaining, check the trend against your goal.',
  training_load:
    'Your training frequency has changed sharply from the weeks before. After a jump, hold doses until the new rhythm settles; after a gap, ease back in rather than resuming at full volume.',
};

/** The plan's gate in words, with the threshold in display units. */
function ruleText(signal: RecoverySignalId, gate: RecoveryGate | undefined, system: UnitSystem): string | null {
  if (!gate) return null;
  const raw = gate.threshold ?? 0;
  // Gates are written in kg/week regardless of the display unit.
  const amount =
    signal === 'body_weight_rate'
      ? `${round(convertValue(raw, 'kg', system), 2)} ${displayUnit('kg', system)}/week`
      : signal === 'training_load'
        ? `${raw}%`
        : `${raw} ${signal === 'resting_hr' ? 'bpm' : signal === 'hrv' ? 'ms' : 'h'}`;
  const who = CALLOUT_SIGNALS.has(signal) ? 'Flag' : gate.severity === 'warn' ? 'Hold progression' : 'Watch';
  if (signal === 'training_load') {
    // The gate is on the % change against the weekly average.
    const vs = BASELINES.training_load;
    switch (gate.rule) {
      case 'rising': return `${who} if sessions in the last 7 days rise ${raw}% or more above ${vs}.`;
      case 'falling': return `${who} if sessions in the last 7 days drop ${raw}% or more below ${vs}.`;
      case 'above': return raw < 0 ? `${who} if sessions in the last 7 days are less than ${-raw}% below ${vs}.` : `${who} if sessions in the last 7 days are more than ${raw}% above ${vs}.`;
      case 'below': return raw < 0 ? `${who} if sessions in the last 7 days are more than ${-raw}% below ${vs}.` : `${who} if sessions in the last 7 days are less than ${raw}% above ${vs}.`;
    }
  }
  const subject = SUBJECTS[signal];
  switch (gate.rule) {
    case 'below': return `${who} if ${subject} is below ${amount}.`;
    case 'above': return `${who} if ${subject} is above ${amount}.`;
    case 'rising': return `${who} if ${subject} rises ${amount} or more above ${BASELINES[signal]}.`;
    case 'falling': return `${who} if ${subject} drops ${amount} or more below ${BASELINES[signal]}.`;
  }
}

function between(points: DayValue[], from: string, to: string): number[] {
  return points.filter(p => p.key >= from && p.key <= to && Number.isFinite(p.value)).map(p => p.value);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function pointsBetween(points: DayValue[], from: string, to: string, shown: (v: number) => number): DayValue[] {
  return points
    .filter(p => p.key >= from && p.key <= to && Number.isFinite(p.value))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(p => ({ key: p.key, value: shown(p.value) }));
}

function adviceFor(signal: RecoverySignalId, status: RecoveryStatus): string | null {
  return status === 'watch' || status === 'warn' ? ADVICE[signal] : null;
}

function judgeGate(gate: RecoveryGate | undefined, current: number | null, baseline: number | null): RecoveryStatus {
  if (!gate) return 'info';
  if (current === null) return 'unknown';
  const threshold = gate.threshold ?? 0;
  let tripped = false;
  switch (gate.rule) {
    case 'below': tripped = current < threshold; break;
    case 'above': tripped = current > threshold; break;
    case 'rising': tripped = baseline !== null && current - baseline >= threshold; break;
    case 'falling': tripped = baseline !== null && baseline - current >= threshold; break;
  }
  return tripped ? gate.severity : 'ok';
}

export function recoveryIndicators(inputs: RecoveryInputs, gates: RecoveryGate[]): RecoveryIndicator[] {
  const { today, system } = inputs;
  const recentFrom = addDays(today, -6);
  const baseFrom = addDays(today, -34);
  const baseTo = addDays(today, -7);
  const gateFor = (s: RecoverySignalId) => gates.find(g => g.signal === s);
  const out: RecoveryIndicator[] = [];

  for (const [signal, metricId, unit] of [
    ['resting_hr', 'resting_heart_rate', 'bpm'],
    ['hrv', 'heart_rate_variability', 'ms'],
  ] as const) {
    const series = inputs.series(metricId);
    const recent = between(series, recentFrom, today);
    const base = between(series, baseFrom, baseTo);
    const current = mean(recent);
    const baseline = mean(base);
    const gate = gateFor(signal);
    const status = judgeGate(gate, current, baseline);
    out.push({
      signal,
      label: LABELS[signal],
      current: current === null ? null : round(current),
      baseline: baseline === null ? null : round(baseline),
      unit,
      observations: recent.length,
      status,
      gate,
      points: pointsBetween(series, baseFrom, today, v => round(v)),
      recentFrom,
      rule: ruleText(signal, gate, system),
      advice: adviceFor(signal, status),
      text:
        current === null
          ? `No ${LABELS[signal].toLowerCase()} readings in the last 7 days.`
          : `${round(current)} ${unit} over the last 7 days${baseline === null ? '' : ` vs ${round(baseline)} ${unit} over the 28 days before`}.`,
    });
  }

  {
    const sleep = inputs.series('sleep_analysis');
    const nights = between(sleep, recentFrom, today).map(m => m / 60);
    const current = mean(nights);
    const gate = gateFor('sleep_hours');
    const status = judgeGate(gate, current, null);
    out.push({
      signal: 'sleep_hours',
      label: LABELS.sleep_hours,
      current: current === null ? null : round(current, 2),
      baseline: null,
      unit: 'h',
      observations: nights.length,
      status,
      gate,
      points: pointsBetween(sleep, baseFrom, today, m => round(m / 60, 2)),
      recentFrom,
      rule: ruleText('sleep_hours', gate, system),
      advice: adviceFor('sleep_hours', status),
      text: current === null ? 'No sleep recorded in the last 7 nights.' : `${round(current, 2)} h asleep on average over the last ${nights.length} night${nights.length === 1 ? '' : 's'}.`,
    });
  }

  {
    const trendFrom = addDays(today, -(WEIGHT_TREND_DAYS - 1));
    const weights = inputs.series('weight_body_mass').filter(p => p.key >= trendFrom && p.key <= today);
    const perDay = weightTrendSlope(weights, today);
    const kgPerWeek = perDay === null ? null : perDay * 7;
    const gate = gateFor('body_weight_rate');
    const shown = kgPerWeek === null ? null : round(convertValue(kgPerWeek, 'kg', system), 2);
    const unit = `${displayUnit('kg', system)}/week`;
    // Gates are written in kg/week regardless of the display unit.
    const status = judgeGate(gate, kgPerWeek, null);
    out.push({
      signal: 'body_weight_rate',
      label: LABELS.body_weight_rate,
      current: shown,
      baseline: null,
      unit,
      observations: weights.length,
      status,
      gate,
      // The whole window is the trend: there is no separate baseline.
      points: pointsBetween(weights, trendFrom, today, kg => round(convertValue(kg, 'kg', system), 2)),
      recentFrom: trendFrom,
      rule: ruleText('body_weight_rate', gate, system),
      advice: adviceFor('body_weight_rate', status),
      text:
        shown === null
          ? `Not enough weigh-ins in the last ${WEIGHT_TREND_DAYS} days for a trend.`
          : `${shown > 0 ? '+' : ''}${shown} ${unit} over the ${WEIGHT_TREND_WINDOW} (${weights.length} weigh-ins).`,
    });
  }

  {
    const recent = inputs.trainingDays.filter(d => d >= recentFrom && d <= today).length;
    const base = inputs.trainingDays.filter(d => d >= baseFrom && d <= baseTo).length / 4;
    const change = base > 0 ? ((recent - base) / base) * 100 : null;
    const gate = gateFor('training_load');
    const status = judgeGate(gate, change, 0);
    const weeks = [4, 3, 2, 1, 0].map(ago => {
      const from = addDays(today, -6 - ago * 7);
      const to = addDays(from, 6);
      return { key: from, value: inputs.trainingDays.filter(d => d >= from && d <= to).length };
    });
    out.push({
      signal: 'training_load',
      label: LABELS.training_load,
      current: recent,
      baseline: round(base),
      unit: 'sessions/week',
      observations: recent,
      status,
      gate,
      points: weeks,
      recentFrom,
      rule: ruleText('training_load', gate, system),
      advice: adviceFor('training_load', status),
      text:
        base > 0
          ? `${recent} session${recent === 1 ? '' : 's'} in the last 7 days vs ${round(base)} a week before that (${change! >= 0 ? '+' : ''}${Math.round(change!)}%).`
          : `${recent} session${recent === 1 ? '' : 's'} in the last 7 days.`,
    });
  }

  return out;
}

/** The worst gated status, for a one-word recovery chip. */
export function recoverySummary(indicators: RecoveryIndicator[]): { status: 'ok' | 'watch' | 'warn' | 'unknown'; text: string } {
  const callouts = trippedCallouts(indicators);
  const note = callouts.length ? ` ${callouts.map(i => i.label).join(', ')} is outside the plan’s range (a callout only; it does not hold progression).` : '';
  const result = (status: 'ok' | 'watch' | 'warn' | 'unknown', text: string) => ({ status, text: text + note });
  const gated = indicators.filter(holdsProgression);
  if (gated.length === 0) return result('unknown', 'No recovery gates that hold progression are set in this plan.');
  const warn = gated.filter(i => i.status === 'warn');
  const watch = gated.filter(i => i.status === 'watch');
  if (warn.length) return result('warn', `${warn.map(i => i.label).join(', ')} outside the plan's limits.`);
  if (watch.length) return result('watch', `Watch: ${watch.map(i => i.label.toLowerCase()).join(', ')}.`);
  if (gated.every(i => i.status === 'unknown')) return result('unknown', 'Not enough recent data to check recovery.');
  return result('ok', 'Recovery signals are inside the plan’s limits.');
}

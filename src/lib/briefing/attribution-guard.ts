// ── Today's briefing: metric-aware number guard ──────────
//
// The old guard asked one question of every numeral: "does this number appear
// SOMEWHERE in the context?" That is enough to catch a fabricated figure, but
// not a figure the model borrowed from a different metric. On the live
// deployment a reply said "Resting heart rate (55.7 bpm) and HRV (56 ms)" where
// 55.7 is an HRV value — true of the data, false of the sentence, and it
// passed a guard that only looked for the number anywhere.
//
// This module answers the stricter question: does each number belong to the
// metric the claim is about? It works in three steps.
//
//   1. Turn the context into one *group* per metric it actually describes
//      (each core metric row, sleep, workouts). A group carries the names the
//      model may call it by, the units it is measured in, and every value the
//      context supplies for it — the raw figures (7-day mean, prior-7 mean,
//      30-day baseline, latest, coverage counts, the change) and the numbers
//      stated by its ready-formatted `display` strings, so quoting "7h 5m" is
//      recognised as sleep's 425 minutes.
//
//   2. Split the generated text into claims (sentences). For each claim, work
//      out which metrics it is talking about: the groups whose name/alias
//      appears in it, plus the groups named by any unit word it uses.
//
//   3. For every number in the claim, require it to come from the metrics the
//      claim is about (or from the shared figures — window lengths, dates, the
//      age — which belong to no single metric). A number that is immediately
//      labelled with a unit is held to that unit's metrics specifically, so a
//      value labelled `bpm` may not be drawn from the `ms` (HRV) set even when
//      the same sentence also mentions HRV.
//
// A number that exists in the context only under a *different* metric is a
// violation. So is a number that is nowhere in the context, and so is a value
// whose unit label contradicts the metric it matches.
//
// WHERE THE LINE IS DRAWN (rounding and restatement):
//
//   * rounding is allowed: a token is accepted when it is within 0.5 or 2% of a
//     value the claim's metric supplies, or equals it exactly. The minutes↔hours
//     relation is allowed too, because the context states durations as "7h 5m"
//     and a model may restate them as "425 min" or vice versa (derivationsOf).
//   * unit restatement is allowed: the numbers a `display` string states are
//     part of its metric's set, so "6.3K steps" (display "6.3K") and "6,300
//     steps" (the raw value) are both accepted for steps.
//   * a range is accepted when both endpoints are in the metric's set — that is
//     just two tokens, each checked on its own.
//
//   Two lines keep that tolerance from laundering a wrong-metric figure, and
//   they are the difference between this guard and a flat existence check:
//
//     i. A figure that is only *loosely* a value of the claim's metric, but is
//        EXACTLY a value another metric supplies, is that other metric's figure
//        and is rejected. Rounding is not allowed to reach across metrics.
//    ii. Rounding may lose precision, never invent it: "56" may restate a 56-day
//        count, but "55.7" may not be read as that 56, because a decimal
//        restatement of an integer is a different number. This rejects the case
//        where no metric supplies the figure at all.
//
//   What is NOT allowed: a value only another metric supplies, a value no metric
//   supplies, and scaling (×1000 is deliberately absent) — any of which would
//   launder the exact defect this guard exists to catch. A claim that names no
//   metric and carries no unit is the one case the guard cannot attribute; it
//   falls back to the old flat check, because refusing every un-attributed
//   figure would reject honest prose the model was never told to label. A figure
//   the guard cannot attribute is therefore accepted, not published as
//   attributed — the risk this leaves is stated in the report.

import { DURATION_RE, derivationsOf, extractNumericTokens, numberIsTraceableTo } from '../analyst/validate';
import { getMetric } from '../metrics/registry';
import type { BriefingContext, BriefingMetricFact, BriefingSleepFact, BriefingWorkoutFact } from './context';
import type { BriefingTraceability } from './types';

export interface BriefingNumberAudit {
  /** The payload-shaped audit, unchanged: how many tokens, which were flagged. */
  traceability: BriefingTraceability;
  /**
   * Human notes about numbers that WERE in the context but under another
   * metric. Deliberately carry no raw figure — a flagged number is not echoed.
   */
  attributionViolations: string[];
}

/** One metric the briefing context describes, with everything needed to audit it. */
export interface GuardGroup {
  id: string;
  /** Display label, used only in the violation notes. */
  label: string;
  /** Matches the names/aliases the model may use for this metric, or null. */
  names: RegExp | null;
  /** Canonical unit tokens this metric is measured in (bpm, ms, kg, h, min…). */
  units: Set<string>;
  /** Every value the context supplies for this metric (raw + display-stated). */
  values: number[];
}

// ── Units ───────────────────────────────────────────────

/**
 * Text forms that name a metric's unit, mapped to a canonical token.
 *
 * `%` is deliberately absent: a percentage can be a change on any metric, so a
 * `%` next to a number does not identify which metric the number belongs to.
 * `%`-suffixed figures are still checked — they fall to the claim's own target
 * metrics, which each carry their change percentage.
 */
export const UNIT_SYNONYMS: Record<string, string[]> = {
  bpm: ['bpm', 'beats per minute', 'beats/min', 'beats/minute'],
  ms: ['ms', 'millisecond', 'milliseconds'],
  kg: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  km: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'],
  mi: ['mi', 'mile', 'miles'],
  steps: ['step', 'steps'],
  kcal: ['kcal', 'cal', 'calorie', 'calories'],
  min: ['min', 'mins', 'minute', 'minutes'],
  h: ['h', 'hr', 'hrs', 'hour', 'hours'],
  mmhg: ['mmhg'],
  cm: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  in: ['in', 'inch', 'inches'],
  mg: ['mg'],
  g: ['g', 'gram', 'grams', 'gramme', 'grammes'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  ml: ['ml'],
  '°c': ['°c', 'degc', 'degrees celsius', 'celsius'],
  'breaths/min': ['breaths/min', 'breaths per minute', 'br/min', 'b/min'],
  'ml/kg/min': ['ml/kg/min'],
};

/** Canonical unit token for each registry metric, so a unit can name a metric. */
const METRIC_UNIT_WORDS: Record<string, string[]> = {
  resting_heart_rate: ['bpm'],
  heart_rate: ['bpm'],
  walking_heart_rate: ['bpm'],
  cardio_recovery: ['bpm'],
  heart_rate_variability: ['ms'],
  step_count: ['steps'],
  flights_climbed: [],
  apple_exercise_time: ['min'],
  time_in_daylight: ['min'],
  active_energy: ['kcal'],
  basal_energy_burned: ['kcal'],
  dietary_energy: ['kcal'],
  distance_walking_running: ['km'],
  apple_stand_hours: ['h'],
  sleep_analysis: ['h', 'min'],
  sleep_in_bed: ['h', 'min'],
  weight_body_mass: ['kg', 'lb'],
  lean_body_mass: ['kg', 'lb'],
  dietary_protein: ['g'],
  dietary_carbs: ['g'],
  dietary_fat_total: ['g'],
  dietary_sugar: ['g'],
  dietary_caffeine: ['mg'],
  dietary_water: ['l', 'ml'],
  respiratory_rate: ['breaths/min'],
  vo2max: ['ml/kg/min'],
  blood_pressure: ['mmhg'],
  waist_circumference: ['cm', 'in'],
  apple_sleeping_wrist_temperature: ['°c'],
  body_mass_index: [],
  blood_oxygen_saturation: [],
  body_fat_percentage: [],
  breathing_disturbances: [],
};

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_TO_UNIT = new Map<string, string>();
for (const [unit, words] of Object.entries(UNIT_SYNONYMS)) {
  for (const word of words) WORD_TO_UNIT.set(word.toLowerCase(), unit);
}

// Longest synonym first so "minutes" is preferred over "min", "inches" over "in".
const ALL_UNIT_WORDS = [...WORD_TO_UNIT.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
/** The unit that immediately follows a number, if any ("55.7 bpm", "6.3K steps"). */
const UNIT_TAIL_RE = new RegExp(`^\\s*(?:[KkMm])?\\s*(${ALL_UNIT_WORDS.join('|')})(?![a-z])`, 'i');

/** A word-bounded test that a claim uses a given unit somewhere. */
function unitMentionRe(unit: string): RegExp {
  const words = (UNIT_SYNONYMS[unit] ?? []).map(escapeRe).sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![a-z0-9])(${words.join('|')})(?![a-z0-9])`, 'i');
}
const UNIT_MENTION_RE = new Map<string, RegExp>(
  Object.keys(UNIT_SYNONYMS).map(unit => [unit, unitMentionRe(unit)])
);

/** Canonical unit tokens for a metric row, from the registry where known. */
function unitsOf(metricId: string): string[] {
  const explicit = METRIC_UNIT_WORDS[metricId];
  if (explicit) return explicit;
  const meta = getMetric(metricId);
  if (!meta) return [];
  const candidates = [meta.shortUnit, meta.canonicalUnit].filter(Boolean);
  const out = new Set<string>();
  for (const candidate of candidates) {
    const unit = WORD_TO_UNIT.get(candidate.toLowerCase());
    if (unit) out.add(unit);
  }
  return [...out];
}

// ── Groups from the context ─────────────────────────────

function nameRegex(names: string[]): RegExp | null {
  const clean = names
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)
    .map(escapeRe)
    .sort((a, b) => b.length - a.length);
  if (clean.length === 0) return null;
  return new RegExp(`(?<![a-z0-9])(${clean.join('|')})(?![a-z0-9])`, 'i');
}

/** Numbers stated by a display string, durations included ("7h 5m" → 425). */
function numbersInDisplay(display: unknown): number[] {
  if (typeof display !== 'string') return [];
  return extractNumericTokens(display).map(token => token.value);
}

function pushNumeric(out: number[], value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
}

function metricValues(fact: BriefingMetricFact): number[] {
  const out: number[] = [];
  for (const stat of [fact.latest, fact.mean7, fact.mean7Prior, fact.baseline30, fact.change7Percent]) {
    if (!stat) continue;
    pushNumeric(out, stat.value);
    pushNumeric(out, (stat as { observations?: number }).observations);
    out.push(...numbersInDisplay(stat.display));
  }
  pushNumeric(out, fact.coverage.observedDays);
  pushNumeric(out, fact.coverage.expectedDays);
  return out;
}

function sleepValues(sleep: BriefingSleepFact): number[] {
  const out: number[] = [];
  const night = sleep.latestNight;
  if (night) {
    out.push(...numbersInDisplay(night.asleep));
    out.push(...numbersInDisplay(night.inBed));
    for (const stage of Object.values(night.stages)) out.push(...numbersInDisplay(stage));
  }
  for (const mean of [sleep.mean7Asleep, sleep.mean7InBed]) {
    if (!mean) continue;
    pushNumeric(out, mean.value);
    pushNumeric(out, mean.nights);
    out.push(...numbersInDisplay(mean.display));
  }
  pushNumeric(out, sleep.nights7);
  pushNumeric(out, sleep.nightsWithStages7);
  if (sleep.consistency) {
    pushNumeric(out, sleep.consistency.nights);
    pushNumeric(out, sleep.consistency.stddevMinutes);
    out.push(...numbersInDisplay(sleep.consistency.medianBedtime));
    out.push(...numbersInDisplay(sleep.consistency.earliestBedtime));
    out.push(...numbersInDisplay(sleep.consistency.latestBedtime));
  }
  pushNumeric(out, sleep.coverage.nights);
  pushNumeric(out, sleep.coverage.nightsWithStages);
  pushNumeric(out, sleep.coverage.inBedOnlyNights);
  out.push(...numbersInDisplay(sleep.coverage.range));
  return out;
}

function workoutValues(workouts: BriefingWorkoutFact): number[] {
  const out: number[] = [];
  pushNumeric(out, workouts.last7.sessions);
  pushNumeric(out, workouts.last7.minutes);
  pushNumeric(out, workouts.prior7.sessions);
  pushNumeric(out, workouts.prior7.minutes);
  out.push(...numbersInDisplay(workouts.range));
  out.push(...numbersInDisplay(workouts.priorRange));
  return out;
}

const SLEEP_NAMES = ['sleep', 'asleep', 'night', 'nights', 'bedtime', 'time in bed', 'in bed', 'sleep duration', 'time asleep'];
const WORKOUT_NAMES = ['workout', 'workouts', 'training', 'session', 'sessions'];

/** The metric groups the context actually describes. */
export function guardGroups(context: BriefingContext): GuardGroup[] {
  const groups: GuardGroup[] = [];
  for (const fact of context.metrics) {
    const aliases = getMetric(fact.metricId)?.aliases ?? [];
    groups.push({
      id: fact.metricId,
      label: fact.name,
      names: nameRegex([fact.name, fact.metricId.replace(/_/g, ' '), ...aliases]),
      units: new Set(unitsOf(fact.metricId)),
      values: metricValues(fact),
    });
  }
  if (context.sleep) {
    groups.push({
      id: 'sleep',
      label: 'sleep',
      names: nameRegex(SLEEP_NAMES),
      units: new Set(['h', 'min']),
      values: sleepValues(context.sleep),
    });
  }
  groups.push({
    id: 'workouts',
    label: 'workouts',
    names: nameRegex(WORKOUT_NAMES),
    units: new Set(['min']),
    values: workoutValues(context.workouts),
  });
  return groups.filter(group => group.values.length > 0);
}

/**
 * Figures that belong to no single metric: the window lengths, the calendar
 * dates of the windows, and the person's age. They are legitimate in any claim.
 */
function sharedValues(context: BriefingContext): number[] {
  const out: number[] = [];
  const w = context.windows;
  pushNumeric(out, w.evaluatedDays);
  pushNumeric(out, w.priorDays);
  pushNumeric(out, w.baselineDays);
  pushNumeric(out, w.datasetDays);
  out.push(...numbersInDisplay(w.evaluatedRange));
  out.push(...numbersInDisplay(w.priorRange));
  out.push(...numbersInDisplay(w.baselineRange));
  out.push(...numbersInDisplay(context.asOf));
  out.push(...numbersInDisplay(context.asOfLabel));
  pushNumeric(out, context.profile?.ageYears);
  return out;
}

// ── Tokens ──────────────────────────────────────────────

interface PositionedToken {
  raw: string;
  value: number;
  /** Index just past the token, for looking up a following unit. */
  end: number;
  /** Canonical unit that immediately follows the token, or null. */
  unit: string | null;
  /**
   * Fractional digits the token states, or null when its precision does not
   * apply (a duration, whose h/m form is not a decimal restatement).
   */
  decimals: number | null;
}

function unitAfter(text: string, end: number): string | null {
  const match = UNIT_TAIL_RE.exec(text.slice(end, end + 18));
  return match ? WORD_TO_UNIT.get(match[1].toLowerCase()) ?? null : null;
}

/** Fractional digits a written figure states ("6.3" → 1, "5,900" → 0). */
function decimalsWritten(raw: string): number {
  const dot = raw.replace(/,/g, '').indexOf('.');
  return dot === -1 ? 0 : raw.replace(/,/g, '').length - dot - 1;
}

/**
 * Tokenize a claim exactly as the analyst's audit does — durations first (one
 * token worth its minutes) then plain numbers — while keeping each token's end
 * index so a following unit word can be read.
 */
function tokensInClaim(claim: string): PositionedToken[] {
  const tokens: PositionedToken[] = [];
  const spans: Array<[number, number]> = [];

  const duration = new RegExp(DURATION_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = duration.exec(claim)) !== null) {
    if (match[0].length === 0) {
      duration.lastIndex += 1;
      continue;
    }
    const end = match.index + match[0].length;
    spans.push([match.index, end]);
    tokens.push({
      raw: match[0].trim(),
      value: Number(match[1]) * 60 + (match[2] ? Number(match[2]) : 0),
      end,
      unit: 'h',
      decimals: null,
    });
  }

  const inSpan = (index: number) => spans.some(([start, end]) => index >= start && index < end);
  let i = 0;
  while (i < claim.length) {
    if (inSpan(i)) {
      i += 1;
      continue;
    }
    if (claim[i] >= '0' && claim[i] <= '9') {
      const digits = /^\d+(?:[.,]\d+)?/.exec(claim.slice(i));
      if (digits) {
        const raw = digits[0];
        const end = i + raw.length;
        const value = Number(raw.replace(/,/g, ''));
        if (Number.isFinite(value)) {
          tokens.push({ raw, value, end, unit: unitAfter(claim, end), decimals: decimalsWritten(raw) });
        }
        i = end;
        continue;
      }
    }
    i += 1;
  }

  return tokens.sort((a, b) => a.end - b.end);
}

/** Split prose into claims at sentence boundaries, without breaking decimals. */
export function splitClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(claim => claim.trim())
    .filter(claim => claim.length > 0);
}

// ── The audit ───────────────────────────────────────────

function derived(values: readonly number[]): number[] {
  return [...new Set(values)].flatMap(derivationsOf);
}

function unionValues(groups: Iterable<GuardGroup>): number[] {
  return [...groups].flatMap(group => group.values);
}

/** The metric group a token's value actually belongs to, or null. */
function homeGroup(groups: GuardGroup[], token: PositionedToken): GuardGroup | null {
  // Prefer the metric that supplies the value exactly — the violation note
  // should name HRV, not whichever metric merely sits within rounding of it.
  return (
    groups.find(group => matchesExactly(token.value, group.values)) ??
    groups.find(group => numberIsTraceableTo(token.value, derived(group.values))) ??
    null
  );
}

/**
 * Audit every number in the text against the metric its claim is about.
 *
 * Returns the payload-shaped traceability (checked / unmatched) plus notes on
 * the numbers that were in the context under the wrong metric.
 */
export function auditBriefingNumbers(
  text: { headline: string; body: string; recommendations: string[] },
  context: BriefingContext
): BriefingNumberAudit {
  const groups = guardGroups(context);
  const unitFamilies = new Map<string, GuardGroup[]>();
  for (const group of groups) {
    for (const unit of group.units) {
      const family = unitFamilies.get(unit) ?? [];
      family.push(group);
      unitFamilies.set(unit, family);
    }
  }

  const shared = derived(sharedValues(context));
  // The fallback for a claim that names no metric: every number anywhere in the
  // context, display-stated numbers included, so an un-attributed restatement
  // keeps the benefit of the doubt the old flat guard gave it.
  const global = derived([...collectAllContextNumbers(context), ...unionValues(groups)]);

  const claims = [
    ...splitClaims(text.headline),
    ...splitClaims(text.body),
    ...text.recommendations.flatMap(splitClaims),
  ];

  const unmatched: string[] = [];
  const seen = new Set<string>();
  const violations = new Set<string>();
  let checked = 0;

  for (const claim of claims) {
    const named = groups.filter(group => group.names?.test(claim));
    const target = new Set<GuardGroup>(named);
    for (const [unit, family] of unitFamilies) {
      if (UNIT_MENTION_RE.get(unit)?.test(claim)) family.forEach(group => target.add(group));
    }
    const claimGroups = [...target];

    for (const token of tokensInClaim(claim)) {
      checked += 1;

      // The metrics this token is measured against: the unit's own family when
      // the token is labelled with one, otherwise the claim's metrics.
      let measuredBy = claimGroups;
      let unitFamily: GuardGroup[] | null = null;
      if (token.unit) {
        const family = unitFamilies.get(token.unit);
        if (family && family.length > 0) {
          unitFamily = family;
          measuredBy = family;
        }
      }

      const allowed =
        measuredBy.length > 0 ? [...derived(unionValues(measuredBy)), ...shared] : global;
      const measuredIds = new Set(measuredBy.map(group => group.id));

      const label = (): string =>
        unitFamily ? unitFamily.map(group => group.label).join('/') : 'this sentence';

      if (matchesExactly(token.value, allowed) || matchesRounded(token.value, token.decimals, allowed)) {
        // A figure that is only *loosely* a value of the metric it is measured
        // against, but is EXACTLY a value some other metric supplies, is that
        // other metric's figure. This is the line that keeps a rounded match
        // from laundering the defect: 55.7 is exactly an HRV value, and merely
        // within 2% of resting heart rate's 56-day coverage count.
        const outsider = groups.find(
          group => !measuredIds.has(group.id) && matchesExactly(token.value, group.values)
        );
        if (outsider && !matchesExactly(token.value, allowed)) {
          if (seen.has(token.raw)) continue;
          seen.add(token.raw);
          unmatched.push(token.raw);
          violations.add(`a value stated for ${label()} is what the context records for ${outsider.label}`);
        }
        continue;
      }

      if (seen.has(token.raw)) continue;
      seen.add(token.raw);
      unmatched.push(token.raw);

      // Name the metric that actually supplies the value — but only when it is
      // not the metric the claim is already about. A figure refused for stating
      // more precision than the metric supplies is a precision refusal, not a
      // wrong-metric one, and must not be described as the latter.
      const home = homeGroup(groups, token);
      if (home && !measuredIds.has(home.id)) {
        violations.add(`a value stated for ${label()} is what the context records for ${home.label}`);
      }
    }
  }

  return { traceability: { checked, unmatched }, attributionViolations: [...violations] };
}

/** True when a token is a supplied value, not merely within rounding of one. */
function matchesExactly(value: number, values: readonly number[]): boolean {
  return values.some(candidate => Math.abs(value - candidate) <= 0.005);
}

/** Fractional digits a supplied value carries (used to bound restatements). */
function decimalsOf(candidate: number): number {
  if (Number.isInteger(candidate)) return 0;
  const text = String(candidate);
  if (text.includes('e')) return 6;
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * True when a token may be read as a *rounding* of a supplied value: within the
 * usual tolerance, and no more precise than the value it matches.
 *
 * Rounding loses precision; it never invents it. "56" may restate a 56-day
 * coverage count from either direction, but "55.7" may not be read as that 56 —
 * a decimal restatement of an integer is a different number, and accepting it is
 * exactly how an HRV figure (55.7) rode in on resting heart rate's integer
 * coverage count. A duration token (its h/m form) is exempt: it is not a decimal
 * restatement of anything.
 */
function matchesRounded(value: number, decimals: number | null, values: readonly number[]): boolean {
  return values.some(candidate => {
    const tolerance = Math.max(0.5, Math.abs(candidate) * 0.02);
    if (Math.abs(value - candidate) > tolerance) return false;
    if (decimals !== null && decimals > decimalsOf(candidate)) return false;
    return true;
  });
}

/** Every number anywhere in the context — the fallback for an un-targeted claim. */
function collectAllContextNumbers(context: BriefingContext): number[] {
  const matches = JSON.stringify(context).match(/\d+(?:\.\d+)?/g) ?? [];
  const out: number[] = [];
  for (const match of matches) {
    const value = Number(match);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

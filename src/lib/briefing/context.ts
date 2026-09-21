// ── Today's briefing: bounded context (SPEC §5B, §8) ─────
//
// The model is given *computed summaries*, never records. This module is the
// only thing that decides what the briefing may see, and it is deliberately
// small:
//
//   * one row per available core metric — latest reading, the last 7 days
//     against the 7 before them, the previous 30-day baseline, and how many
//     days of coverage those figures rest on;
//   * one sleep block computed from the corrected, de-duplicated night series
//     (`sleepSeries`), so an in-bed-only record is never averaged in as a night
//     of zero sleep and a repeated export is never two nights;
//   * one workout block: sessions and minutes in the last 7 days against the 7
//     before;
//   * explicit missing-data notes. A metric with no reading in the window is
//     stated as such and never imputed, and no zero stands in for an absent
//     reading.
//
// Everything is derived from the same canonical dataset every page renders, so
// the briefing cannot describe a number the rest of the app does not show.
//
// Bounds: CORE_BRIEFING_METRICS is a fixed, ordered list and at most
// MAX_BRIEFING_METRICS of them are emitted, with the rest summarised by count.
// No series is included — only aggregates — which keeps the payload well inside
// BRIEFING_CONTEXT_MAX_TOKENS for the live history.

import {
  REFERENCE_KEY,
  REFERENCE_TZ,
  coverageFor,
  datasetMeta,
  hasSleepStages,
  seriesFor,
  sleepSeries,
  workoutList,
} from '../adapters/dataset';
import { getMetric } from '../metrics/registry';
import { compareWindows } from '../analytics/comparisons';
import { mean, stddev } from '../analytics/stats';
import {
  formatDayKeyLong,
  makeWindow,
  previousWindow,
  trailingWindow,
  windowRangeLabel,
  type DayWindow,
} from '../analytics/windows';
import { formatMetricWithUnit, formatPercent } from '../metrics/format';
import type { UnitSystem } from '../prefs';
import { ageInYears, type VitalProfile } from '../profile/types';

/** Bumped when the context shape changes, so a cached briefing is not reused. */
export const BRIEFING_CONTEXT_VERSION = 2;

export const BRIEFING_EVALUATED_DAYS = 7;
export const BRIEFING_PRIOR_DAYS = 7;
export const BRIEFING_BASELINE_DAYS = 30;
export const BRIEFING_SLEEP_CONSISTENCY_DAYS = 30;

/** Hard cap on metric rows before the token bound is applied. */
export const MAX_BRIEFING_METRICS = 12;
/**
 * Rows the builder will never drop, however tight the token bound: the four
 * signals the Overview leads with.
 */
export const MIN_BRIEFING_METRICS = 4;
/** Target ceiling for the serialized context, at ~4 characters per token. */
export const BRIEFING_CONTEXT_MAX_TOKENS = 1500;

/**
 * The metrics the briefing describes, in the order they matter to a morning
 * read. `sleep_analysis` is absent on purpose: sleep has its own block built
 * from the corrected night series.
 */
export const CORE_BRIEFING_METRICS: string[] = [
  'resting_heart_rate',
  'heart_rate_variability',
  'step_count',
  'apple_exercise_time',
  'active_energy',
  'distance_walking_running',
  'apple_stand_hours',
  'respiratory_rate',
  'blood_oxygen_saturation',
  'weight_body_mass',
  'body_mass_index',
  'dietary_energy',
  'vo2max',
  'blood_pressure',
];

/** Metrics that are expected to be sparse; their coverage is stated, not hidden. */
const SPARSE_METRICS = ['weight_body_mass', 'body_mass_index', 'dietary_energy', 'blood_pressure'];

export interface BriefingStat {
  value: number;
  /** Formatted by the metric's own registry formatter — the string to quote. */
  display: string;
}

export interface BriefingMetricFact {
  metricId: string;
  name: string;
  unit: string;
  latest: (BriefingStat & { date: string }) | null;
  /** Mean over the last 7 days (complete days only for accumulating metrics). */
  mean7: (BriefingStat & { observations: number }) | null;
  /** Mean over the 7 days before that. */
  mean7Prior: (BriefingStat & { observations: number }) | null;
  /** The app's "previous 30-day baseline": the 30 days before the trailing 30. */
  baseline30: (BriefingStat & { observations: number }) | null;
  /** Change between the two 7-day means, as the app computes it. */
  change7Percent: (BriefingStat & { direction: 'above' | 'below' }) | null;
  coverage: { observedDays: number; expectedDays: number };
}

export interface BriefingSleepFact {
  /** Last recorded night, from the corrected series. */
  latestNight: {
    date: string;
    dateLabel: string;
    asleep: string;
    inBed: string;
    hasStageSplit: boolean;
    stages: { deep: string; rem: string; core: string; awake: string };
  } | null;
  mean7Asleep: (BriefingStat & { nights: number }) | null;
  mean7InBed: (BriefingStat & { nights: number }) | null;
  nights7: number;
  nightsWithStages7: number;
  consistency: {
    nights: number;
    medianBedtime: string;
    /** Standard deviation of bedtime, in minutes, on a clock that starts at noon. */
    stddevMinutes: number;
    earliestBedtime: string;
    latestBedtime: string;
  } | null;
  coverage: {
    /** Nights in the whole series, after exact repeats collapsed to one. */
    nights: number;
    nightsWithStages: number;
    inBedOnlyNights: number;
    range: string;
  };
}

export interface BriefingWorkoutFact {
  last7: { sessions: number; minutes: number };
  prior7: { sessions: number; minutes: number };
  range: string;
  priorRange: string;
}

export interface BriefingContext {
  contextVersion: number;
  asOf: string;
  asOfLabel: string;
  timezone: string;
  unitSystem: UnitSystem;
  /**
   * What the person told us about themselves, and nothing else: a name, an age
   * derived from the date of birth, and their own note. `null` when the profile
   * carries none of them. The note is UNTRUSTED DATA — the prompt is told, in
   * the same place as every other rule, never to follow an instruction inside
   * it.
   */
  profile: {
    name: string | null;
    ageYears: number | null;
    notes: string | null;
  } | null;
  windows: {
    evaluatedDays: number;
    priorDays: number;
    baselineDays: number;
    datasetDays: number;
    evaluatedRange: string;
    priorRange: string;
    /** The "previous 30-day baseline" window each metric row is compared with. */
    baselineRange: string;
  };
  metrics: BriefingMetricFact[];
  /** Metrics with data that did not fit the cap. */
  metricsOmitted: number;
  sleep: BriefingSleepFact | null;
  workouts: BriefingWorkoutFact;
  /** Plain statements of what is not in the data. Never an imputed value. */
  missing: string[];
}

// ── Helpers ─────────────────────────────────────────────

function pointsIn(metricId: string, win: DayWindow): number[] {
  if (!win.startKey || !win.endKey) return [];
  return seriesFor(metricId)
    .filter(p => p.key >= win.startKey && p.key <= win.endKey)
    .map(p => p.value);
}

function stat(metricId: string, value: number, system: UnitSystem): BriefingStat {
  return { value: Math.round(value * 100) / 100, display: formatMetricWithUnit(metricId, value, system) };
}

function finite(values: number[]): number[] {
  return values.filter(v => Number.isFinite(v));
}

function meanOrNull(values: number[]): number | null {
  const usable = finite(values);
  return usable.length > 0 ? mean(usable) : null;
}

/** Metrics whose records are sparse: their coverage is stated rather than implied. */
function coverageSentence(metricId: string): string | null {
  if (!SPARSE_METRICS.includes(metricId)) return null;
  const cov = coverageFor(metricId);
  if (!cov || cov.observedDays === 0) return null;
  const name = getMetric(metricId)?.displayName ?? metricId;
  return `${name}: recorded on ${cov.observedDays} of ${cov.expectedDays} days.`;
}

function metricFact(metricId: string, system: UnitSystem): BriefingMetricFact | null {
  const meta = getMetric(metricId);
  if (!meta) return null;
  const points = seriesFor(metricId);
  const cov = coverageFor(metricId);
  if (points.length === 0) return null;

  const evaluated = trailingWindow(REFERENCE_KEY, BRIEFING_EVALUATED_DAYS, `Last ${BRIEFING_EVALUATED_DAYS} days`);
  const prior = previousWindow(evaluated, BRIEFING_PRIOR_DAYS, `Prior ${BRIEFING_PRIOR_DAYS} days`);
  const baseline = previousWindow(
    trailingWindow(REFERENCE_KEY, BRIEFING_BASELINE_DAYS, `Last ${BRIEFING_BASELINE_DAYS} days`),
    BRIEFING_BASELINE_DAYS,
    `Prior ${BRIEFING_BASELINE_DAYS} days`
  );

  // Complete-day comparison for accumulating metrics: the in-progress day is
  // excluded from BOTH sides rather than compared with a complete day.
  const cmp = compareWindows(metricId, REFERENCE_KEY, BRIEFING_EVALUATED_DAYS, { meta });

  const latestPoint = points[points.length - 1];
  const evaluatedValues = pointsIn(metricId, cmp.evaluatedWindow);
  const priorValues = pointsIn(metricId, cmp.baselineWindow);
  const baselineValues = pointsIn(metricId, baseline);
  const evaluatedMean = meanOrNull(evaluatedValues);
  const priorMean = meanOrNull(priorValues);
  const baselineMean = meanOrNull(baselineValues);

  const change =
    evaluatedMean != null && priorMean != null && priorMean !== 0 && finite([evaluatedMean, priorMean]).length === 2
      ? {
          value: Math.round(((evaluatedMean - priorMean) / priorMean) * 1000) / 10,
          display: formatPercent(((evaluatedMean - priorMean) / priorMean) * 100),
          direction: (evaluatedMean > priorMean ? 'above' : 'below') as 'above' | 'below',
        }
      : null;

  // The comparison's own valid flag is what the rest of the app shows; a row
  // that cannot be compared says so through nulls, never through a zero.
  const comparable = cmp.comparison.valid && cmp.comparison.currentCount > 0;

  return {
    metricId,
    name: meta.displayName,
    unit: meta.canonicalUnit || 'count (no unit)',
    latest: latestPoint
      ? {
          value: Math.round(latestPoint.value * 100) / 100,
          display: formatMetricWithUnit(metricId, latestPoint.value, system),
          date: latestPoint.key,
        }
      : null,
    mean7: comparable && evaluatedMean != null
      ? { ...stat(metricId, evaluatedMean, system), observations: evaluatedValues.length }
      : null,
    mean7Prior: comparable && priorMean != null
      ? { ...stat(metricId, priorMean, system), observations: priorValues.length }
      : null,
    baseline30: baselineMean != null
      ? {
          ...stat(metricId, baselineMean, system),
          observations: baselineValues.length,
        }
      : null,
    change7Percent: comparable ? change : null,
    coverage: {
      observedDays: cov?.observedDays ?? points.length,
      expectedDays: cov?.expectedDays ?? points.length,
    },
  };
}

// ── Sleep ───────────────────────────────────────────────

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: REFERENCE_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * Minutes since noon, so 11:30pm and 12:15am stay close together on the clock
 * instead of reading as 23 hours apart. Same convention as the Sleep page.
 */
function minutesSinceNoon(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REFERENCE_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(t));
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return (hour < 12 ? hour + 24 : hour) * 60 + minute;
}

function labelFromMinutesSinceNoon(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function sleepFact(system: UnitSystem): BriefingSleepFact | null {
  const nights = sleepSeries();
  if (nights.length === 0) return null;

  const staged = nights.filter(hasSleepStages);
  const evaluated = trailingWindow(REFERENCE_KEY, BRIEFING_EVALUATED_DAYS, `Last ${BRIEFING_EVALUATED_DAYS} days`);
  const inWindow = (list: typeof nights) => list.filter(n => n.key >= evaluated.startKey && n.key <= evaluated.endKey);
  const stagedWindow = inWindow(staged);
  const allWindow = inWindow(nights);
  const consistencyWindow = nights.filter(
    n => n.key >= trailingWindow(REFERENCE_KEY, BRIEFING_SLEEP_CONSISTENCY_DAYS).startKey
  );

  const latest = nights[nights.length - 1];
  const asleepMean = meanOrNull(stagedWindow.map(n => n.asleepMinutes));
  const inBedMean = meanOrNull(allWindow.map(n => n.inBedMinutes));

  const bedtimes = consistencyWindow
    .map(n => minutesSinceNoon(n.bedtime))
    .filter((v): v is number => v != null);
  const spread = stddev(bedtimes);

  const sleepDisplay = (minutes: number) => formatMetricWithUnit('sleep_analysis', minutes, system);

  return {
    latestNight: latest
      ? {
          date: latest.key,
          dateLabel: formatDayKeyLong(latest.key),
          asleep: hasSleepStages(latest) ? sleepDisplay(latest.asleepMinutes) : 'no stage split recorded',
          inBed: sleepDisplay(latest.inBedMinutes),
          hasStageSplit: hasSleepStages(latest),
          stages: {
            deep: sleepDisplay(latest.stages.deep),
            rem: sleepDisplay(latest.stages.rem),
            core: sleepDisplay(latest.stages.core),
            awake: sleepDisplay(latest.stages.awake),
          },
        }
      : null,
    mean7Asleep:
      asleepMean != null
        ? { value: Math.round(asleepMean * 100) / 100, display: sleepDisplay(asleepMean), nights: stagedWindow.length }
        : null,
    mean7InBed:
      inBedMean != null
        ? { value: Math.round(inBedMean * 100) / 100, display: sleepDisplay(inBedMean), nights: allWindow.length }
        : null,
    nights7: allWindow.length,
    nightsWithStages7: stagedWindow.length,
    consistency:
      bedtimes.length > 0
        ? {
            nights: bedtimes.length,
            medianBedtime: labelFromMinutesSinceNoon(medianOf(bedtimes)),
            stddevMinutes: Number.isFinite(spread) ? Math.round(spread) : 0,
            earliestBedtime: labelFromMinutesSinceNoon(Math.min(...bedtimes)),
            latestBedtime: labelFromMinutesSinceNoon(Math.max(...bedtimes)),
          }
        : null,
    coverage: {
      nights: nights.length,
      nightsWithStages: staged.length,
      inBedOnlyNights: nights.length - staged.length,
      range: windowRangeLabel(
        makeWindow(nights[0].key, nights[nights.length - 1].key, 'All recorded nights')
      ),
    },
  };
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── Workouts ────────────────────────────────────────────

function workoutFact(): BriefingWorkoutFact {
  const evaluated = trailingWindow(REFERENCE_KEY, BRIEFING_EVALUATED_DAYS, `Last ${BRIEFING_EVALUATED_DAYS} days`);
  const prior = previousWindow(evaluated, BRIEFING_PRIOR_DAYS, `Prior ${BRIEFING_PRIOR_DAYS} days`);
  const sessions = workoutList();
  const inWindow = (win: DayWindow) =>
    sessions.filter(w => {
      const key = w.start_time.slice(0, 10);
      return key >= win.startKey && key <= win.endKey;
    });
  const summarise = (win: DayWindow) => {
    const list = inWindow(win);
    const minutes = list.reduce((a, w) => a + (Number.isFinite(w.duration_minutes) ? w.duration_minutes : 0), 0);
    return { sessions: list.length, minutes: Math.round(minutes) };
  };
  return {
    last7: summarise(evaluated),
    prior7: summarise(prior),
    range: windowRangeLabel(evaluated),
    priorRange: windowRangeLabel(prior),
  };
}

// ── Missing data ────────────────────────────────────────

const EXPECTED_BUT_OFTEN_ABSENT = ['vo2max', 'blood_pressure', 'respiratory_rate', 'blood_oxygen_saturation'];

/**
 * Statements about what is not recorded. Never an imputed or zero value.
 *
 * `withData` is every core metric that has records in this dataset, whether or
 * not it fitted the emitted rows: what did not fit is stated as a count, so the
 * model is never left believing it has the whole picture.
 */
function missingNotes(presentMetricIds: Set<string>, withData: BriefingMetricFact[]): string[] {
  const notes: string[] = [];
  const evaluated = trailingWindow(REFERENCE_KEY, BRIEFING_EVALUATED_DAYS);

  for (const metricId of EXPECTED_BUT_OFTEN_ABSENT) {
    const meta = getMetric(metricId);
    if (!meta) continue;
    const points = seriesFor(metricId);
    if (points.length === 0) {
      notes.push(`${meta.displayName} has no reading anywhere in this history.`);
      continue;
    }
    const inWeek = points.some(p => p.key >= evaluated.startKey && p.key <= evaluated.endKey);
    if (!inWeek) notes.push(`${meta.displayName} has no reading in the last ${BRIEFING_EVALUATED_DAYS} days.`);
  }

  const recorded = (metricId: string) => getMetric(metricId)?.displayName ?? metricId;
  for (const metricId of SPARSE_METRICS) {
    const sentence = coverageSentence(metricId);
    if (sentence) notes.push(sentence);
  }

  // A metric that has data but did not fit the emitted rows: say how many were
  // left out rather than silently describing a subset.
  const omitted = withData.filter(fact => !presentMetricIds.has(fact.metricId));
  if (omitted.length > 0) {
    notes.push(
      `${omitted.length} further metric${omitted.length === 1 ? '' : 's'} with recorded data ` +
        `(${omitted.map(fact => recorded(fact.metricId)).join(', ')}) ` +
        `${omitted.length === 1 ? 'is' : 'are'} not detailed here.`
    );
  }

  if (notes.length === 0) notes.push('No gaps are recorded for the metrics above.');
  return notes;
}

// ── Assembly ────────────────────────────────────────────

/** Estimate the serialized context's token count at ~4 characters per token. */
export function estimateContextTokens(context: BriefingContext): number {
  return Math.ceil(JSON.stringify(context).length / 4);
}

/**
 * The profile facts that reach the prompt. `null` when the profile carries none
 * of them — an empty block is not sent, so the model is never told about fields
 * that hold nothing.
 */
function profileBlock(profile: VitalProfile | null): BriefingContext['profile'] {
  if (!profile) return null;
  const name = profile.name?.trim() || null;
  const notes = profile.notes?.trim() || null;
  const ageYears = ageInYears(profile.dateOfBirth);
  if (!name && !notes && ageYears === null) return null;
  return { name, ageYears, notes };
}

/**
 * Build the bounded briefing context from the active dataset.
 *
 * Deterministic: the same dataset and unit system always produce the same
 * context, so a test can assert on it and the number-traceability guard
 * measures against exactly the payload the model was given.
 */
export function buildBriefingContext(
  system: UnitSystem = 'metric',
  /**
   * Token ceiling for the serialized context. Production always uses
   * BRIEFING_CONTEXT_MAX_TOKENS; the seam exists so the row-dropping bound can
   * be exercised against a deliberately tight ceiling.
   *
   * `profile` defaults to the stored one, so the greeting and the briefing agree
   * about the person's name without the caller having to thread it through.
   */
  options: { maxContextTokens?: number; profile?: VitalProfile | null } = {}
): BriefingContext {
  const maxContextTokens = options.maxContextTokens ?? BRIEFING_CONTEXT_MAX_TOKENS;
  // The stored profile is injected by the caller (it may live in Postgres and
  // this function is synchronous by design); with none, the context simply
  // carries no profile facts rather than reading a second source here.
  const profile = options.profile ?? null;
  const meta = datasetMeta();
  const evaluated = trailingWindow(REFERENCE_KEY, BRIEFING_EVALUATED_DAYS, `Last ${BRIEFING_EVALUATED_DAYS} days`);
  const prior = previousWindow(evaluated, BRIEFING_PRIOR_DAYS, `Prior ${BRIEFING_PRIOR_DAYS} days`);

  const withData: BriefingMetricFact[] = [];
  for (const metricId of CORE_BRIEFING_METRICS) {
    if (withData.length >= MAX_BRIEFING_METRICS) break;
    const fact = metricFact(metricId, system);
    if (fact) withData.push(fact);
  }

  const assemble = (facts: BriefingMetricFact[]): BriefingContext => ({
    contextVersion: BRIEFING_CONTEXT_VERSION,
    asOf: meta.dataAsOf,
    asOfLabel: formatDayKeyLong(dayKeyOf(meta.dataAsOf)),
    timezone: meta.timezone,
    unitSystem: system,
    profile: profileBlock(profile),
    windows: {
      evaluatedDays: BRIEFING_EVALUATED_DAYS,
      priorDays: BRIEFING_PRIOR_DAYS,
      baselineDays: BRIEFING_BASELINE_DAYS,
      datasetDays: pointSpanDays(),
      evaluatedRange: windowRangeLabel(evaluated),
      priorRange: windowRangeLabel(prior),
      baselineRange: windowRangeLabel(
        previousWindow(trailingWindow(REFERENCE_KEY, BRIEFING_BASELINE_DAYS), BRIEFING_BASELINE_DAYS)
      ),
    },
    metrics: facts,
    // A row that did not fit is reported as a count in `missing`, never dropped
    // in silence: the model is told what it is not being shown.
    metricsOmitted: withData.length - facts.length,
    sleep: sleepFact(system),
    workouts: workoutFact(),
    missing: missingNotes(new Set(facts.map(f => f.metricId)), withData),
  });

  // The bound is enforced, not hoped for: rows are dropped from the least
  // important end of the priority list until the payload fits, and never below
  // the four signals the Overview leads with.
  let facts = withData;
  let context = assemble(facts);
  while (estimateContextTokens(context) > maxContextTokens && facts.length > MIN_BRIEFING_METRICS) {
    facts = facts.slice(0, facts.length - 1);
    context = assemble(facts);
  }
  return context;
}

/** Day key of an instant, falling back to the reference day. */
function dayKeyOf(instant: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(instant) ? instant : instant.slice(0, 10);
}

/** Calendar days the dataset spans, from the metadata the pages show. */
function pointSpanDays(): number {
  const meta = datasetMeta();
  const cov = coverageFor('resting_heart_rate') ?? coverageFor('sleep_analysis');
  if (cov) return cov.expectedDays;
  return Math.max(1, Math.round((Date.parse(meta.dataAsOf) - Date.parse(meta.referenceDate)) / 86400000) || 1);
}
// ── Demo analyst handlers (SPEC §8) ─────────────────────
//
// Deterministic handlers over the shared dataset. Each one composes its answer
// from the retrieval bundle only, separates observed measurements from possible
// interpretation and from missing context, and cites metric, window,
// aggregation and sample count for every figure.
//
// No handler diagnoses, prescribes, implies causation, or presents a personal
// baseline as a medical range.

import { getMetric } from '../metrics/registry';
import { formatMetricWithUnit, formatPercent } from '../metrics/format';
import { proseName } from '../metrics/prose';
import { describeCoefficient, MIN_PAIRED_OBSERVATIONS, ASSOCIATION_NOTE } from '../analytics/relationships';
import { windowRangeLabel } from '../analytics/windows';
import type { AnalystAnswer, AnalystEvidence, AnalystChart, RetrievedSummary, RetrievalBundle } from './types';
import { everySummary, pairOf, summaryOf, MAX_POINTS_PER_SERIES } from './retrieval';
import { LAB_TOPIC_RE, looksLikeLabQuestion, readingText } from './labSnapshot';
import { SUPPORTED_PROMPTS, SUPPORTED_QUESTIONS } from './prompts';

export const BOUNDARY_NOTE =
  'This is educational information about your own recorded data, not medical advice: it does not diagnose, treat or rule anything out, and a single reading or a single week does not establish a trend.';

export interface HandlerContext {
  bundle: RetrievalBundle;
  system: 'metric' | 'imperial';
  refKey: string;
}

export interface AnalystHandler {
  id: string;
  /** The question shown to the user that this handler answers. */
  prompt: string;
  /** Cheap keyword routing — this is pattern matching, not language understanding. */
  matches: (q: string) => boolean;
  run: (ctx: HandlerContext) => AnalystAnswer;
}

// ── Formatting helpers ──────────────────────────────────

function fmt(metricId: string, value: number, system: 'metric' | 'imperial'): string {
  return formatMetricWithUnit(metricId, value, system);
}

function direction(deltaPercent: number): 'higher' | 'lower' {
  return deltaPercent > 0 ? 'higher' : 'lower';
}

function rangeToken(days: number): string {
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  if (days <= 90) return '90d';
  return 'all';
}

function daysOf(summary: RetrievedSummary): number {
  // Inclusive calendar length of the evaluated window.
  const start = Date.parse(`${summary.window.startKey}T00:00:00Z`);
  const end = Date.parse(`${summary.window.endKey}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

function evidenceFor(summary: RetrievedSummary): AnalystEvidence {
  const days = daysOf(summary);
  return {
    metricId: summary.metricId,
    metricName: summary.metricName,
    windowLabel: `${windowRangeLabel(summary.window)} (${summary.lengthLabel}) vs ${windowRangeLabel(summary.baselineWindow)}`,
    aggregation: summary.aggregation,
    sampleCount: `${summary.counts.evaluated} observations evaluated, ${summary.counts.baseline} in the baseline · ${summary.coverage}`,
    href: `/metric/${summary.metricId}?range=${rangeToken(days)}`,
  };
}

function chartFor(summary: RetrievedSummary): AnalystChart {
  return {
    metricId: summary.metricId,
    caption: `${summary.metricName} · ${windowRangeLabel(summary.window)} · ${summary.points.length} observations`,
    points: summary.points,
  };
}

function comparisonSentence(summary: RetrievedSummary, system: 'metric' | 'imperial'): string {
  const { comparison } = summary;
  if (!comparison.valid) {
    return `No comparison is available: ${summary.counts.evaluated} observations were recorded in the recent window and ${summary.counts.baseline} in the one before it.`;
  }
  return `That is ${fmt(summary.metricId, comparison.delta, system)}${
    comparison.deltaPercent == null ? ' (the earlier window averaged zero, so no percentage is shown)' : ` (${formatPercent(comparison.deltaPercent)})`
  }.`;
}

/** One sentence stating the coverage of a comparison, always with both counts. */
function coverageSentence(summary: RetrievedSummary): string {
  return `${summary.counts.evaluated} observations in ${windowRangeLabel(summary.window)} and ${summary.counts.baseline} in ${windowRangeLabel(summary.baselineWindow)} (${summary.coverage}).`;
}

// ── 1. Resting heart rate, week over week ───────────────

const rhrWeekOverWeek: AnalystHandler = {
  id: 'rhr-week-over-week',
  prompt: 'Why was my resting heart rate higher this week?',
  matches: q => /(resting heart rate|resting hr|rhr)/.test(q),
  run: ({ bundle, system }) => {
    const rhr = summaryOf(bundle, 'resting_heart_rate');
    const hrv = summaryOf(bundle, 'heart_rate_variability');
    if (!rhr) {
      return {
        id: 'rhr-week-over-week',
        title: 'Resting heart rate this week',
        observed: ['No resting heart rate summary could be selected for this question.'],
        interpretation: [],
        uncertainty: ['The metric was not part of the selected context, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }
    const observed = [
      `Resting heart rate averaged ${fmt('resting_heart_rate', rhr.comparison.current, system)} across ${rhr.lengthLabel} (${windowRangeLabel(rhr.window)}), from ${rhr.counts.evaluated} readings.`,
      `The comparison window (${windowRangeLabel(rhr.baselineWindow)}) averaged ${fmt('resting_heart_rate', rhr.comparison.baseline, system)} across ${rhr.counts.baseline} readings.`,
      comparisonSentence(rhr, system),
    ];
    if (hrv && hrv.comparison.valid) {
      observed.push(
        `HRV over the same two windows averaged ${fmt('heart_rate_variability', hrv.comparison.current, system)} against ${fmt('heart_rate_variability', hrv.comparison.baseline, system)} (${hrv.counts.evaluated} and ${hrv.counts.baseline} readings).`
      );
    }

    const interpretation = rhr.comparison.valid
      ? [
          `This week sits ${direction(rhr.comparison.deltaPercent ?? 0)} the preceding week in your own record.`,
          'Resting heart rate commonly moves by a few beats from one week to the next, so two seven-day windows are a short basis for describing a trend.',
        ]
      : ['There is not enough recorded data on both sides to describe a week-on-week difference.'];

    const uncertainty = [
      'Resting heart rate is compared as a daily average of the readings that were recorded; the readings are taken by the source device at rest, not under controlled conditions.',
      rhr.exclusionNote ??
        'Days with no reading are excluded from both windows, so the two windows are not necessarily made up of the same nights.',
      'The difference is measured against your own recent history. It is not a comparison with any medical reference range.',
    ];

    return {
      id: 'rhr-week-over-week',
      title: 'Resting heart rate this week against the week before',
      observed,
      interpretation,
      uncertainty,
      evidence: [evidenceFor(rhr), ...(hrv ? [evidenceFor(hrv)] : [])],
      charts: [chartFor(rhr)],
      followUps: ['How is my HRV trending?', 'What changed this week?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 2 & 3. Sleep over one month / three months ──────────

function sleepAnswer(id: string, days: number, title: string, ctx: HandlerContext): AnalystAnswer {
  const { bundle, system } = ctx;
  const sleep = summaryOf(bundle, 'sleep_analysis');
  if (!sleep) {
    return {
      id,
      title,
      observed: ['No sleep summary could be selected for this question.'],
      interpretation: [],
      uncertainty: ['Sleep was not part of the selected context, so nothing can be reported.'],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
  }
  const observed = [
    `Time asleep averaged ${fmt('sleep_analysis', sleep.aggregate.mean, system)} across ${rhrLabel(days)} (${windowRangeLabel(sleep.window)}), from ${sleep.counts.evaluated} recorded nights of ${days} possible nights.`,
    `The median night was ${fmt('sleep_analysis', sleep.aggregate.median, system)}; the shortest was ${fmt('sleep_analysis', sleep.aggregate.min, system)} and the longest ${fmt('sleep_analysis', sleep.aggregate.max, system)}.`,
    `Night-to-night spread in this window is about ${fmt('sleep_analysis', sleep.aggregate.stddev, system)} (standard deviation).`,
    `The preceding ${days} days averaged ${fmt('sleep_analysis', sleep.comparison.baseline, system)} from ${sleep.counts.baseline} nights.`,
    comparisonSentence(sleep, system),
  ];

  const interpretation =
    sleep.comparison.valid && sleep.comparison.deltaPercent != null
      ? [
          `Across this window your recorded time asleep is ${direction(sleep.comparison.deltaPercent)} than in the ${days} days before it.`,
          'The night-to-night spread above is larger than a small change in the average, so an individual night is a weak basis for describing how you slept overall.',
        ]
      : ['There are not enough recorded nights on both sides to describe a change across this window.'];

  const uncertainty = [
    'A night is counted on the date you woke, and only nights with a recorded episode are included; nights without a recording are left missing rather than counted as zero.',
    `Coverage of this metric is ${sleep.coverage}.`,
    'Time asleep describes the recorded episodes. It does not describe how rested you felt, and no value is inferred for nights without a recording.',
  ];

  return {
    id,
    title,
    observed,
    interpretation,
    uncertainty,
    evidence: [evidenceFor(sleep)],
    charts: [chartFor(sleep)],
    followUps: ['Are my workouts associated with better sleep?', 'How is my HRV trending?'],
    boundaryNote: BOUNDARY_NOTE,
  };
}

function rhrLabel(days: number): string {
  if (days === 30) return 'the last 30 days';
  if (days === 90) return 'the last 90 days';
  return `the last ${days} days`;
}

const sleepOneMonth: AnalystHandler = {
  id: 'sleep-1-month',
  prompt: 'How has my sleep changed over the last month?',
  matches: q => /sleep/.test(q) && /(month|30 day|30-day)/.test(q),
  run: ctx => sleepAnswer('sleep-1-month', 30, 'Time asleep across the last 30 days', ctx),
};

const sleepThreeMonths: AnalystHandler = {
  id: 'sleep-3-months',
  prompt: 'How has my sleep changed over the last 3 months?',
  matches: q => /sleep/.test(q) && /(3 month|three month|90 day|90-day|quarter)/.test(q),
  run: ctx => sleepAnswer('sleep-3-months', 90, 'Time asleep across the last 90 days', ctx),
};

// ── 4. HRV trend ────────────────────────────────────────

const hrvTrend: AnalystHandler = {
  id: 'hrv-trend',
  prompt: 'How is my HRV trending?',
  matches: q => /(hrv|heart rate variability|sdnn)/.test(q),
  run: ({ bundle, system }) => {
    const all = everySummary(bundle).filter(s => s.metricId === 'heart_rate_variability');
    const short = all.find(s => daysOf(s) === 30);
    const long = all.find(s => daysOf(s) === 90);
    if (!short || !long) {
      return {
        id: 'hrv-trend',
        title: 'HRV trend',
        observed: ['No HRV summary could be selected for this question.'],
        interpretation: [],
        uncertainty: ['HRV was not part of the selected context, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }
    const observed = [
      `HRV averaged ${fmt('heart_rate_variability', short.comparison.current, system)} across the last 30 days (${windowRangeLabel(short.window)}), from ${short.counts.evaluated} morning readings.`,
      `The preceding 30 days averaged ${fmt('heart_rate_variability', short.comparison.baseline, system)} from ${short.counts.baseline} readings. ${comparisonSentence(short, system)}`,
      `Across 90 days HRV averaged ${fmt('heart_rate_variability', long.comparison.current, system)} (${windowRangeLabel(long.window)}), against ${fmt('heart_rate_variability', long.comparison.baseline, system)} in the preceding 90 days. ${comparisonSentence(long, system)}`,
      `In the 90-day window the lowest reading was ${fmt('heart_rate_variability', long.aggregate.min, system)} and the highest ${fmt('heart_rate_variability', long.aggregate.max, system)}, from ${long.counts.evaluated} readings.`,
    ];

    const interpretation =
      short.comparison.valid || long.comparison.valid
        ? [
            'The 30-day and 90-day windows use different lengths of history, so they can point in different directions; the longer window is the steadier description of your record.',
            'HRV is recorded once a day by the source device, so a single reading and the daily average of a week are not the same quantity.',
          ]
        : ['There are not enough readings on both sides of either window to describe a trend.'];

    const uncertainty = [
      'Coverage differs between windows and HRV is sampled once daily, so both windows are built from mornings that happened to be recorded.',
      `Recorded coverage for HRV is ${long.coverage}.`,
      'HRV varies with sleep, training load, caffeine, illness and travel. None of those are measured here, and nothing in this answer attributes the change to any of them.',
    ];

    return {
      id: 'hrv-trend',
      title: 'HRV across 30 and 90 days',
      observed,
      interpretation,
      uncertainty,
      evidence: [evidenceFor(short), evidenceFor(long)],
      charts: [chartFor(short), chartFor(long)],
      followUps: ['Why was my resting heart rate higher this week?', 'Are my workouts associated with better sleep?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 5. Steps against the baseline ───────────────────────

const stepsVsBaseline: AnalystHandler = {
  id: 'steps-vs-baseline',
  prompt: 'How do my steps compare with my baseline?',
  matches: q => /(step|walk|activity)/.test(q),
  run: ({ bundle, system }) => {
    const steps = summaryOf(bundle, 'step_count');
    if (!steps) {
      return {
        id: 'steps-vs-baseline',
        title: 'Steps against your baseline',
        observed: ['No step summary could be selected for this question.'],
        interpretation: [],
        uncertainty: ['Steps were not part of the selected context, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }
    const days = daysOf(steps);
    const perDay = steps.comparison.current / days;
    const baselinePerDay = steps.counts.baseline ? steps.comparison.baseline / steps.counts.baseline : NaN;

    return {
      id: 'steps-vs-baseline',
      title: 'Steps against your baseline',
      observed: [
        `${formatMetricWithUnit('step_count', steps.comparison.current, system)} of steps were recorded across ${steps.lengthLabel} (${windowRangeLabel(steps.window)}), which is ${formatMetricWithUnit('step_count', perDay, system)} per complete day from ${steps.counts.evaluated} complete days.`,
        `The comparison window (${windowRangeLabel(steps.baselineWindow)}) recorded ${formatMetricWithUnit('step_count', steps.comparison.baseline, system)}, which is ${formatMetricWithUnit('step_count', baselinePerDay, system)} per day from ${steps.counts.baseline} days.`,
        comparisonSentence(steps, system),
      ],
      interpretation: [
        steps.comparison.valid
          ? `Recent steps are ${direction(steps.comparison.deltaPercent ?? 0)} than the days before that, counted over complete days on both sides.`
          : 'There are not enough complete days on both sides to compare.',
        'Step totals depend on how much the watch was worn as well as on how much you moved, and neither is measured here.',
      ],
      uncertainty: [
        steps.exclusionNote ??
          'Complete days only: a day that has not finished accumulating is excluded from both sides.',
        'Meeting a daily step figure is not a statement about health, and the baseline is your own recent history rather than a target.',
        `Coverage for steps is ${steps.coverage}.`,
      ],
      evidence: [evidenceFor(steps)],
      charts: [chartFor(steps)],
      followUps: ['How often am I working out?', 'What changed this week?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 6. Sleep and recovery association ───────────────────

const sleepVsRecovery: AnalystHandler = {
  id: 'sleep-vs-recovery',
  prompt: 'Are my workouts associated with better sleep?',
  matches: q => /(workout|exercise|training)/.test(q) && /(sleep|recover|hrv)/.test(q),
  run: ({ bundle, system }) => {
    const pair = pairOf(bundle, 'sleep_analysis', 'heart_rate_variability');
    const sleep = summaryOf(bundle, 'sleep_analysis');
    const hrv = summaryOf(bundle, 'heart_rate_variability');
    if (!pair || !sleep || !hrv) {
      return {
        id: 'sleep-vs-recovery',
        title: 'Sleep and next-morning recovery',
        observed: ['The paired comparison could not be selected for this question.'],
        interpretation: [],
        uncertainty: ['Sleep and HRV were not both part of the selected context, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }

    const observed: string[] = [
      `Time asleep and same-morning HRV were paired by calendar day across ${windowRangeLabel(pair.window)}: ${pair.pairedCount} days have a reading of both.`,
      `Time asleep averaged ${fmt('sleep_analysis', sleep.aggregate.mean, system)} (${sleep.counts.evaluated} nights) and HRV averaged ${fmt('heart_rate_variability', hrv.aggregate.mean, system)} (${hrv.counts.evaluated} readings) in that window.`,
    ];
    if (pair.valid && pair.coefficient != null) {
      observed.push(
        `The Pearson coefficient between the two is ${pair.coefficient.toFixed(2)}, which is a ${describeCoefficient(pair.coefficient).toLowerCase()}.`
      );
    }
    if (pair.split) {
      observed.push(
        `Nights at or below the median (${fmt('sleep_analysis', pair.split.medianX, system)}) numbered ${pair.split.low.days} and averaged ${fmt('sleep_analysis', pair.split.low.xMean, system)} of sleep with ${fmt('heart_rate_variability', pair.split.low.yMean, system)} of HRV.`
      );
      observed.push(
        `Nights above the median numbered ${pair.split.high.days} and averaged ${fmt('sleep_analysis', pair.split.high.xMean, system)} of sleep with ${fmt('heart_rate_variability', pair.split.high.yMean, system)} of HRV.`
      );
    }

    const interpretation = pair.valid
      ? [
          `In your own record, days with more time asleep and days with higher HRV ${pair.coefficient != null && pair.coefficient > 0 ? 'tended to occur together' : 'tended to occur on different days'}.`,
          'A coefficient describes how two recorded series moved relative to each other in this window. It is not a probability, and no significance test is performed.',
        ]
      : ['There are too few paired days to describe how the two series moved together.'];

    const uncertainty = [
      'Only days with a reading of both metrics are paired; days missing either one are excluded, and missing days are not evenly spread.',
      'Sleep, training, caffeine and illness can all influence both series. Nothing here isolates any one of them.',
      ASSOCIATION_NOTE,
    ];

    return {
      id: 'sleep-vs-recovery',
      title: 'Sleep and next-morning recovery',
      observed,
      interpretation,
      uncertainty,
      evidence: [
        {
          metricId: pair.yMetricId,
          metricName: getMetric(pair.yMetricId)?.displayName ?? pair.yMetricId,
          windowLabel: `${windowRangeLabel(pair.window)} · ${pair.alignment === 'lagged' ? `lagged ${pair.lagDays} day` : 'same day'}`,
          aggregation: 'daily value, paired by calendar day',
          sampleCount: `${pair.pairedCount} paired days (minimum ${MIN_PAIRED_OBSERVATIONS})`,
          href: '/trends',
        },
        evidenceFor(sleep),
        evidenceFor(hrv),
      ],
      charts: [chartFor(sleep), chartFor(hrv)],
      followUps: ['How has my sleep changed over the last 3 months?', 'How is my HRV trending?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 7. Workout frequency ────────────────────────────────

const workoutFrequency: AnalystHandler = {
  id: 'workout-frequency',
  prompt: 'How often am I working out?',
  matches: q => /(workout|work out|working out|exercise|training|gym)/.test(q),
  run: ({ bundle }) => {
    const w = bundle.workouts;
    if (!w) {
      return {
        id: 'workout-frequency',
        title: 'Workout frequency',
        observed: ['The workout log was not selected for this question.'],
        interpretation: [],
        uncertainty: ['No workout records were part of the selected context, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }
    const observed = [
      `${w.sessions} workouts were recorded across ${windowRangeLabel(w.window)}, totalling ${w.minutes} minutes and ${w.calories} kcal.`,
      `That is ${w.sessionsPerWeek.toFixed(1)} recorded workouts per 7-day block.`,
      `The most recent 30 days contain ${w.recent} recorded workouts and the 30 days before that contain ${w.prior}.`,
      `By activity type: ${w.byType.map(t => `${t.type} ${t.count} (${t.minutes} min)`).join(', ')}.`,
    ];

    return {
      id: 'workout-frequency',
      title: 'How often you are working out',
      observed,
      interpretation: [
        w.recent === w.prior
          ? 'The number of recorded workouts is the same in both 30-day windows.'
          : `The most recent 30 days hold ${Math.abs(w.recent - w.prior)} ${w.recent > w.prior ? 'more' : 'fewer'} recorded workouts than the 30 days before.`,
        'A gap in the record means nothing was logged for that day. It does not establish that nothing was done.',
      ],
      uncertainty: [
        'Workouts are counted only when a session was recorded by a device or logged by hand, so frequency here is recorded frequency.',
        'Duration and calorie figures come from the recording device and are not measured here.',
        'Volume (how hard each session was) is not summarised; only counts, duration and recorded calories are shown.',
      ],
      evidence: [
        {
          metricId: 'apple_exercise_time',
          metricName: 'Recorded workouts',
          windowLabel: windowRangeLabel(w.window),
          aggregation: 'count of recorded sessions',
          sampleCount: `${w.sessions} sessions in the window`,
          href: '/workouts',
        },
      ],
      charts: [],
      followUps: ['Are my workouts associated with better sleep?', 'How do my steps compare with my baseline?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 8. What changed this week ───────────────────────────

const whatChangedThisWeek: AnalystHandler = {
  id: 'what-changed-this-week',
  prompt: 'What changed this week?',
  matches: q => /(what changed|changed this week|weekly|this week|last 7 days)/.test(q),
  run: ({ bundle, system }) => {
    const summaries = everySummary(bundle);
    if (summaries.length === 0) {
      return {
        id: 'what-changed-this-week',
        title: 'What changed this week',
        observed: ['No summaries could be selected for this question.'],
        interpretation: [],
        uncertainty: ['Nothing was selected from the dataset, so nothing can be reported.'],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }

    const observed = summaries.map(s => {
      if (!s.comparison.valid) {
        return `${s.metricName}: ${s.counts.evaluated} observations this week and ${s.counts.baseline} in the preceding week, which is not enough to compare.`;
      }
      const pct = s.comparison.deltaPercent != null ? formatPercent(s.comparison.deltaPercent) : 'no percentage (the earlier window averaged zero)';
      return `${proseName(s.metricId)}: ${fmt(s.metricId, s.comparison.current, system)} across ${s.lengthLabel} (${windowRangeLabel(s.window)}), against ${fmt(s.metricId, s.comparison.baseline, system)} in ${windowRangeLabel(s.baselineWindow)} — ${pct}.`;
    });

    const moved = summaries.filter(
      s => s.comparison.valid && s.comparison.deltaPercent != null && Math.abs(s.comparison.deltaPercent) >= 5
    );
    const excluded = summaries.filter(s => s.exclusionNote);

    const interpretation = [
      moved.length === 0
        ? 'None of the tracked metrics moved by 5% or more against the preceding week.'
        : `${moved.map(s => proseName(s.metricId)).join(', ')} moved by 5% or more against the preceding week. The largest change is ${proseName(moved[0].metricId)}. 5% is a reporting threshold, not a clinical one.`,
      excluded.length > 0
        ? 'Totals that accumulate during the day exclude today, so the week is compared as complete days on both sides.'
        : 'Every metric here is complete for the final day of its window.',
    ];

    const uncertainty = [
      'A single week is a short window: the change you see now can reverse next week without anything having changed.',
      'Each metric is compared against your own preceding week, not against a reference range or a target.',
      'Metrics with fewer observations on either side are reported as not comparable rather than estimated.',
    ];

    return {
      id: 'what-changed-this-week',
      title: 'What changed this week',
      observed,
      interpretation,
      uncertainty,
      evidence: summaries.map(evidenceFor),
      charts: [chartFor(summaries[0])],
      followUps: ['Why was my resting heart rate higher this week?', 'How has my sleep changed over the last 3 months?'],
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── 9. Lab results ──────────────────────────────────────

/**
 * The lab block's answer, composed from `bundle.lab` only.
 *
 * It reports what the Lab page reports — the latest value with its unit and
 * observation date, the interval the document printed and its basis, the
 * previous observation and the change — and it never turns a qualitative result
 * (NEGATIVE, NONE SEEN, 1+) into a number. When the question names an analyte
 * the data does not hold, it says the data is absent rather than substituting
 * one. Every figure carries its unit and its own observation date.
 */
const labResults: AnalystHandler = {
  id: 'lab-results',
  prompt: 'What do my lab results show?',
  matches: q => LAB_TOPIC_RE.test(q) || looksLikeLabQuestion(q),
  run: ({ bundle }) => {
    const lab = bundle.lab ?? null;
    if (!lab || !lab.available) {
      return {
        id: 'lab-results',
        title: 'Lab results',
        observed: [
          'No lab results could be selected for this question, so no lab figure can be reported.',
        ],
        interpretation: [],
        uncertainty: [
          lab?.reason ??
            'The lab results were not part of the selected context, so nothing about them can be reported.',
        ],
        evidence: [],
        charts: [],
        followUps: [],
        boundaryNote: BOUNDARY_NOTE,
      };
    }

    if (lab.selection === 'analyte' && !lab.found) {
      return {
        id: 'lab-results',
        title: `Lab results for ${lab.requestedName ?? 'that analyte'}`,
        observed: [
          `No lab results for "${lab.requestedName}" were found among the ${lab.totalSeries} stored lab series (${lab.documents} document${lab.documents === 1 ? '' : 's'}, ${lab.totalObservations} observations).`,
        ],
        interpretation: [],
        uncertainty: [
          'The stored documents do not hold this analyte, so no figure is given for it. Nothing is substituted from another analyte.',
        ],
        evidence: [],
        charts: [],
        followUps: ['What lab results do I have?', 'What changed this week?'],
        boundaryNote: BOUNDARY_NOTE,
      };
    }

    const coverage = `The lab context holds ${lab.documents} document${lab.documents === 1 ? '' : 's'}, ${lab.totalObservations} observations across ${lab.totalSeries} series and ${lab.collisions} date${lab.collisions === 1 ? '' : 's'} carrying more than one observation; ${lab.note}.`;
    const observed: string[] = [coverage];
    for (const series of lab.series) {
      if (!series.latest) continue;
      observed.push(series.display.line ?? `${series.displayName}: latest ${readingText(series.latest)} on ${series.latest.on}.`);
    }

    const movingSeries = lab.series.filter(
      series => series.latest !== null && series.previous !== null && series.latest.value !== null && series.previous.value !== null
    );
    const interpretation = [
      lab.selection === 'analyte'
        ? `This answer describes the analyte the question named, from the observations the documents hold for it. A trend over a handful of results is a short basis for describing movement.`
        : 'These are the analytes most recently measured in the stored documents; a lab panel is a snapshot of the day it was taken, and the intervals it prints are the ones the laboratory used.',
      movingSeries.length > 0
        ? `${movingSeries.length} of the series shown compare the latest observation with the one before it; that comparison is stated line by line above, and where there is no earlier observation the line says so.`
        : 'No series shown has an earlier observation to compare the latest one with, so no movement is described.',
    ];
    if (lab.selection === 'analyte' && lab.series[0]?.truncated) {
      interpretation.push(
        `Only the most recent observations are carried here (${lab.series[0].display.historyTruncated ?? 'the series is bounded'}), so the whole history of this analyte is not shown.`
      );
    }

    const uncertainty = [
      'A reference interval is the range the laboratory printed on the report, or a general fallback interval where the report printed none. It is a screening range, not a diagnosis: a value outside it is not a diagnosis, and a value inside it does not rule anything out.',
      'Every result is paired with its unit and the date it was observed. A qualitative result (for example NEGATIVE or NONE SEEN) is quoted as the document printed it and is never turned into a number.',
      lab.selection === 'analyte'
        ? 'A urine result and a blood result of the same name are kept apart and are never compared with one another.'
        : 'A urine series is labelled (urine) where an analyte has both a urine and a blood series; the two are different measurements and are never combined.',
      'The results are what the uploaded documents printed. A result that was not in those documents cannot be reported, and nothing here is estimated to fill a gap.',
    ];

    const evidence: AnalystEvidence[] = lab.series
      .filter(series => series.latest !== null)
      .map(series => ({
        metricId: series.seriesKey,
        metricName: series.displayName,
        windowLabel: `latest observation ${series.latest!.on} (${series.observations} observation${series.observations === 1 ? '' : 's'})`,
        aggregation: lab.selection === 'analyte' ? `latest observation, with up to the last ${MAX_POINTS_PER_SERIES} observations shown` : 'latest and previous observation',
        sampleCount: `${series.observations} observation${series.observations === 1 ? '' : 's'}; ${series.shownPoints} in this context`,
        href: `/lab/${series.seriesKey}`,
      }));

    const followUps =
      lab.selection === 'analyte' && lab.requestedName
        ? [`How has my ${lab.requestedName.toLowerCase()} changed over time?`, 'What other lab results do I have?']
        : ['What is my latest cholesterol result?', 'What other lab results do I have?'];

    return {
      id: 'lab-results',
      title: lab.selection === 'analyte' && lab.requestedName ? `Latest lab results for ${lab.requestedName}` : 'Your most recent lab results',
      observed,
      interpretation,
      uncertainty,
      evidence,
      charts: [],
      followUps,
      boundaryNote: BOUNDARY_NOTE,
    };
  },
};

// ── Registry ────────────────────────────────────────────

export const HANDLERS: AnalystHandler[] = [
  sleepVsRecovery,
  sleepThreeMonths,
  hrvTrend,
  rhrWeekOverWeek,
  sleepOneMonth,
  stepsVsBaseline,
  workoutFrequency,
  whatChangedThisWeek,
  // Last, so a lab question can never shadow a metric handler.
  labResults,
];

/** Every supported question is backed by a registered handler. */
export function unsupportedHandlerIds(): string[] {
  return SUPPORTED_QUESTIONS.map(q => q.handlerId).filter(id => !HANDLERS.some(h => h.id === id));
}

export { SUPPORTED_PROMPTS };

/** Pattern routing, in priority order. Not language understanding. */
export function selectHandler(query: string): AnalystHandler | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  for (const handler of HANDLERS) {
    if (handler.matches(q)) return handler;
  }
  // A bare mention of sleep still routes to the shortest sleep window.
  if (/sleep/.test(q)) return sleepOneMonth;
  return null;
}

// ── Strict routing for a configured provider ────────────
//
// The loose matcher above is pattern matching: one topical word is enough, and
// a bare "sleep" falls through to the one-month sleep window. That is right for
// the demo path, where those patterns *are* the supported question list, but
// wrong for a configured provider answering free-form questions: a question
// that spans two topics ("…caffeine…, and how does it relate to my sleep?")
// would be answered from the sleep bundle alone and half of it could not be
// answered at all.
//
// The strict matcher therefore routes to a handler only when the question
// genuinely IS that handler's canonical question (optionally with words
// omitted), and never to the catch-all. Everything else gets the general
// bundle, which the model is free to use.

/** Normalised form of a question: lowercase, punctuation removed, single-spaced. */
function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `query` is `prompt` itself or a near-match of it.
 *
 * A near-match is either every word of the question appearing in the canonical
 * question (the same question with words left out), or an overlap of 85% or
 * more. Both directions are deliberately tight: adding a second topic to a
 * canonical question drops the overlap below the bar and the question goes to
 * the general bundle instead of being answered from one metric.
 */
function isNearMatch(query: string, prompt: string): boolean {
  if (query === prompt) return true;
  const q = query.split(' ').filter(Boolean);
  const p = prompt.split(' ').filter(Boolean);
  // Three words is the shortest question that can still be a near-match: a
  // two-word fragment ("the last month") is not a question about a metric.
  if (q.length < 3 || p.length === 0) return false;

  const qSet = new Set(q);
  const pSet = new Set(p);
  let shared = 0;
  for (const token of qSet) if (pSet.has(token)) shared++;
  const union = new Set([...qSet, ...pSet]).size;
  const everyWordPresent = shared === qSet.size;

  return everyWordPresent || (shared / union >= 0.85 && q.length <= p.length + 2);
}

/**
 * Strict selection, used only when a real provider is configured.
 *
 * Returns a handler only for a genuine match to its canonical question; null
 * means "use the general bundle".
 */
export function selectHandlerStrict(query: string): AnalystHandler | null {
  const q = normalizeQuestion(query);
  if (!q) return null;
  for (const handler of HANDLERS) {
    if (isNearMatch(q, normalizeQuestion(handler.prompt))) return handler;
  }
  return null;
}

/** Export for tests: the metric ids every handler may read. */
export function handlerIds(): string[] {
  return HANDLERS.map(h => h.id);
}

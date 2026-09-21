// ── The metric-aware number guard ───────────────────────
//
// The two generations the live model actually produced for the same day and the
// same context, reproduced against a hand-built context. Nothing here touches a
// provider or the network: the context is a plain object, so the audit is
// deterministic and the two cases differ only in what the model wrote.
//
// The premise of the whole defect: 55.7 and 56 are real HRV values, present in
// the context — so the OLD "does this number appear somewhere?" guard passed
// them. The new guard rejects them because the sentence labels them bpm.

import { describe, expect, it } from 'vitest';
import type { BriefingContext, BriefingMetricFact } from '@/lib/briefing/context';
import { auditBriefingNumbers, guardGroups, splitClaims } from '@/lib/briefing/attribution-guard';
import { checkBriefingTraceability, parseBriefingReply } from '@/lib/briefing/validate';

/** A metric row with just the fields the guard reads. */
function metric(
  metricId: string,
  name: string,
  unit: string,
  stats: Partial<Pick<BriefingMetricFact, 'latest' | 'mean7' | 'mean7Prior' | 'baseline30' | 'change7Percent'>>,
  coverage: { observedDays: number; expectedDays: number } = { observedDays: 7, expectedDays: 7 }
): BriefingMetricFact {
  return {
    metricId,
    name,
    unit,
    latest: null,
    mean7: null,
    mean7Prior: null,
    baseline30: null,
    change7Percent: null,
    coverage,
    ...stats,
  };
}

const stat = (value: number, display: string) => ({ value, display });

/**
 * The live context of Sep 11–17, reduced to the two metrics the defect is about.
 *
 * Resting heart rate carries the figures generation B quoted (65.4 / 66.9 /
 * 72.4). HRV carries 36/33 AND 55.7/56: the last two are what generation A
 * borrowed and mislabelled, and they are genuinely in the context.
 */
const CONTEXT: BriefingContext = {
  contextVersion: 2,
  asOf: '2026-09-17T23:00:00.000Z',
  asOfLabel: 'Thursday, September 17',
  timezone: 'America/Chicago',
  unitSystem: 'metric',
  profile: { name: 'Test Person', ageYears: 47, notes: null },
  windows: {
    evaluatedDays: 7,
    priorDays: 7,
    baselineDays: 30,
    datasetDays: 59,
    evaluatedRange: 'Sep 11 – Sep 17',
    priorRange: 'Sep 4 – Sep 10',
    baselineRange: 'Aug 5 – Sep 3',
  },
  metrics: [
    metric(
      'resting_heart_rate',
      'Resting Heart Rate',
      'bpm',
      {
        latest: { ...stat(63, '63.0 bpm'), date: '2026-09-17' },
        mean7: { ...stat(65.4, '65.4 bpm'), observations: 7 },
        mean7Prior: { ...stat(66.9, '66.9 bpm'), observations: 7 },
        baseline30: { ...stat(72.4, '72.4 bpm'), observations: 25 },
        change7Percent: { ...stat(-2.2, '-2.2%'), direction: 'below' },
      },
      // 56 observed days: a coverage count inside 2% of 55.7. This is the exact
      // value that let generation A's 55.7 "round onto" resting heart rate.
      { observedDays: 56, expectedDays: 59 }
    ),
    metric('heart_rate_variability', 'HRV', 'ms', {
      latest: { ...stat(56, '56 ms'), date: '2026-09-17' },
      mean7: { ...stat(36, '36 ms'), observations: 7 },
      mean7Prior: { ...stat(33, '33 ms'), observations: 7 },
      baseline30: { ...stat(55.7, '55.7 ms'), observations: 26 },
      change7Percent: { ...stat(9.1, '+9.1%'), direction: 'above' },
    }),
  ],
  metricsOmitted: 0,
  sleep: null,
  workouts: { last7: { sessions: 3, minutes: 90 }, prior7: { sessions: 2, minutes: 60 }, range: 'Sep 11 – Sep 17', priorRange: 'Sep 4 – Sep 10' },
  missing: [],
};

/** Generation A — wrong: HRV-range values under bpm labels. Passed the old guard. */
const GENERATION_A = {
  headline: 'Your resting heart rate and HRV both dipped this week.',
  body:
    'Resting heart rate (55.7 bpm) and HRV (56 ms) both sat a touch below your prior week.',
  recommendations: ['Keep your bedtime steady.', 'Keep recording as you do now.'],
};

/** Generation B — correct: every figure under its own metric. */
const GENERATION_B = {
  headline: 'Your resting heart rate has trended down while your HRV has trended up.',
  body:
    "resting heart rate averaged 65.4 bpm over the last seven days, below both the prior week's " +
    '66.9 bpm and your past-month figure of 72.4 bpm, while HRV rose to 36 ms from 33 ms ' +
    'the week before.',
  recommendations: ['Keep your bedtime steady.', 'Keep recording as you do now.'],
};

describe('the metric-aware number guard', () => {
  it('builds one group per context metric, with its own units and values', () => {
    const groups = guardGroups(CONTEXT);
    const rhr = groups.find(g => g.id === 'resting_heart_rate')!;
    const hrv = groups.find(g => g.id === 'heart_rate_variability')!;

    // 55.7 and 56 are HRV values; 55.7 is not a resting-heart-rate value, but
    // 56 IS — as resting heart rate's own coverage count. That coincidence is
    // what a loose rounding rule alone lets 55.7 ride in on; the exact-match
    // rule is what closes it.
    expect(hrv.values).toContain(55.7);
    expect(hrv.values).toContain(56);
    expect(rhr.values).not.toContain(55.7);
    expect(rhr.values).toContain(56);
    expect(rhr.units.has('bpm')).toBe(true);
    expect(hrv.units.has('ms')).toBe(true);
  });

  it('rejects a decimal that only rounds onto another metric, and is exactly a third', () => {
    // 55.7 is exactly HRV's, within 2% of resting heart rate's 56 ("rounding"),
    // and not resting heart rate's at all. It must be refused, not rounded in.
    const audit = auditBriefingNumbers(
      { headline: '', body: 'Resting heart rate averaged 55.7 bpm this week.', recommendations: [] },
      CONTEXT
    );
    expect(audit.traceability.unmatched).toEqual(['55.7']);
    expect(audit.attributionViolations.join(' ')).toMatch(/HRV/);
  });

  it('rejects a decimal that only rounds onto an INTEGER count, with no metric supplying it exactly', () => {
    // The live failure mode: resting heart rate's 56-day coverage count is an
    // integer within 2% of 55.7, and no metric supplies 55.7 at all. Rounding may
    // lose precision, never invent it, so 55.7 is refused.
    const context = {
      ...CONTEXT,
      metrics: CONTEXT.metrics.map(m =>
        m.metricId === 'heart_rate_variability'
          ? { ...m, baseline30: { ...m.baseline30!, value: 34.5, display: '34 ms' } }
          : m
      ),
    } as BriefingContext;

    const audit = auditBriefingNumbers(
      { headline: '', body: 'Resting heart rate averaged 55.7 bpm this week.', recommendations: [] },
      context
    );
    expect(audit.traceability.unmatched).toEqual(['55.7']);
    // A precision refusal is not a wrong-metric one: no metric supplies 55.7.
    expect(audit.attributionViolations).toEqual([]);
  });

  it('splits a paragraph into claims without breaking a decimal', () => {
    expect(splitClaims('RHR was 65.4 bpm. HRV was 36 ms.')).toEqual([
      'RHR was 65.4 bpm.',
      'HRV was 36 ms.',
    ]);
  });

  it('REJECTS generation A: an HRV value labelled bpm is a violation', () => {
    const audit = auditBriefingNumbers(GENERATION_A, CONTEXT);

    // 55.7 exists in the context — under HRV — and is now flagged anyway;
    // 56, correctly labelled ms, is not. Exactly one figure is wrong here.
    expect(audit.traceability.unmatched).toEqual(['55.7']);
    expect(audit.attributionViolations.length).toBeGreaterThan(0);
    expect(audit.attributionViolations.join(' ')).toMatch(/HRV/);

    // The offending value is never republished: parsing fails closed.
    const parsed = parseBriefingReply(JSON.stringify(GENERATION_A), CONTEXT);
    expect(parsed.ok).toBe(false);
    expect(parsed.text).toBeNull();
    expect(parsed.reason).toMatch(/different measure/);
    expect(parsed.traceability.unmatched).toContain('55.7');
  });

  it('accepts generation B: every figure is attributed to its own metric', () => {
    const audit = auditBriefingNumbers(GENERATION_B, CONTEXT);
    expect(audit.traceability.checked).toBeGreaterThan(0);
    expect(audit.traceability.unmatched).toEqual([]);
    expect(audit.attributionViolations).toEqual([]);

    const parsed = parseBriefingReply(JSON.stringify(GENERATION_B), CONTEXT);
    expect(parsed.ok).toBe(true);
    expect(parsed.text).not.toBeNull();
  });

  it('accepts a legitimate rounding and a "6.3K" unit restatement', () => {
    const context: BriefingContext = {
      ...CONTEXT,
      metrics: [
        ...CONTEXT.metrics,
        metric(
          'step_count',
          'Steps',
          'count',
          {
            latest: { ...stat(6300, '6.3K'), date: '2026-09-17' },
            mean7: { ...stat(6300, '6.3K'), observations: 7 },
            mean7Prior: { ...stat(5900, '5.9K'), observations: 7 },
          },
          // Steps is sparse in this fixture; its own coverage stays in its set.
          { observedDays: 7, expectedDays: 7 }
        ),
      ],
    };

    const audit = auditBriefingNumbers(
      {
        headline: 'Steps held near 6,300 a day this week.',
        body: 'Steps averaged 6.3K over the last 7 days, up on the 5,900 the week before.',
        recommendations: ['Keep recording as you do now.'],
      },
      context
    );

    expect(audit.traceability.unmatched).toEqual([]);
    expect(audit.attributionViolations).toEqual([]);
  });

  it('accepts an un-attributed claim about a figure that belongs to no single metric', () => {
    const audit = auditBriefingNumbers(
      {
        headline: 'A steady week.',
        body: 'These figures cover the last 7 days against the previous 7.',
        recommendations: ['Keep recording as you do now.'],
      },
      CONTEXT
    );
    expect(audit.traceability.unmatched).toEqual([]);
  });

  it('still flags a figure that is nowhere in the context', () => {
    const audit = auditBriefingNumbers(
      { headline: 'Your recovery score is 4242 today.', body: 'Sleep averaged 9h 31m this week.', recommendations: [] },
      CONTEXT
    );
    expect(audit.traceability.unmatched).toContain('4242');
    expect(audit.traceability.unmatched).toContain('9h 31m');
  });

  it('does not let the old flat check accept generation A either', () => {
    // checkBriefingTraceability now delegates to the metric-aware guard, so the
    // regression is visible through the pre-existing public entry point too.
    const trace = checkBriefingTraceability(GENERATION_A, CONTEXT);
    expect(trace.unmatched).toContain('55.7');
  });

  it('does not scale across units: a value multiplied by 1000 is not a match', () => {
    // 65.4 bpm is a real value; 65400 is not made from it by any allowed rule.
    const audit = auditBriefingNumbers(
      { headline: 'Resting heart rate was 65400 bpm.', body: '', recommendations: [] },
      CONTEXT
    );
    expect(audit.traceability.unmatched).toContain('65400');
  });
});

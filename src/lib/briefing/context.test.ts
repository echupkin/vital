// ── Today's briefing: context, prompt and the number guard ──
//
// The context is what the model is allowed to see, so what it contains is a
// product decision, not an implementation detail: aggregates only, a hard cap on
// metrics, and an explicit statement of what is not recorded. These tests pin
// that shape, the bound the prompt relies on, and the guard that discards text
// containing a figure the context does not have.
//
// No test here touches a network or a provider.

import { afterEach, describe, expect, it } from 'vitest';
import {
  resetToDemoDataset,
  setActiveDataset,
} from '@/lib/adapters/dataset';
import type { HealthFixtures, SleepObservation } from '@/lib/metrics/types';
import {
  BRIEFING_CONTEXT_MAX_TOKENS,
  CORE_BRIEFING_METRICS,
  MAX_BRIEFING_METRICS,
  MIN_BRIEFING_METRICS,
  buildBriefingContext,
  estimateContextTokens,
} from '@/lib/briefing/context';
import {
  BRIEFING_BODY_MAX_WORDS,
  BRIEFING_MAX_RECOMMENDATIONS,
  BRIEFING_SYSTEM_PROMPT,
  buildBriefingUserMessage,
} from '@/lib/briefing/prompt';
import {
  checkBriefingTraceability,
  clipToWords,
  collectContextNumbers,
  forbiddenCopyIn,
  parseBriefingReply,
} from '@/lib/briefing/validate';

afterEach(() => resetToDemoDataset());

// ── A small, fully controlled dataset ───────────────────

function stagedNight(date: string, asleepMinutes: number, bedtime: string, wakeTime: string): SleepObservation {
  const inBed = (Date.parse(wakeTime) - Date.parse(bedtime)) / 60000;
  return {
    date,
    bedtime,
    wakeTime,
    durationMinutes: asleepMinutes + (inBed - asleepMinutes),
    inBedMinutes: inBed,
    asleepMinutes,
    stages: {
      deep: Math.round(asleepMinutes * 0.2 * 10) / 10,
      rem: Math.round(asleepMinutes * 0.2 * 10) / 10,
      core: Math.round(asleepMinutes * 0.6 * 10) / 10,
      awake: Math.round((inBed - asleepMinutes) * 10) / 10,
    },
    source: 'test device',
  };
}

function inBedOnlyNight(date: string, bedtime: string, wakeTime: string): SleepObservation {
  const inBed = (Date.parse(wakeTime) - Date.parse(bedtime)) / 60000;
  return {
    date,
    bedtime,
    wakeTime,
    durationMinutes: inBed,
    inBedMinutes: inBed,
    asleepMinutes: 0,
    stages: { deep: 0, rem: 0, core: 0, awake: 0 },
    source: 'test device',
  };
}

/** Ten days of resting heart rate, plus the four sleep records described below. */
function syntheticDataset(options: {
  sleep: SleepObservation[];
  referenceDate?: string;
  extraMetrics?: HealthFixtures['metrics'];
}): HealthFixtures {
  const rhr: { date: string; qty: number; units: string; source: string }[] = [];
  for (let i = 14; i >= 1; i--) {
    const day = `2026-09-${String(18 - i).padStart(2, '0')}`;
    rhr.push({ date: day, qty: 52 + (i % 5), units: 'bpm', source: 'test device' });
  }
  return {
    referenceDate: options.referenceDate ?? '2026-09-18T04:00:00.000Z',
    windowStart: '2026-09-01T04:00:00.000Z',
    windowEnd: '2026-09-18T04:00:00.000Z',
    days: 18,
    timezone: 'America/Chicago',
    metrics: {
      resting_heart_rate: rhr,
      sleep_analysis: options.sleep,
      ...(options.extraMetrics ?? {}),
    },
    workouts: [],
    coverage: {
      resting_heart_rate: {
        firstObservation: rhr[0].date,
        lastObservation: rhr[rhr.length - 1].date,
        observedDays: rhr.length,
        expectedDays: 18,
        samplingFrequency: 'daily',
        sourceNames: ['test device'],
      },
      sleep_analysis: {
        firstObservation: '2026-09-10',
        lastObservation: '2026-09-17',
        observedDays: new Set(options.sleep.map(s => s.date)).size,
        expectedDays: 18,
        samplingFrequency: 'nightly',
        sourceNames: ['test device'],
      },
    },
  };
}

describe("the briefing context", () => {
  it('describes the demo dataset with aggregates only, never a record dump', () => {
    const context = buildBriefingContext('metric');

    expect(context.metrics.length).toBeGreaterThan(0);
    expect(context.metrics.length).toBeLessThanOrEqual(MAX_BRIEFING_METRICS);
    for (const metric of context.metrics) {
      expect(metric.latest).not.toBeNull();
      expect(metric.latest!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(metric.coverage.observedDays).toBeGreaterThan(0);
      expect(metric.coverage.expectedDays).toBeGreaterThanOrEqual(metric.coverage.observedDays);
      // The two 7-day windows and the baseline are stated together or not at all:
      // a row that cannot be compared says so through nulls, never through zeros.
      const comparable = metric.mean7 != null;
      expect(metric.mean7Prior != null).toBe(comparable);
      expect(metric.change7Percent != null).toBe(comparable);
      if (comparable) {
        // Every statistic carries the string the model is told to quote.
        expect(metric.mean7!.display.length).toBeGreaterThan(0);
        expect(metric.mean7Prior!.display.length).toBeGreaterThan(0);
      }
      if (metric.baseline30 != null) expect(metric.baseline30.display.length).toBeGreaterThan(0);
    }

    // The four signals the Overview leads with are all comparable this week.
    for (const metricId of ['resting_heart_rate', 'heart_rate_variability', 'step_count']) {
      const row = context.metrics.find(m => m.metricId === metricId)!;
      expect(row.mean7).not.toBeNull();
      expect(row.mean7Prior).not.toBeNull();
      expect(row.baseline30).not.toBeNull();
    }

    // No series is sent: nothing in the context is an array of per-day points.
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) {
          expect(item).not.toHaveProperty('key');
          walk(item);
        }
        return;
      }
      if (value && typeof value === 'object') {
        expect(value).not.toHaveProperty('points');
        expect(value).not.toHaveProperty('series');
        Object.values(value as Record<string, unknown>).forEach(walk);
      }
    };
    walk(context);

    // The window the numbers describe is stated once, in the windows block.
    expect(context.windows.evaluatedDays).toBe(7);
    expect(context.windows.priorDays).toBe(7);
    expect(context.windows.baselineDays).toBe(30);
    expect(context.windows.evaluatedRange.length).toBeGreaterThan(0);
    expect(context.windows.baselineRange.length).toBeGreaterThan(0);
  });

  it('stays inside the token target the prompt assumes', () => {
    const context = buildBriefingContext('metric');
    expect(estimateContextTokens(context)).toBeLessThanOrEqual(BRIEFING_CONTEXT_MAX_TOKENS);
  });

  it('drops the least important rows, and says so, when the bound would be exceeded', () => {
    // Every core metric present with long values: the bound has to be enforced
    // by dropping rows, not merely hoped for.
    const metrics: HealthFixtures['metrics'] = {};
    for (const metricId of CORE_BRIEFING_METRICS) {
      metrics[metricId] = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        qty: 1_234_567.89 + i,
        units: '',
        source: 'test device',
      }));
    }
    setActiveDataset(
      {
        referenceDate: '2026-09-30T04:00:00.000Z',
        windowStart: '2026-09-01T04:00:00.000Z',
        windowEnd: '2026-09-30T04:00:00.000Z',
        days: 30,
        timezone: 'America/Chicago',
        metrics,
        workouts: [],
        coverage: {},
      },
      { mode: 'demo', dataAsOf: '2026-09-30T04:00:00.000Z' }
    );

    // A ceiling tight enough to force rows out, but above the floor the builder
    // never drops below (the four Overview signals).
    const context = buildBriefingContext('metric', { maxContextTokens: 900 });
    expect(estimateContextTokens(context)).toBeLessThanOrEqual(900);
    expect(context.metrics.length).toBeGreaterThanOrEqual(MIN_BRIEFING_METRICS);
    expect(context.metrics.length).toBeLessThan(CORE_BRIEFING_METRICS.length);
    // What was left out is stated, so the model knows it is reading a subset.
    expect(context.metricsOmitted).toBeGreaterThan(0);
    expect(context.missing.join(' ')).toMatch(/not detailed here/);
    // The rows that survive are the ones the Overview leads with.
    expect(context.metrics[0].metricId).toBe('resting_heart_rate');

    // With the production ceiling the same dataset fits without dropping a row.
    const production = buildBriefingContext('metric');
    expect(estimateContextTokens(production)).toBeLessThanOrEqual(BRIEFING_CONTEXT_MAX_TOKENS);
    expect(production.metricsOmitted).toBe(0);
  });

  it('states missing data instead of imputing a value for it', () => {
    setActiveDataset(syntheticDataset({ sleep: [] }), { mode: 'demo', dataAsOf: '2026-09-18T04:00:00.000Z' });
    const context = buildBriefingContext('metric');

    // VO₂ max and blood pressure are registered metrics with no records here.
    expect(context.metrics.some(m => m.metricId === 'vo2max')).toBe(false);
    expect(context.metrics.some(m => m.metricId === 'blood_pressure')).toBe(false);

    const notes = context.missing.join(' ');
    expect(notes).toMatch(/VO₂ max has no reading anywhere in this history/i);
    expect(notes).toMatch(/Blood Pressure has no reading anywhere in this history/i);
    // Nothing anywhere in the context invents a zero reading for them.
    expect(JSON.stringify(context)).not.toContain('"vo2max"');
  });

  it('builds the sleep block from the corrected night series', () => {
    const full = stagedNight('2026-09-15', 500, '2026-09-15T05:00:00.000Z', '2026-09-15T14:30:00.000Z');
    setActiveDataset(
      syntheticDataset({
        sleep: [
          full,
          // The same episode exported again under a different `date`: one night.
          { ...full, date: '2026-09-15T22:00:00.000Z' },
          // An in-bed-only record: a night, but not a night of zero sleep.
          inBedOnlyNight('2026-09-16', '2026-09-16T05:00:00.000Z', '2026-09-16T12:00:00.000Z'),
          stagedNight('2026-09-17', 420, '2026-09-17T05:00:00.000Z', '2026-09-17T13:00:00.000Z'),
        ],
      }),
      { mode: 'demo', dataAsOf: '2026-09-18T04:00:00.000Z' }
    );
    const context = buildBriefingContext('metric');
    const sleep = context.sleep!;

    // Four records, three nights, one of which carries no stage split.
    expect(sleep.coverage.nights).toBe(3);
    expect(sleep.coverage.nightsWithStages).toBe(2);
    expect(sleep.coverage.inBedOnlyNights).toBe(1);

    // Time asleep is the mean of the STAGED nights only: 500 and 420, never a
    // zero for the in-bed-only record.
    expect(sleep.mean7Asleep!.value).toBeCloseTo(460, 6);
    expect(sleep.mean7Asleep!.display).toBe('7h 40m');
    expect(sleep.nightsWithStages7).toBe(2);

    // Time in bed includes all three.
    expect(sleep.mean7InBed!.nights).toBe(3);

    // The latest night is the last recorded one, with its window and stages.
    expect(sleep.latestNight!.date).toBe('2026-09-17');
    expect(sleep.latestNight!.asleep).toBe('7h 0m');
  });
});

describe('the briefing prompt', () => {
  it('states the owner-facing rules: grounded numbers, no diagnosis, no alarm', () => {
    const prompt = BRIEFING_SYSTEM_PROMPT;
    expect(prompt).toMatch(/never diagnose/i);
    expect(prompt).toMatch(/never call a reading, a change or the overall picture "normal" or "abnormal"/i);
    expect(prompt).toMatch(/cause/i);
    expect(prompt).toMatch(/never recommend seeing a clinician/i);
    expect(prompt).toMatch(new RegExp(`${BRIEFING_BODY_MAX_WORDS} words or fewer`));
    expect(prompt).toMatch(new RegExp(`2-${BRIEFING_MAX_RECOMMENDATIONS}`));
    expect(prompt).toMatch(/quote them exactly/i);
    expect(prompt).toMatch(/"headline"/);
    expect(prompt).toMatch(/"recommendations"/);
  });

  it('carries the exact context the guard measures against', () => {
    const context = buildBriefingContext('metric');
    const message = buildBriefingUserMessage({ context });
    // Serialized by the same JSON.stringify the guard uses, so the numbers the
    // model is shown and the numbers it is audited against cannot drift.
    expect(message).toContain(JSON.stringify(context));
    expect(message).toMatch(/not recorded/i);
  });
});

describe('the number-traceability guard', () => {
  it('accepts a restatement of the context, including a rounded one', () => {
    const context = buildBriefingContext('metric');
    const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
    const trace = checkBriefingTraceability(
      {
        headline: `Resting heart rate is ${rhr.mean7!.display} this week.`,
        body: `Over the last ${context.windows.evaluatedDays} days your resting heart rate averaged ${rhr.mean7!.display}, against ${rhr.mean7Prior!.display} in the ${context.windows.priorDays} before.`,
        recommendations: ['Keep your wake time consistent.'],
      },
      context
    );
    expect(trace.checked).toBeGreaterThan(0);
    expect(trace.unmatched).toEqual([]);
  });

  it('flags an invented figure', () => {
    const context = buildBriefingContext('metric');
    const trace = checkBriefingTraceability(
      {
        headline: 'Your recovery score is 4242 today.',
        body: 'Sleep averaged 9h 31m this week.',
        recommendations: [],
      },
      context
    );
    expect(trace.unmatched).toContain('4242');
    expect(trace.unmatched).toContain('9h 31m');
  });

  it('fails the whole reply closed when any figure is untraceable', () => {
    const context = buildBriefingContext('metric');
    const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
    const reply = JSON.stringify({
      headline: `Resting heart rate is ${rhr.mean7!.display}.`,
      body: `You averaged ${rhr.mean7!.display} this week, which is a 4242% improvement.`,
      recommendations: ['Keep going.', 'Keep your bedtime steady.'],
    });
    const parsed = parseBriefingReply(reply, context);
    expect(parsed.ok).toBe(false);
    expect(parsed.text).toBeNull();
    expect(parsed.reason).toMatch(/not in the recorded data/);
    expect(parsed.traceability.unmatched).toContain('4242');
  });

  it('discards text that uses vocabulary the product forbids', () => {
    const context = buildBriefingContext('metric');
    const forbidden = parseBriefingReply(
      JSON.stringify({
        headline: 'Your week looks normal.',
        body: 'Your resting heart rate stayed inside your recent baseline.',
        recommendations: ['Keep your bedtime steady.'],
      }),
      context
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.reason).toMatch(/forbids/);
    expect(forbiddenCopyIn({ headline: 'Your week looks normal.', body: '', recommendations: [] })).toHaveLength(1);
  });

  it('trims an over-long paragraph at a sentence boundary rather than publishing it', () => {
    const long = `${'One two three four five. '.repeat(30)}Final sentence here.`;
    const clipped = clipToWords(long, BRIEFING_BODY_MAX_WORDS);
    expect(clipped.clipped).toBe(true);
    expect(clipped.text.split(/\s+/).length).toBeLessThanOrEqual(BRIEFING_BODY_MAX_WORDS);
    expect(clipped.text.endsWith('.')).toBe(true);
  });

  it('drops recommendations past the cap and keeps the reply usable', () => {
    const context = buildBriefingContext('metric');
    const parsed = parseBriefingReply(
      JSON.stringify({
        headline: 'A quiet week by your own recent baseline.',
        body: 'Your recorded signals sat close to their recent ranges this week.',
        recommendations: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'],
      }),
      context
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.text!.recommendations).toHaveLength(BRIEFING_MAX_RECOMMENDATIONS);
    expect(parsed.adjustments.join(' ')).toMatch(/dropped recommendations/);
  });

  it('collects the context numbers once, for the audit', () => {
    const context = buildBriefingContext('metric');
    const numbers = collectContextNumbers(context);
    expect(numbers.length).toBeGreaterThan(10);
    expect(numbers.every(n => Number.isFinite(n))).toBe(true);
  });

  it('accepts a quoted display string whose numeric form is not in the JSON', () => {
    // Durations and unit-suffixed values are the trap: the context carries
    // "7h 5m" and "14 h" as strings, so the numbers 425 and 840 appear nowhere
    // in the payload. Quoting them is exactly what the prompt asks for, so the
    // guard must accept it — while an invented figure still fails.
    const nights = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-09-${String(11 + i).padStart(2, '0')}`,
      qty: 14,
      units: 'h',
      source: 'test device',
    }));
    const syntheticSleep = [
      stagedNight('2026-09-16', 425, '2026-09-16T05:00:00.000Z', '2026-09-16T13:00:00.000Z'),
      stagedNight('2026-09-17', 500, '2026-09-17T05:00:00.000Z', '2026-09-17T13:30:00.000Z'),
    ];
    setActiveDataset(
      syntheticDataset({
        sleep: syntheticSleep,
        extraMetrics: { apple_stand_hours: nights },
      }),
      { mode: 'demo', dataAsOf: '2026-09-18T04:00:00.000Z' }
    );

    const context = buildBriefingContext('metric');
    const latest = context.sleep!.latestNight!;
    expect(latest.asleep).toBe('8h 20m');
    // The latest night's value is NOT in the payload as a number: its mean is
    // 462.5, so only the display string carries it.
    expect(/(^|[^\d])500([^\d]|$)/.test(JSON.stringify(context))).toBe(false);

    const trace = checkBriefingTraceability(
      {
        headline: `Last night was ${latest.asleep} asleep.`,
        body: 'Stand hours averaged 14 h a day.',
        recommendations: ['Keep your bedtime steady.'],
      },
      context
    );
    expect(trace.unmatched).toEqual([]);

    // The same shape with a figure the context does not state still fails.
    const invented = checkBriefingTraceability(
      { headline: 'Last night was 9h 31m asleep.', body: '', recommendations: [] },
      context
    );
    expect(invented.unmatched).toContain('9h 31m');
  });

  it('names a truncated reply as truncated rather than as unreadable', () => {
    const context = buildBriefingContext('metric');
    // A reply cut off mid-object (the shape a spent output budget produces).
    const cut = '{"headline":"Steps and exercise minutes are down this week","body":"Over Sep 12';
    const parsed = parseBriefingReply(cut, context);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/cut off/);
    expect(parsed.reason).toMatch(/BRIEFING_MAX_TOKENS/);
  });
});
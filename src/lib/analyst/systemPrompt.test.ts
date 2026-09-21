// ── The context payload the model receives (SPEC §8) ────
//
// Defect A (round 2): the payload sent raw floats and no unit, so the model
// quoted "451.9407407407408" and reported that it had never been told the unit.
// These tests pin the fix: every figure arrives formatted by its registry
// formatter, with a unit label and a plain-language window range, alongside the
// raw numbers the grounding audit compares against.

import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { retrieve, retrieveGeneral } from '@/lib/analyst/retrieval';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import {
  DEFAULT_ANALYST_SYSTEM_PROMPT,
  buildAnalystUserMessage,
  buildContextPayload,
  collectDisplayStrings,
} from '@/lib/analyst/systemPrompt';
import type { RetrievalBundle } from '@/lib/analyst/types';

const sleepBundle = retrieve('sleep-1-month', REFERENCE_KEY);
const sleepPayload = buildContextPayload(sleepBundle, 'metric');
const sleep = sleepPayload.metrics[0];

describe('analyst context payload (SPEC §8)', () => {
  it('formats every figure with the metric formatter instead of a raw float', () => {
    expect(sleep.display.mean).toBe(formatMetricWithUnit('sleep_analysis', sleep.aggregate.mean, 'metric'));
    expect(sleep.display.mean).toMatch(/^\d+h \d+m$/);
    expect(sleep.display.current).toMatch(/^\d+h \d+m$/);
    expect(sleep.display.median).toMatch(/^\d+h \d+m$/);
    expect(sleep.display.min).toMatch(/^\d+h \d+m$/);
    expect(sleep.display.max).toMatch(/^\d+h \d+m$/);
    expect(sleep.display.delta).toMatch(/^[-+](\d+h \d+m|\d+m)$/);
    expect(sleep.display.deltaPercent).toMatch(/^[-+]?\d+\.\d%$/);
  });

  it('never puts more than two decimal places in any display string', () => {
    for (const bundle of [sleepBundle, retrieveGeneral(REFERENCE_KEY)]) {
      for (const text of collectDisplayStrings(bundle)) {
        expect(text).not.toMatch(/\d\.\d{4,}/);
      }
    }
  });

  it('carries the unit label, the display name and the window range in plain language', () => {
    expect(sleep.display.unit).toBe('h');
    expect(sleep.display.metricName).toBe('Sleep');
    expect(sleep.display.aggregation).toBe('daily average');
    expect(sleep.display.window.range).toMatch(/^[A-Z][a-z]{2} \d+ – [A-Z][a-z]{2} \d+$/);
    expect(sleep.display.window.start).toBe(sleep.window.start);
    expect(sleep.display.window.end).toBe(sleep.window.end);
    expect(sleep.display.window.observations).toBe(sleep.observations.evaluated);
    expect(sleep.display.baselineWindow.observations).toBe(sleep.observations.baseline);
    // Each window states its own formatted value.
    expect(sleep.display.window.value).toBe(sleep.display.current);
    expect(sleep.display.baselineWindow.value).toBe(sleep.display.baseline);
  });

  it('names a unit for every metric in the general selection', () => {
    const payload = buildContextPayload(retrieveGeneral(REFERENCE_KEY), 'metric');
    for (const metric of payload.metrics) {
      expect(metric.display.unit.length).toBeGreaterThan(0);
      expect(metric.display.metricName.length).toBeGreaterThan(0);
    }
    const caffeine = payload.metrics.find(m => m.metricId === 'dietary_caffeine');
    expect(caffeine?.display.unit).toBe('mg');
    expect(caffeine?.display.current).toMatch(/mg$/);
  });

  it('keeps the raw numbers alongside the display strings', () => {
    expect(sleep.comparison.current).toBe(sleepBundle.summaries[0].comparison.current);
    expect(sleep.aggregate.mean).toBe(sleepBundle.summaries[0].aggregate.mean);
    expect(sleep.comparison.deltaPercent).toBe(sleepBundle.summaries[0].comparison.deltaPercent);
  });

  it('sends the display block, and the instruction to quote it, in the user message', () => {
    const message = buildAnalystUserMessage({ question: 'How has my sleep changed?', bundle: sleepBundle, system: 'metric' });
    expect(message).toContain('"display"');
    expect(message).toContain(sleep.display.mean);
    expect(message).toContain(sleep.display.window.range);
    expect(message.toLowerCase()).toContain('quote its strings verbatim');
  });

  it('says "no records" rather than a value for a metric with no observations', () => {
    const empty: RetrievalBundle = {
      ...sleepBundle,
      summaries: sleepBundle.summaries.map(s => ({
        ...s,
        points: [],
        counts: { evaluated: 0, baseline: 0 },
        comparison: { ...s.comparison, current: NaN, baseline: NaN, delta: NaN, deltaPercent: null, valid: false },
      })),
    };
    const payload = buildContextPayload(empty, 'metric');
    const display = payload.metrics[0].display;
    expect(display.current).toBe('no records');
    expect(display.mean).toBe('no records');
    expect(display.min).toBe('no records');
    expect(display.delta).toBe('no comparison available');
    expect(display.deltaPercent).toBe('no percentage available');
    expect(display.note).toContain('No Sleep records');
  });
});

describe('the system prompt states how to use the display strings (SPEC §8)', () => {
  it('requires verbatim quoting, a stated unit and one to three follow-ups', () => {
    const prompt = DEFAULT_ANALYST_SYSTEM_PROMPT;
    expect(prompt).toContain('"display"');
    expect(prompt).toContain('Quote those strings verbatim');
    expect(prompt).toContain('Never re-derive a value from the raw numbers');
    expect(prompt).toContain('Always state the unit');
    expect(prompt).toContain('one to three short follow-up questions');
  });
});

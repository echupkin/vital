import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { retrieve, retrieveGeneral } from '@/lib/analyst/retrieval';
import { BOUNDARY_NOTE } from '@/lib/analyst/handlers';
import { buildContextPayload } from '@/lib/analyst/systemPrompt';
import {
  checkGrounding,
  extractJsonObject,
  extractNumericTokens,
  normalizeCitation,
  parseAnalystReply,
} from '@/lib/analyst/validate';
import type { AnalystAnswer } from '@/lib/analyst/types';

const sleepBundle = retrieve('sleep-1-month', REFERENCE_KEY);

function answerFrom(text: string) {
  return parseAnalystReply(text, { bundle: sleepBundle });
}

function baseFields(extra: Record<string, unknown> = {}) {
  return {
    title: 'Sleep across the last 30 days',
    observed: ['Time asleep averaged 7h 15m in the last 30 days.'],
    interpretation: ['The window is short, so a single week can shift the average.'],
    uncertainty: ['Nights without a recording are excluded.'],
    evidence: [
      { metricId: 'sleep_analysis', windowLabel: 'Aug 19 → Sep 17', aggregation: 'daily average', sampleCount: '27 nights' },
    ],
    followUps: ['How is my HRV trending?'],
    ...extra,
  };
}

describe('tolerant JSON extraction (SPEC §8)', () => {
  it('reads a bare object', () => {
    expect(extractJsonObject('{"title":"x"}')).toBe('{"title":"x"}');
  });

  it('reads through a markdown fence and surrounding prose', () => {
    const text = 'Sure — here it is:\n```json\n{"title":"x","observed":["a"]}\n```\nHope that helps.';
    expect(JSON.parse(extractJsonObject(text)!)).toEqual({ title: 'x', observed: ['a'] });
  });

  it('is not fooled by braces inside strings or nesting', () => {
    const text = '{"title":"a { brace }","nested":{"a":[1,2]},"escaped":"\\" }"}';
    expect(JSON.parse(extractJsonObject(text)!)).toEqual(JSON.parse(text));
  });

  it('returns null when no balanced object closes', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"title":"x"')).toBeNull();
  });
});

describe('reply validation and repair (SPEC §8)', () => {
  it('accepts a well-formed reply and appends the standard boundary note', () => {
    const result = answerFrom(JSON.stringify(baseFields()));
    expect(result.ok).toBe(true);
    expect(result.answer!.title).toBe('Sleep across the last 30 days');
    expect(result.answer!.observed).toHaveLength(1);
    expect(result.answer!.boundaryNote).toBe(BOUNDARY_NOTE);
    expect(result.answer!.boundaryNote).toContain('not medical advice');
    expect(result.answer!.boundaryNote).toContain('does not diagnose');
  });

  it('fills evidence from the registry and links only to a route that exists', () => {
    const result = answerFrom(JSON.stringify(baseFields()));
    const ev = result.answer!.evidence[0];
    expect(ev.metricName).toBe('Sleep');
    expect(ev.href).toMatch(/^\/metric\/sleep_analysis\?range=/);
    expect(ev.windowLabel).toBe('Aug 19 → Sep 17');
  });

  it('drops evidence for a metric that is not in the registry or not in the bundle', () => {
    const result = answerFrom(
      JSON.stringify(
        baseFields({
          evidence: [
            { metricId: 'not_a_metric', windowLabel: 'w', aggregation: 'a', sampleCount: 's' },
            // Real registry metric, but never selected for a sleep question.
            { metricId: 'weight_body_mass', windowLabel: 'w', aggregation: 'a', sampleCount: 's' },
            { metricId: 'sleep_analysis', windowLabel: 'w', aggregation: 'a', sampleCount: 's' },
          ],
        })
      )
    );
    expect(result.answer!.evidence.map(e => e.metricId)).toEqual(['sleep_analysis']);
  });

  it('repairs missing evidence metadata from the bundle instead of inventing it', () => {
    const result = answerFrom(JSON.stringify(baseFields({ evidence: [{ metricId: 'sleep_analysis' }] })));
    const ev = result.answer!.evidence[0];
    expect(ev.windowLabel).toContain('vs');
    expect(ev.windowLabel).toMatch(/\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d+/);
    expect(ev.sampleCount).toMatch(/\d+ observations evaluated/);
    expect(ev.aggregation.length).toBeGreaterThan(3);
  });

  it('caps strings, lines and arrays', () => {
    const result = answerFrom(
      JSON.stringify(
        baseFields({
          title: 'x'.repeat(500),
          observed: Array.from({ length: 20 }, (_, i) => `line ${i}`),
          followUps: Array.from({ length: 20 }, (_, i) => `q${i}`),
        })
      )
    );
    expect(result.answer!.title.length).toBeLessThanOrEqual(160);
    expect(result.answer!.observed).toHaveLength(8);
    // The prompt asks for one to three; anything longer is padding.
    expect(result.answer!.followUps).toHaveLength(3);
  });

  it('drops empty sections and refuses a reply with no content at all', () => {
    const partial = answerFrom(JSON.stringify({ title: 't', observed: ['a'], interpretation: [], uncertainty: [] }));
    expect(partial.ok).toBe(true);
    expect(partial.answer!.interpretation).toEqual([]);

    const empty = answerFrom(JSON.stringify({ title: 't', observed: [], interpretation: [], uncertainty: [] }));
    expect(empty.ok).toBe(false);
    expect(empty.answer).toBeNull();
    expect(empty.reason).toContain('no observed');
  });

  it('fails honestly when the reply is not JSON', () => {
    const result = answerFrom('I cannot help with that request.');
    expect(result.ok).toBe(false);
    expect(result.answer).toBeNull();
    expect(result.reason).toContain('did not contain a JSON object');
  });

  it('fails honestly when the object cannot be parsed', () => {
    const result = answerFrom('{"title": "x",,}');
    expect(result.ok).toBe(false);
    expect(result.answer).toBeNull();
  });

  it('builds charts only from metrics that were cited and selected', () => {
    const result = answerFrom(JSON.stringify(baseFields()));
    expect(result.answer!.charts).toHaveLength(1);
    expect(result.answer!.charts[0].metricId).toBe('sleep_analysis');
    expect(result.answer!.charts[0].points.length).toBeGreaterThan(0);
  });
});

describe('grounding check (SPEC §8)', () => {
  it('matches values taken from the bundle, including formatting differences', () => {
    const mean = sleepBundle.summaries[0].aggregate.mean;
    const answer = answerFrom(
      JSON.stringify(
        baseFields({
          observed: [
            `Time asleep averaged ${Math.round(mean)} minutes in the last 30 days.`,
            `That is ${(mean / 60).toFixed(1)} hours per night.`,
          ],
        })
      )
    ).answer as AnalystAnswer;

    const grounding = checkGrounding(answer, sleepBundle);
    expect(grounding.checked).toBeGreaterThan(0);
    expect(grounding.unmatched).toEqual([]);
  });

  it('reports a number that is nowhere in the context instead of dropping it', () => {
    const answer = answerFrom(
      JSON.stringify(
        baseFields({
          observed: ['Time asleep averaged 9999 minutes.', 'The comparison window was 1840 units lower.'],
        })
      )
    ).answer as AnalystAnswer;

    const grounding = checkGrounding(answer, sleepBundle);
    expect(grounding.unmatched).toContain('9999');
    expect(grounding.unmatched).toContain('1840');
  });

  it('reads a duration as one token worth its total minutes', () => {
    const tokens = extractNumericTokens('Time asleep averaged 7h 42m across the window.');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].value).toBe(462);
  });

  it('matches a duration written as hours and minutes against minutes in the bundle', () => {
    const answer: AnalystAnswer = {
      id: 'model',
      title: 't',
      observed: ['Time asleep averaged 7h 42m.'],
      interpretation: [],
      uncertainty: [],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
    const bundleWith462 = {
      ...sleepBundle,
      summaries: sleepBundle.summaries.map(s => ({ ...s, aggregate: { ...s.aggregate, mean: 462 } })),
    };
    expect(checkGrounding(answer, bundleWith462).unmatched).toEqual([]);

    const bundleWithout = {
      ...sleepBundle,
      summaries: sleepBundle.summaries.map(s => ({ ...s, aggregate: { ...s.aggregate, mean: 500 } })),
    };
    expect(checkGrounding(answer, bundleWithout).unmatched).toEqual(['7h 42m']);
  });

  it('does not flag a restated date as an unmatched figure', () => {
    const start = sleepBundle.summaries[0].window.startKey;
    const answer: AnalystAnswer = {
      id: 'model',
      title: 't',
      observed: [`The window runs from ${start} to ${sleepBundle.summaries[0].window.endKey}.`],
      interpretation: [],
      uncertainty: [],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
    // "2026-08-19" yields the tokens 2026, 8 and 19; all three are in the bundle.
    expect(checkGrounding(answer, sleepBundle).unmatched).toEqual([]);
  });

  it('examines every numeric token in observed and interpretation', () => {
    const answer = answerFrom(
      JSON.stringify(baseFields({ observed: ['1 thing'], interpretation: ['2 other things'], uncertainty: ['9999 ignored'] }))
    ).answer as AnalystAnswer;
    const grounding = checkGrounding(answer, sleepBundle);
    // Uncertainty is not audited (it usually describes what is missing).
    expect(grounding.checked).toBe(2);
    expect(grounding.unmatched).not.toContain('9999');
  });
});

describe('grounding formatted citations (SPEC §8)', () => {
  const payload = buildContextPayload(sleepBundle, 'metric');
  const display = payload.metrics[0].display;

  it('accepts a value quoted from the display strings the model was given', () => {
    const answer = answerFrom(
      JSON.stringify(
        baseFields({
          observed: [
            `Time asleep averaged ${display.mean} across ${display.window.label} (${display.window.range}).`,
            `That is ${display.delta} against ${display.baselineWindow.range}, or ${display.deltaPercent}.`,
            `The median night was ${display.median}, the shortest ${display.min} and the longest ${display.max}.`,
          ],
        })
      )
    ).answer as AnalystAnswer;

    // Sanity: these are the human forms, not the raw floats.
    expect(display.mean).toMatch(/^\d+h \d+m$/);
    expect(display.deltaPercent).toMatch(/^[-+]?\d+\.\d%$/);
    const grounding = checkGrounding(answer, sleepBundle);
    expect(grounding.checked).toBeGreaterThan(5);
    expect(grounding.unmatched).toEqual([]);
  });

  it('accepts a display string the raw numbers do not literally contain', () => {
    // step_count's formatter renders a total as "218.8K", whose numeric value
    // (218.8) appears nowhere else in the payload: only the display string
    // states it, and quoting it must count as grounded.
    const general = retrieveGeneral(REFERENCE_KEY);
    const steps = buildContextPayload(general, 'metric').metrics.find(m => m.metricId === 'step_count')!.display;
    expect(steps.current).toMatch(/K$/);

    const answer: AnalystAnswer = {
      id: 'model',
      title: 't',
      observed: [`Steps totalled ${steps.current} across ${steps.window.range}, against ${steps.baseline} in the window before.`],
      interpretation: [],
      uncertainty: [],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
    expect(checkGrounding(answer, general).unmatched).toEqual([]);
  });

  it('normalises separators, markers and unit suffixes before comparing', () => {
    expect(normalizeCitation('≈ 7h 32m')).toBe('7h32m');
    expect(normalizeCitation('~1,234 mg')).toBe('1234mg');
    expect(normalizeCitation('−3.5%')).toBe('-3.5%');
    expect(normalizeCitation('BPM')).toBe('bpm');

    // A citation written with the approximation marker and no space still
    // matches the display string it was given.
    const answer: AnalystAnswer = {
      id: 'model',
      title: 't',
      observed: [`Time asleep averaged ≈ ${display.mean.replace(' ', '')} in the window.`],
      interpretation: [],
      uncertainty: [],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
    expect(checkGrounding(answer, sleepBundle).unmatched).toEqual([]);
  });

  it('still flags an invented figure when display strings are present', () => {
    const answer = answerFrom(
      JSON.stringify(baseFields({ observed: ['Time asleep averaged 9h 12m in the last 30 days.'] }))
    ).answer as AnalystAnswer;
    const grounding = checkGrounding(answer, sleepBundle);
    expect(grounding.unmatched).toContain('9h 12m');
    expect(grounding.checked).toBeGreaterThan(0);
  });

  it('flags an invented percentage and an invented count', () => {
    const answer = answerFrom(
      JSON.stringify(
        baseFields({
          observed: ['Time asleep rose 43.7% across the window.', 'The window held 9999 nights.'],
        })
      )
    ).answer as AnalystAnswer;
    const grounding = checkGrounding(answer, sleepBundle);
    expect(grounding.unmatched).toContain('43.7');
    expect(grounding.unmatched).toContain('9999');
  });

  it('checks every token it extracts, including the last number on a line', () => {
    const text = 'Time asleep averaged 7h 32m and the window held 27 nights.';
    expect(extractNumericTokens(text).map(t => t.value)).toEqual([452, 27]);

    const answer: AnalystAnswer = {
      id: 'model',
      title: 't',
      observed: ['Time asleep averaged 7h 32m in the last 30 days.', 'The shortest night was 5h 12m.'],
      interpretation: ['That is 2h 20m more than 6h 4m, a change of 12.5% across 27 nights.'],
      uncertainty: [],
      evidence: [],
      charts: [],
      followUps: [],
      boundaryNote: BOUNDARY_NOTE,
    };
    const grounding = checkGrounding(answer, sleepBundle);
    // 7h 32m, 30, 5h 12m in observed; 2h 20m, 6h 4m, 12.5, 27 in interpretation.
    expect(grounding.checked).toBe(
      extractNumericTokens([...answer.observed, ...answer.interpretation].join(' ')).length
    );
    expect(grounding.checked).toBeGreaterThanOrEqual(7);
  });
});

describe('follow-ups (SPEC §8)', () => {
  it('keeps one to three of the model’s own questions and never invents any', () => {
    const none = answerFrom(JSON.stringify(baseFields({ followUps: [] })));
    // An empty list is accepted as-is: nothing is fabricated to fill it.
    expect(none.answer!.followUps).toEqual([]);

    const one = answerFrom(JSON.stringify(baseFields({ followUps: ['How is my HRV trending?'] })));
    expect(one.answer!.followUps).toEqual(['How is my HRV trending?']);

    const many = answerFrom(JSON.stringify(baseFields({ followUps: ['a?', 'b?', 'c?', 'd?', 'e?'] })));
    expect(many.answer!.followUps).toEqual(['a?', 'b?', 'c?']);
  });

  it('recovers follow-ups the model returned in an unexpected shape', () => {
    const bare = answerFrom(JSON.stringify(baseFields({ followUps: 'How is my HRV trending?' })));
    expect(bare.answer!.followUps).toEqual(['How is my HRV trending?']);

    const objects = answerFrom(
      JSON.stringify(baseFields({ followUps: [{ question: 'How is my HRV trending?' }, { text: 'What changed this week?' }] }))
    );
    expect(objects.answer!.followUps).toEqual(['How is my HRV trending?', 'What changed this week?']);

    const junk = answerFrom(JSON.stringify(baseFields({ followUps: 42 })));
    expect(junk.answer!.followUps).toEqual([]);

    const duplicated = answerFrom(JSON.stringify(baseFields({ followUps: ['How is my HRV trending?', 'how is my hrv trending?'] })));
    expect(duplicated.answer!.followUps).toEqual(['How is my HRV trending?']);
  });
});

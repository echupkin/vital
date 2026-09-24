// ── Today's briefing: engine resolution, the day schedule and failure ──
//
// Every HTTP call in this file is a stub and nothing reaches a provider: the
// tests replace `globalThis.fetch` — the seam the provider's HTTP path actually
// uses — and restore it afterwards. No credential is needed or used.
//
// What is under test is the behaviour *around* the model: which engine is
// chosen, WHEN a briefing may be written (once per local calendar day, at or
// after the profile's briefing hour), what stays on screen before that hour,
// what happens when the provider is down, and what `Regenerate` actually does.
//
// The clock is injected (`now`) and the profile is passed explicitly, so "today"
// is a fixed instant and the suite never depends on when it is run.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES, resetToDemoDataset, setActiveDataset } from '@/lib/adapters/dataset';
import { getMetric } from '@/lib/metrics';
import { buildBriefingContext, type BriefingContext } from '@/lib/briefing/context';
import { resolveBriefingEngine, DEFAULT_BRIEFING_MAX_TOKENS, DEFAULT_BRIEFING_TIMEOUT_MS } from '@/lib/briefing/engine';
import { parseBriefingReply } from '@/lib/briefing/validate';
import {
  BRIEFING_FAILURE_COOLDOWN_MS,
  COMPUTED_ATTRIBUTION,
  awaitBriefingIdle,
  briefingCacheKey,
  briefingSchedule,
  clearBriefingCache,
  readBriefing,
  regenerateBriefing,
  warmBriefing,
  type BriefingView,
} from '@/lib/briefing';
import { defaultProfile, type VitalProfile } from '@/lib/profile/types';

const REAL_FETCH = globalThis.fetch;

const LOCAL_ENV = {
  VITAL_LLM_BASE_URL: 'http://127.0.0.1:1234/v1',
  VITAL_LLM_MODEL: 'auto',
} as unknown as NodeJS.ProcessEnv;

const ANALYST_ENV = {
  ANALYST_PROVIDER: 'openai',
  ANALYST_API_URL: 'https://provider.example/v1',
  ANALYST_API_KEY: '«redacted:sk-…»',
  ANALYST_MODEL: 'test-model',
} as unknown as NodeJS.ProcessEnv;

/** The hosted fallback provider a guard-rejected reply is re-asked from once. */
const FALLBACK_ENV = {
  VITAL_LLM_FALLBACK_BASE_URL: 'https://provider.example/v1',
  VITAL_LLM_FALLBACK_MODEL: 'fallback-model',
  VITAL_LLM_FALLBACK_API_KEY: '«redacted:fb-…»',
} as unknown as NodeJS.ProcessEnv;

/** A configured server environment, without touching the real process env. */
function envOf(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as unknown as NodeJS.ProcessEnv;
}

/**
 * The profile the schedule is computed against. UTC keeps the day arithmetic in
 * these tests trivial and unambiguous; the profile's timezone is the app's
 * single source of truth for what day it is.
 */
const PROFILE: VitalProfile = { ...defaultProfile('UTC'), name: 'Test Person', briefingHour: 6 };

/** A fixed clock: 13:00 local, comfortably past the briefing hour. */
const MIDDAY = () => new Date('2026-09-18T13:00:00.000Z');
const instant = (iso: string) => () => new Date(iso);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface StubOptions {
  /** Model ids the local server advertises. */
  models?: string[];
  /** The chat reply content. */
  content?: string;
  /**
   * One reply per chat call, in order; the last entry repeats. Used to model a
   * model that gets it wrong once and right the second time, and to prove that a
   * regeneration really produced new text.
   */
  contents?: string[];
  /** HTTP status for the chat request (>= 400 answers an error body). */
  chatStatus?: number;
  chatBody?: unknown;
  chatModel?: string;
  /** The /models probe fails at the transport level (nothing listening). */
  probeFails?: boolean;
  /** The chat request fails at the transport level. */
  chatFails?: boolean;
  /** Called with every request URL. */
  onCall?: (url: string) => void;
}

function stubFetch(options: StubOptions = {}): typeof fetch {
  let chatCalls = 0;
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    options.onCall?.(url);
    if (url.endsWith('/models')) {
      if (options.probeFails) throw new Error('connect ECONNREFUSED');
      return jsonResponse({ data: (options.models ?? ['local-model-1']).map(id => ({ id })) });
    }
    chatCalls += 1;
    if (options.chatFails) throw new Error('connect ECONNREFUSED');
    if (options.chatStatus && options.chatStatus >= 400) {
      return jsonResponse(options.chatBody ?? { error: { message: 'nope' } }, options.chatStatus);
    }
    const sequence = options.contents;
    const content = sequence && sequence.length > 0
      ? sequence[Math.min(chatCalls - 1, sequence.length - 1)]
      : options.content ?? '{}';
    return jsonResponse({
      model: options.chatModel ?? 'local-model-1',
      choices: [{ message: { content }, finish_reason: 'stop' }],
    });
  }) as unknown as typeof fetch;
}

/** Install the stub the provider's fetch() will pick up. */
function installFetch(options: StubOptions = {}): void {
  globalThis.fetch = stubFetch(options);
}

/** A stub that also counts chat calls (never the /models probe). */
function counting(options: Omit<StubOptions, 'onCall'> = {}): { options: StubOptions; calls: () => number } {
  let calls = 0;
  return {
    options: {
      ...options,
      onCall: (url: string) => {
        if (url.includes('/chat/completions')) calls += 1;
      },
    },
    calls: () => calls,
  };
}

/** Grounded model prose built from the context the model would have been given. */
function groundedReply(
  context: BriefingContext,
  extra = '',
  headline = 'Your week sits close to your own recent baseline.'
): string {
  const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
  return JSON.stringify({
    headline,
    body:
      `Resting heart rate averaged ${rhr.mean7!.display} across the last ${context.windows.evaluatedDays} days, ` +
      `against ${rhr.mean7Prior!.display} in the ${context.windows.priorDays} before.` +
      extra,
    recommendations: ['Keep your bedtime in a steady range.', 'Keep recording as you do now.'],
  });
}

/**
 * A reply that carries a figure the context records under another metric: an
 * HRV value published as resting heart rate. This is the live defect in
 * miniature — the number is real, the label is wrong — and it is the reply the
 * number guard must discard.
 */
function wrongMetricReply(context: BriefingContext): string {
  const hrv = context.metrics.find(m => m.metricId === 'heart_rate_variability')!;
  const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
  return JSON.stringify({
    headline: 'Your heart readings softened this week.',
    body: `Resting heart rate averaged ${hrv.latest!.value} bpm this week, against ${rhr.mean7Prior!.display} before.`,
    recommendations: ['Keep your bedtime steady.'],
  });
}

type BriefingDepsArg = Parameters<typeof readBriefing>[0];
const deps = (overrides: Partial<BriefingDepsArg> = {}): BriefingDepsArg => ({
  env: LOCAL_ENV,
  profile: PROFILE,
  now: MIDDAY,
  ...overrides,
});

/**
 * The prose the reader actually sees.
 *
 * A figure the number guard rejected must not appear here — but it must not be
 * checked against the whole serialized payload either. The payload carries live
 * clock values (`generatedAt`, `asOf`), and a rejected two-digit figure collides
 * with those digits by chance: the HRV latest reading is `48`, so
 * `expect(JSON.stringify(view)).not.toContain('48')` failed whenever the wall
 * clock's minute, second or milliseconds happened to contain `48` — about one
 * run in five, in the full suite and alone alike. That is a check against the
 * clock, not a check on the briefing.
 */
function publishedText(view: BriefingView): string {
  return [view.headline, view.body, ...view.recommendations].join('\n');
}

beforeEach(() => {
  clearBriefingCache();
  resetToDemoDataset();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  clearBriefingCache();
  resetToDemoDataset();
});

describe('resolving the briefing engine', () => {
  it('prefers the local model server and resolves `auto` to a real model id', async () => {
    const seen: string[] = [];
    const engine = await resolveBriefingEngine({
      env: LOCAL_ENV,
      fetchImpl: stubFetch({ models: ['qwen3-8b', 'second-model'], onCall: url => seen.push(url) }),
    });

    expect(engine.kind).toBe('local');
    expect(engine.model).toBe('qwen3-8b');
    expect(engine.destination).toBe('127.0.0.1:1234');
    expect(engine.detail).toMatch(/VITAL_LLM_MODEL=auto resolved to "qwen3-8b"/);
    // The probe is a bounded GET /models on the configured base URL.
    expect(seen).toEqual(['http://127.0.0.1:1234/v1/models']);
  });

  it('uses a configured model id verbatim when it is not `auto`', async () => {
    const engine = await resolveBriefingEngine({
      env: { ...LOCAL_ENV, VITAL_LLM_MODEL: 'my-local-model' },
      fetchImpl: stubFetch({ models: ['qwen3-8b'] }),
    });
    expect(engine.model).toBe('my-local-model');
  });

  it('falls through to the analyst provider when the local server does not answer', async () => {
    const engine = await resolveBriefingEngine({
      env: { ...LOCAL_ENV, ...ANALYST_ENV },
      fetchImpl: stubFetch({ probeFails: true }),
    });

    expect(engine.kind).toBe('analyst');
    expect(engine.model).toBe('test-model');
    expect(engine.destination).toBe('provider.example');
    expect(engine.detail).toMatch(/could not be reached/);
    expect(engine.detail).toMatch(/Falling back/);
  });

  it('gives the analyst-backed engine the briefing token budget, not the analyst one', async () => {
    // A reasoning model spends the budget on its reasoning before it writes the
    // reply, so inheriting ANALYST_MAX_TOKENS=1200 truncated the JSON mid-object.
    const engine = await resolveBriefingEngine({
      env: envOf({ ...ANALYST_ENV, ANALYST_MAX_TOKENS: '1200' }),
      fetchImpl: stubFetch({}),
    });

    expect(engine.config?.maxTokens).toBe(DEFAULT_BRIEFING_MAX_TOKENS);
    expect(engine.config?.maxTokens).toBeGreaterThan(1200);

    // An explicit briefing budget is honoured, and the timeout is bounded.
    const tuned = await resolveBriefingEngine({
      env: envOf({ ...ANALYST_ENV, ANALYST_MAX_TOKENS: '1200', BRIEFING_MAX_TOKENS: '6000', ANALYST_TIMEOUT_MS: '60000' }),
      fetchImpl: stubFetch({}),
    });
    expect(tuned.config?.maxTokens).toBe(6000);
    expect(tuned.config?.timeoutMs).toBe(DEFAULT_BRIEFING_TIMEOUT_MS);
  });

  it('reports no engine when neither is available', async () => {
    const engine = await resolveBriefingEngine({ env: envOf({}), fetchImpl: stubFetch({}) });
    expect(engine.kind).toBe('none');
    expect(engine.config).toBeNull();
    expect(engine.detail).toMatch(/not set/);
  });

  it('never puts a credential in the resolved engine description', async () => {
    const engine = await resolveBriefingEngine({
      env: { ...LOCAL_ENV, ...ANALYST_ENV, VITAL_LLM_API_KEY: 'local-secret-key' },
      fetchImpl: stubFetch({ probeFails: true }),
    });
    const serialized = JSON.stringify({
      ...engine,
      config: engine.config ? { ...engine.config, apiKey: undefined } : null,
    });
    expect(serialized).not.toContain('local-secret-key');
    expect(serialized).not.toContain('«redacted:sk-…»');
  });
});

describe('the briefing day schedule', () => {
  it('is keyed on the local calendar day, with no dataset identity in the key', () => {
    const schedule = briefingSchedule(PROFILE, MIDDAY());
    expect(schedule.coversDay).toBe('2026-09-18');
    expect(schedule.allowed).toBe(true);

    const key = briefingCacheKey(schedule, 'metric', PROFILE);
    expect(key).toContain('2026-09-18');

    // New observations landing later the same day must NOT change the key: that
    // is the whole defect this schedule exists to fix.
    setActiveDataset(
      {
        ...FIXTURES,
        referenceDate: '2026-09-18T23:00:00.000Z',
        windowEnd: '2026-09-18T23:00:00.000Z',
      },
      { mode: 'demo', dataAsOf: '2026-09-18T23:00:00.000Z' }
    );
    expect(FIXTURES.referenceDate).not.toBe('2026-09-18T23:00:00.000Z');
    const later = briefingSchedule(PROFILE, new Date('2026-09-18T23:00:00.000Z'));
    expect(briefingCacheKey(later, 'metric', PROFILE)).toBe(key);
  });

  it('covers yesterday until the profile hour has passed', () => {
    const before = briefingSchedule(PROFILE, new Date('2026-09-18T05:59:00.000Z'));
    expect(before.allowed).toBe(false);
    expect(before.coversDay).toBe('2026-09-17');

    const at = briefingSchedule(PROFILE, new Date('2026-09-18T06:00:00.000Z'));
    expect(at.allowed).toBe(true);
    expect(at.coversDay).toBe('2026-09-18');
  });

  it('honours a differently configured briefing hour', () => {
    const late = { ...PROFILE, briefingHour: 9 };
    expect(briefingSchedule(late, new Date('2026-09-18T08:00:00.000Z')).coversDay).toBe('2026-09-17');
    expect(briefingSchedule(late, new Date('2026-09-18T09:00:00.000Z')).coversDay).toBe('2026-09-18');
  });

  it('keys the cache by unit system and by the profile that reaches the prompt', () => {
    const schedule = briefingSchedule(PROFILE, MIDDAY());
    expect(briefingCacheKey(schedule, 'metric', PROFILE)).not.toBe(briefingCacheKey(schedule, 'imperial', PROFILE));
    // A renamed profile is a different prompt, so it is a different entry.
    const renamed = { ...PROFILE, name: 'Someone Else' };
    expect(briefingCacheKey(schedule, 'metric', renamed)).not.toBe(briefingCacheKey(schedule, 'metric', PROFILE));

    // Imperial formatting is what the model is given for an imperial reader.
    const context = buildBriefingContext('imperial');
    const weight = context.metrics.find(m => m.metricId === 'weight_body_mass');
    if (weight?.latest) expect(weight.latest.display).toMatch(/lb/);
    expect(getMetric('weight_body_mass')).toBeDefined();
  });
});

describe("reading today's briefing", () => {
  it('serves the computed fallback on a cold read without waiting for the model', async () => {
    installFetch();
    const view = readBriefing(deps());
    // Nothing was awaited: the payload is complete and honestly attributed.
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.headline.length).toBeGreaterThan(0);
    expect(view.body.length).toBeGreaterThan(0);
    expect(view.recommendations).toEqual([]);
    expect(view.cached).toBe(false);
    expect(view.coversDay).toBe('2026-09-18');
    expect(view.scheduledHour).toBe(6);
    await awaitBriefingIdle();
  });

  it('serves the written briefing once the background generation lands', async () => {
    installFetch({ content: groundedReply(buildBriefingContext('metric')) });

    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('model');
    expect(view.attribution).toBe('Written by local-model-1');
    expect(view.model).toBe('local-model-1');
    expect(view.provider).toBe('local model');
    expect(view.engine).toBe('local');
    expect(view.cached).toBe(true);
    expect(view.coversDay).toBe('2026-09-18');
    expect(view.recommendations).toHaveLength(2);
    // Every figure in the published text was audited against the context.
    expect(view.traceability.checked).toBeGreaterThan(0);
    expect(view.traceability.unmatched).toEqual([]);
    expect(view.latencyMs).not.toBeNull();
    // The headline is the model's, not the computed one.
    expect(view.headline).toBe('Your week sits close to your own recent baseline.');
  });

  it('discards the model text and renders the computed briefing when a figure is invented', async () => {
    installFetch({
      contents: [groundedReply(buildBriefingContext('metric'), ' Your recovery score is 4242 today.')],
    });

    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/not in the recorded data/);
    expect(publishedText(view)).not.toContain('4242');
  });

  it('re-asks the fallback provider once when the preferred reply fails the guard', async () => {
    const context = buildBriefingContext('metric');
    const wrong = wrongMetricReply(context);
    // The crafted reply really is a guard violation for this context — the test
    // fails loudly here rather than silently testing nothing if the data drifts.
    expect(parseBriefingReply(wrong, context).ok).toBe(false);

    const counter = counting({ contents: [wrong, groundedReply(context)] });
    installFetch(counter.options);

    readBriefing(deps({ env: { ...LOCAL_ENV, ...FALLBACK_ENV } }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env: { ...LOCAL_ENV, ...FALLBACK_ENV } }));
    // The rejected reply was discarded; the fallback's grounded reply is what is
    // published, and the payload says the fallback wrote it.
    expect(view.kind).toBe('model');
    expect(view.engine).toBe('fallback');
    expect(view.provider).toBe('fallback model');
    expect(view.destination).toBe('provider.example');
    expect(view.headline).not.toBe(JSON.parse(wrong).headline);
    expect(view.traceability.unmatched).toEqual([]);
    expect(view.adjustments.join(' ')).toMatch(/fallback provider/);
    // Exactly one primary attempt and exactly one fallback attempt.
    expect(counter.calls()).toBe(2);
  });

  it('serves the computed briefing when the fallback reply fails the same check', async () => {
    const context = buildBriefingContext('metric');
    const wrong = wrongMetricReply(context);
    const counter = counting({ contents: [wrong, wrong] });
    installFetch(counter.options);

    const env = { ...LOCAL_ENV, ...FALLBACK_ENV };
    readBriefing(deps({ env }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/failed the same check/);
    // The offending figure is never published in the briefing text.
    const offending = String(JSON.parse(wrong).body.match(/[\d.]+/)![0]);
    expect(publishedText(view)).not.toContain(offending);
    // One primary attempt + one fallback attempt, and no loop.
    expect(counter.calls()).toBe(2);
  });

  it('serves the computed briefing with exactly one attempt when no fallback is configured', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({ contents: [wrongMetricReply(context)] });
    installFetch(counter.options);

    // LOCAL_ENV only: no VITAL_LLM_FALLBACK_*.
    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/No fallback provider is available/);
    // Exactly one attempt: the primary. Nothing is re-rolled.
    expect(counter.calls()).toBe(1);
  });

  it('keeps the day cached after a failed guard, so the view does not regenerate', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({ contents: [wrongMetricReply(context), wrongMetricReply(context)] });
    installFetch(counter.options);

    const env = { ...LOCAL_ENV, ...FALLBACK_ENV };
    readBriefing(deps({ env }));
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);

    // Further reads the same day are served the computed briefing and open no
    // new request: a failed guard is not retried on every view.
    const first = readBriefing(deps({ env }));
    const second = readBriefing(deps({ env }));
    await awaitBriefingIdle();
    expect(first.kind).toBe('computed');
    expect(second.kind).toBe('computed');
    expect(counter.calls()).toBe(2);
  });

  it('degrades to the computed briefing when the provider refuses, without leaking the key', async () => {
    installFetch({
      chatStatus: 401,
      chatBody: { error: { message: 'invalid api key «redacted:sk-…»' } },
    });

    readBriefing(deps({ env: ANALYST_ENV }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env: ANALYST_ENV }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/HTTP 401/);
    expect(JSON.stringify(view)).not.toContain('«redacted:sk-…»');
  });

  it('degrades to the computed briefing when no engine is configured at all', async () => {
    installFetch();
    readBriefing(deps({ env: envOf({}) }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env: envOf({}) }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/no model is available|not set/);
  });

  it('degrades to the computed briefing when the provider does not answer in time', async () => {
    // A stub that honours the abort signal the way a real fetch does: the
    // configured timeout has to actually bound the call, not just be recorded.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/models')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'local-model-1' }] }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
        );
      });
    }) as unknown as typeof fetch;

    const env = envOf({ ...LOCAL_ENV, BRIEFING_TIMEOUT_MS: '100' });
    readBriefing(deps({ env }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/did not respond within 100 ms/);
  });
});

describe('one briefing per local day', () => {
  it('generates once for the day, and never again when new data lands mid-day', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    readBriefing(deps());
    readBriefing(deps());
    readBriefing(deps());
    await awaitBriefingIdle();
    readBriefing(deps());
    expect(counter.calls()).toBe(1);

    // The dataset moves on — a new observation lands five hours later, still the
    // same local day. The briefing written this morning stays; it describes the
    // last seven days, and none of that changes within a day.
    setActiveDataset(
      {
        ...FIXTURES,
        referenceDate: '2026-09-18T22:00:00.000Z',
        windowEnd: '2026-09-18T22:00:00.000Z',
      },
      { mode: 'demo', dataAsOf: '2026-09-18T22:00:00.000Z' }
    );
    const later = readBriefing(deps({ now: instant('2026-09-18T22:00:00.000Z') }));
    expect(later.cached).toBe(true);
    expect(later.coversDay).toBe('2026-09-18');
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // The next local day, past the hour: a new briefing is written exactly once.
    readBriefing(deps({ now: instant('2026-09-19T07:00:00.000Z') }));
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
  });

  it('keeps the previous day on screen, labelled, until the hour has passed', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const dayOne = deps({ now: instant('2026-09-17T13:00:00.000Z') });
    readBriefing(dayOne);
    await awaitBriefingIdle();
    const writtenDayOne = readBriefing(dayOne);
    expect(writtenDayOne.kind).toBe('model');
    expect(writtenDayOne.coversDay).toBe('2026-09-17');
    expect(counter.calls()).toBe(1);

    // 05:00 the next day: before the briefing hour. Yesterday's briefing is
    // still what is current, it is labelled with its own day, and NO generation
    // is started for the new day.
    const before = readBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(before.coversDay).toBe('2026-09-17');
    expect(before.kind).toBe('model');
    expect(before.headline).toBe(writtenDayOne.headline);
    expect(before.cached).toBe(true);
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // 06:00: the day rolls over and the first request writes today's briefing.
    const rollover = readBriefing(deps({ now: instant('2026-09-18T06:00:00.000Z') }));
    expect(rollover.coversDay).toBe('2026-09-18');
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
    expect(readBriefing(deps({ now: instant('2026-09-18T06:30:00.000Z') })).coversDay).toBe('2026-09-18');
  });

  it('labels the previous day and calls no model before the hour on a cold process', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const view = readBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(view.kind).toBe('computed');
    expect(view.coversDay).toBe('2026-09-17');
    await awaitBriefingIdle();
    // A request before the hour never calls the model.
    expect(counter.calls()).toBe(0);
  });
});

describe('manual regeneration', () => {
  it('replaces the current day once, with new text, and does not loop', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({
      contents: [
        groundedReply(context, '', 'First briefing.'),
        groundedReply(context, '', 'Second briefing.'),
      ],
    });
    installFetch(counter.options);

    readBriefing(deps());
    await awaitBriefingIdle();
    const first = readBriefing(deps());
    expect(first.kind).toBe('model');
    expect(first.headline).toBe('First briefing.');
    expect(counter.calls()).toBe(1);

    const replaced = await regenerateBriefing(deps());
    expect(replaced.kind).toBe('model');
    expect(replaced.headline).toBe('Second briefing.');
    expect(replaced.cached).toBe(false);
    expect(replaced.coversDay).toBe(first.coversDay);
    expect(counter.calls()).toBe(2);

    // Exactly one generation: a later read serves the replacement from cache.
    const after = readBriefing(deps());
    expect(after.headline).toBe('Second briefing.');
    expect(after.cached).toBe(true);
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
  });

  it('reports a failure instead of a briefing when the model cannot be reached', async () => {
    installFetch({ chatFails: true });
    await expect(regenerateBriefing(deps())).rejects.toThrow();
    // The day is left unwritten; the read path then says why it is computed.
    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.reason).toBeTruthy();
  });
});

describe('failure handling', () => {
  it('does not retry a dead provider on every view', async () => {
    const counter = counting({ chatFails: true });
    installFetch(counter.options);

    readBriefing(deps());
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // Inside the cooldown window, asking again must not open another request.
    readBriefing(deps());
    readBriefing(deps());
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);
    expect(BRIEFING_FAILURE_COOLDOWN_MS).toBeGreaterThan(0);

    // The failed attempt is on record, and the hero says why it is computed.
    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.reason).toBeTruthy();
  });
});

describe('the briefing warm-up entry point', () => {
  it('fills the current day once and reports the engine and model', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const outcome = await warmBriefing(deps());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.engine).toBe('local');
      expect(outcome.model).toBe('local-model-1');
    }
    expect(counter.calls()).toBe(1);

    // The request path then serves what the fill stored, with no second call.
    const view = readBriefing(deps());
    expect(view.kind).toBe('model');
    expect(counter.calls()).toBe(1);
  });

  it('does not generate before the briefing hour', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const outcome = await warmBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/before the briefing hour/);
    expect(counter.calls()).toBe(0);
  });

  it('reports the absence of a model as an outcome rather than throwing', async () => {
    installFetch();
    const outcome = await warmBriefing(deps({ env: envOf({}) }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/no model is available|not set/);
  });
});

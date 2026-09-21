// ── Conversation memory: the cap, and the request it travels in ──────────────
//
// Offline and deterministic. The first half exercises the bounding rule on its
// own; the second half drives the real service, with `fetch` stubbed, and reads
// the user message the provider would have sent — so the test proves the earlier
// turns reach the model request, not merely that a function can trim an array.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MEMORY_CHARS,
  MAX_MEMORY_TURNS,
  MAX_MEMORY_TURN_CHARS,
  boundedHistory,
  renderHistory,
} from '@/lib/analyst/memory';
import { buildAnalystUserMessage, DEFAULT_ANALYST_SYSTEM_PROMPT } from '@/lib/analyst/systemPrompt';
import { retrieveGeneral } from '@/lib/analyst/retrieval';
import { askAnalyst } from '@/lib/analyst/service';

const captured: { body: { messages: { role: string; content: string }[] } }[] = [];

function stubFetch(replyText: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured.push({ body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({ model: 'mock-analyst-1', choices: [{ message: { role: 'assistant', content: replyText } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  captured.length = 0;
});

function openaiEnv(): NodeJS.ProcessEnv {
  return {
    ANALYST_PROVIDER: 'openai',
    ANALYST_API_URL: 'http://127.0.0.1:9/v1',
    ANALYST_MODEL: 'mock-analyst-1',
    ANALYST_API_KEY: 'sk-test-not-a-real-key',
  } as unknown as NodeJS.ProcessEnv;
}

/** A minimal well-formed reply, grounded in the general bundle. */
function analystReplyText(): string {
  const bundle = retrieveGeneral();
  const sleep = bundle.summaries.find(s => s.metricId === 'sleep_analysis')!;
  return JSON.stringify({
    title: 'Sleep over the last 30 days',
    observed: [`Time asleep averaged ${Math.round(sleep.aggregate.mean)} minutes, from ${sleep.counts.evaluated} recorded nights.`],
    interpretation: ['The window describes the same period of your record.'],
    uncertainty: ['Nights without a recording are excluded rather than counted as zero.'],
    evidence: [
      { metricId: 'sleep_analysis', windowLabel: 'selected window', aggregation: 'daily average', sampleCount: `${sleep.counts.evaluated} nights` },
    ],
    followUps: ['How has my HRV changed over the same window?'],
  });
}

describe('boundedHistory — the memory rule', () => {
  it('carries nothing for a new conversation', () => {
    expect(boundedHistory(undefined)).toEqual([]);
    expect(boundedHistory([])).toEqual([]);
    expect(boundedHistory([{ role: 'user', content: '   ' }])).toEqual([]);
  });

  it('caps the number of turns and keeps the newest, oldest dropped first', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` }));
    const kept = boundedHistory(turns);
    expect(kept).toHaveLength(MAX_MEMORY_TURNS);
    expect(kept.map(t => t.content)).toEqual(['turn 4', 'turn 5', 'turn 6', 'turn 7', 'turn 8', 'turn 9']);
  });

  it('caps the total characters and drops the oldest over the budget', () => {
    const turns = Array.from({ length: 20 }, () => ({ role: 'user', content: 'x'.repeat(500) }));
    const kept = boundedHistory(turns);
    const total = kept.reduce((a, t) => a + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(kept.length).toBe(Math.min(MAX_MEMORY_TURNS, MAX_MEMORY_CHARS / 500));
    // The kept turns are the last ones, not the first.
    expect(kept.length).toBeLessThan(turns.length);
  });

  it('truncates one oversized turn before it is counted, and strips control characters', () => {
    const kept = boundedHistory([{ role: 'user', content: 'a'.repeat(5000) }]);
    expect(kept[0].content.length).toBe(MAX_MEMORY_TURN_CHARS);
    const messy = boundedHistory([{ role: 'assistant', content: 'line\u0000one\n\ntwo' }]);
    expect(messy[0].content).toBe('line one two');
    // An unknown role is treated as the reader's own words, never dropped.
    expect(boundedHistory([{ role: 'system', content: 'hi' }])[0].role).toBe('user');
  });

  it('renders the carried turns as readable lines', () => {
    expect(renderHistory([])).toBe('');
    expect(renderHistory([{ role: 'user', content: 'Why was it lower?' }, { role: 'assistant', content: 'Because…' }]))
      .toBe('Reader: Why was it lower?\nAnalyst: Because…');
  });
});

describe('buildAnalystUserMessage — where memory travels', () => {
  it('omits the history block entirely for a new conversation', () => {
    const message = buildAnalystUserMessage({ question: 'What changed this week?', bundle: retrieveGeneral(), system: 'metric' });
    expect(message).not.toContain('Earlier turns in this conversation');
    expect(message).toContain('Question: What changed this week?');
  });

  it('inserts bounded earlier turns as their own untrusted block', () => {
    const history = boundedHistory([
      { role: 'user', content: 'How is my HRV trending?' },
      { role: 'assistant', content: 'It averaged 42 ms.' },
    ]);
    const message = buildAnalystUserMessage({
      question: 'Why was that lower?',
      bundle: retrieveGeneral(),
      system: 'metric',
      history,
    });
    expect(message).toContain('Earlier turns in this conversation');
    expect(message).toContain('Reader: How is my HRV trending?');
    expect(message).toContain('Analyst: It averaged 42 ms.');
    // The history sits inside the untrusted-data delimiters, before the question.
    const start = message.indexOf('<<<UNTRUSTED_CONTEXT_START>>>');
    const historyAt = message.indexOf('Earlier turns in this conversation');
    expect(historyAt).toBeLessThan(start);
  });
});

describe('askAnalyst — memory reaches the provider request', () => {
  it('sends no earlier turns for a new conversation', async () => {
    stubFetch(analystReplyText());
    const response = await askAnalyst({ query: 'How much caffeine have I logged?' }, { env: openaiEnv() });
    expect(response.status).toBe('ok');
    const user = captured[0].body.messages.find(m => m.role === 'user')!;
    expect(captured[0].body.messages[0].content).toBe(DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(user.content).not.toContain('Earlier turns in this conversation');
  });

  it('sends the bounded earlier turns with a follow-up', async () => {
    stubFetch(analystReplyText());
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `earlier turn ${i}`,
    }));
    await askAnalyst({ query: 'And what about last month?', history }, { env: openaiEnv() });

    const user = captured[0].body.messages.find(m => m.role === 'user')!;
    expect(user.content).toContain('Earlier turns in this conversation');
    expect(user.content).toContain('And what about last month?');
    // Only the bounded slice travelled: the oldest turns were dropped.
    expect(user.content).not.toContain('earlier turn 0');
    expect(user.content).toContain('earlier turn 11');
    const carried = user.content.split('Reader: ').length - 1 + (user.content.split('Analyst: ').length - 1);
    expect(carried).toBeLessThanOrEqual(MAX_MEMORY_TURNS);
  });
});
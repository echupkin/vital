// ── Conversation rules: titles, ids, provenance, bounded payloads ────────────
//
// Pure functions, so these tests are instant and deterministic. They pin the
// numbers the API, the store and the UI all depend on, and they pin the rule
// that matters most: a stored payload is bounded and carries no series.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_TITLE,
  MAX_STORED_CONTENT_CHARS,
  MAX_STORED_PAYLOAD_CHARS,
  MAX_TITLE_CHARS,
  assistantContent,
  attributionFor,
  buildStoredPayload,
  deriveTitle,
  parseConversationId,
  payloadSize,
  truncatePayload,
  validateTitle,
} from '@/lib/analyst/conversation-rules';
import type { AnalystResponse } from '@/lib/analyst/types';

function baseResponse(overrides: Partial<AnalystResponse> = {}): AnalystResponse {
  return {
    status: 'ok',
    label: 'Demo analyst',
    provider: 'demo',
    providerLabel: 'Demo analyst',
    providerDisplayName: 'Demo analyst',
    model: null,
    providerConfigured: false,
    systemPromptSource: 'built-in',
    misconfiguredReason: null,
    handlerId: 'sleep-1-month',
    answer: {
      id: 'sleep-1-month',
      title: 'Sleep over the last month',
      observed: ['Time asleep averaged 7h 12m across 29 recorded nights.'],
      interpretation: ['The window describes the same period of your record.'],
      uncertainty: ['Nights without a recording are excluded.'],
      evidence: [
        { metricId: 'sleep_analysis', metricName: 'Sleep', windowLabel: 'Last 30 days', aggregation: 'daily average', sampleCount: '29 nights', href: '/metric/sleep_analysis?range=30d' },
      ],
      charts: [{ metricId: 'sleep_analysis', caption: 'Nightly sleep', points: [{ key: '2026-01-01', value: 432 }] }],
      followUps: ['How has my HRV changed over the same window?'],
      boundaryNote: 'Educational information. This does not diagnose and is not medical advice.',
    },
    message: null,
    suggested: ['How has my sleep changed over the last month?'],
    notice: 'Educational information about your own recorded data.',
    retrieval: { recordsRead: 29, note: 'Selected 1 metric summary; 29 records read.', metrics: [{ metricId: 'sleep_analysis', window: 'Last 30 days', observations: 29 }] },
    grounding: { checked: 4, unmatched: [] },
    untrustedNotes: { received: false, characters: 0, note: 'No imported notes were attached to this question.' },
    ...overrides,
  };
}

describe('titles and ids', () => {
  it('derives a title from the opening question', () => {
    expect(deriveTitle('  How has my sleep changed?  ')).toBe('How has my sleep changed?');
    expect(deriveTitle('')).toBe(DEFAULT_TITLE);
    expect(deriveTitle('a'.repeat(500)).length).toBe(MAX_TITLE_CHARS);
    expect(deriveTitle('line\u0000one')).toBe('line one');
  });

  it('validates a supplied title', () => {
    expect(validateTitle('  Recovery  ')).toEqual({ ok: true, value: 'Recovery' });
    expect(validateTitle('')).toMatchObject({ ok: false });
    expect(validateTitle('   ')).toMatchObject({ ok: false });
    expect(validateTitle(7)).toMatchObject({ ok: false });
    expect(validateTitle('x'.repeat(MAX_TITLE_CHARS + 1))).toMatchObject({ ok: false });
  });

  it('accepts only a positive whole id', () => {
    expect(parseConversationId(12)).toBe(12);
    expect(parseConversationId('12')).toBe(12);
    expect(parseConversationId(' 12 ')).toBe(12);
    expect(parseConversationId('abc')).toBeNull();
    expect(parseConversationId('1.5')).toBeNull();
    expect(parseConversationId(-3)).toBeNull();
    expect(parseConversationId(0)).toBeNull();
    expect(parseConversationId({})).toBeNull();
  });
});

describe('provenance', () => {
  it('composes the same line the answer view shows', () => {
    expect(attributionFor(baseResponse())).toBe('Demo analyst · handler sleep-1-month');
    expect(
      attributionFor(baseResponse({ provider: 'openai', providerConfigured: true, providerDisplayName: 'OpenAI-compatible', model: 'gpt-4o-mini', label: 'OpenAI-compatible' }))
    ).toBe('OpenAI-compatible · gpt-4o-mini');
    expect(attributionFor(baseResponse({ status: 'error', answer: null, message: 'Could not be read.' }))).toBe(
      'Demo analyst · error (no model answer)'
    );
  });
});

describe('stored payload', () => {
  it('keeps the evidence and follow-ups and drops the chart series', () => {
    const payload = buildStoredPayload(baseResponse());
    expect(payload.answer?.evidence).toHaveLength(1);
    expect(payload.answer?.followUps).toHaveLength(1);
    expect(payload.retrieval.metrics).toHaveLength(1);
    expect(payload.status).toBe('ok');
    // The chart series (health values) is not part of the stored shape at all.
    expect(Object.keys(payload.answer ?? {})).not.toContain('charts');
    expect(JSON.stringify(payload)).not.toContain('"points"');
    expect(payload.truncated).toBeUndefined();
  });

  it('bounds an oversized payload rather than storing it whole', () => {
    const huge = baseResponse();
    huge.answer = {
      ...huge.answer!,
      observed: Array.from({ length: 200 }, () => 'x'.repeat(1000)),
      interpretation: Array.from({ length: 200 }, () => 'y'.repeat(1000)),
      uncertainty: Array.from({ length: 200 }, () => 'z'.repeat(1000)),
      evidence: Array.from({ length: 100 }, () => ({ metricId: 'sleep_analysis', metricName: 'Sleep', windowLabel: 'Last 30 days', aggregation: 'daily average', sampleCount: '29 nights', href: '/metric/sleep_analysis?range=30d' })),
    };
    const payload = buildStoredPayload(huge);
    expect(payloadSize(payload)).toBeLessThanOrEqual(MAX_STORED_PAYLOAD_CHARS);
    expect(payload.truncated).toBe(true);
    // Trimming never invents content: what remains is a prefix of what was there.
    expect(payload.answer?.observed.every(line => line.startsWith('x'))).toBe(true);
  });

  it('is idempotent: a payload already within the cap is returned unchanged', () => {
    const small = buildStoredPayload(baseResponse());
    expect(payloadSize(truncatePayload(small))).toBe(payloadSize(small));
    expect(truncatePayload(small).truncated).toBeUndefined();
  });
});

describe('assistant content', () => {
  it('renders the answer the reader saw', () => {
    const content = assistantContent(baseResponse());
    expect(content).toContain('Sleep over the last month');
    expect(content).toContain('Observed measurements:');
    expect(content).toContain('- Time asleep averaged 7h 12m across 29 recorded nights.');
  });

  it('falls back to the honest message, and never to an empty row', () => {
    const content = assistantContent(baseResponse({ answer: null, message: 'No provider is configured.', status: 'unsupported' }));
    expect(content).toBe('No provider is configured.');
    expect(assistantContent(baseResponse({ answer: null, message: null, status: 'error' }))).toBe('The analyst did not produce an answer.');
    expect(content.length).toBeLessThanOrEqual(MAX_STORED_CONTENT_CHARS);
  });
});

describe('the migration that ships these tables', () => {
  const sql = readFileSync(join(process.cwd(), 'db', 'migrations', '0003-analyst-conversations.sql'), 'utf8');

  it('declares both tables, the cascade and the two query indexes', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS analyst_conversations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS analyst_messages/);
    expect(sql).toMatch(/REFERENCES analyst_conversations \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/ON analyst_conversations \(updated_at DESC, id DESC\)/);
    expect(sql).toMatch(/ON analyst_messages \(conversation_id, created_at, id\)/);
  });

  it('has no column for a health value', () => {
    // The record fields are text, timestamps and a JSONB evidence blob; a health
    // value would need a numeric column, and the schema has none.
    expect(sql).not.toMatch(/\b(numeric|real|double precision|smallint|decimal)\b/i);
    expect(sql).toMatch(/no health data/i);
  });
});
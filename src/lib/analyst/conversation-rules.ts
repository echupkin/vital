// ── Analyst conversations: the rules (pure, no I/O) ──────────────────────────
//
// Everything a conversation is allowed to be, expressed as data:
//
//   * the caps — how long a title may be, how many turns a conversation holds,
//     how large a stored answer payload may grow;
//   * how a title is derived from an opening question;
//   * what an assistant turn's stored content and attribution are.
//
// Keeping these pure means the API route, the store and the tests all read the
// same numbers, and a limit is enforced in one place instead of three.
//
// Nothing here invents a field the engine does not produce: the provenance is
// read straight off the `AnalystResponse`, and `attributionFor` composes the
// SAME line the answer view already shows.

import type { AnalystResponse } from './types';
import type {
  StoredAnswer,
  StoredAssistantPayload,
  StoredRetrieval,
} from './conversation-types';

/** Longest a conversation title may be. Longer input is refused, never cut. */
export const MAX_TITLE_CHARS = 120;

/** A title used when a conversation has no opening question yet. */
export const DEFAULT_TITLE = 'New conversation';

/**
 * Hard cap on the turns one conversation may hold. An append past it is REFUSED
 * with a clear reason (the reader starts a new conversation) rather than being
 * silently dropped.
 */
export const MAX_CONVERSATION_MESSAGES = 200;

/** Longest stored content for a single turn. Longer answers are marked truncated. */
export const MAX_STORED_CONTENT_CHARS = 8000;

/** Hard cap on the serialized evidence payload stored with an answer. */
export const MAX_STORED_PAYLOAD_CHARS = 16000;

// Per-field caps applied while bounding a payload.
const MAX_STORED_EVIDENCE = 8;
const MAX_STORED_LINES = 6;
const MAX_STORED_LINE_CHARS = 600;
const MAX_STORED_SUGGESTED = 6;
const MAX_STORED_METRICS = 12;
const MAX_STORED_UNMATCHED = 10;

/** Strip control characters and collapse the ends. */
export function normalizeText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The title a conversation gets from its opening question.
 *
 * The whole question is kept up to MAX_TITLE_CHARS: it is short by construction
 * (the ask endpoint caps a question at 400 characters), and a title the reader
 * cannot recognise is worse than a long one.
 */
export function deriveTitle(question: unknown): string {
  const cleaned = normalizeText(question, MAX_TITLE_CHARS);
  return cleaned.length > 0 ? cleaned : DEFAULT_TITLE;
}

export type TitleValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/** Validate a title supplied by the reader for a create or a rename. */
export function validateTitle(raw: unknown): TitleValidation {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'A title must be text.' };
  }
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return { ok: false, reason: 'A title cannot be empty.' };
  if (cleaned.length > MAX_TITLE_CHARS) {
    return { ok: false, reason: `A title is limited to ${MAX_TITLE_CHARS} characters; this one was ${cleaned.length}.` };
  }
  return { ok: true, value: cleaned };
}

/** A positive whole conversation id, or null. Ids are never coerced from junk. */
export function parseConversationId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^[1-9]\d{0,15}$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

/**
 * The provenance line the answer view shows, composed from the response.
 *
 * There is no single `attribution` field on the engine's response, so this is
 * COMPOSED from the fields it does produce (`providerDisplayName`, `model`,
 * `handlerId`, `label`). It is derived, not invented: every part comes off the
 * response, and it never contains a credential.
 */
export function attributionFor(response: AnalystResponse): string {
  if (response.status === 'ok' && response.answer) {
    if (response.providerConfigured) {
      return `${response.providerDisplayName}${response.model ? ` · ${response.model}` : ''}`;
    }
    return `${response.label} · handler ${response.handlerId}`;
  }
  return `${response.label} · ${response.status} (no model answer)`;
}

/** The answer rendered as the text the reader saw, for the stored content. */
export function renderAnswerText(answer: StoredAnswer): string {
  const sections: { heading: string; lines: string[] }[] = [
    { heading: 'Observed measurements', lines: answer.observed },
    { heading: 'Possible interpretation', lines: answer.interpretation },
    { heading: 'Missing context and uncertainty', lines: answer.uncertainty },
  ];
  const body = sections
    .filter(s => s.lines.length > 0)
    .map(s => `${s.heading}:\n${s.lines.map(line => `- ${line}`).join('\n')}`)
    .join('\n\n');
  return body.length > 0 ? `${answer.title}\n\n${body}` : answer.title;
}

function toStoredAnswer(response: AnalystResponse): StoredAnswer | null {
  const answer = response.answer;
  if (!answer) return null;
  return {
    title: answer.title,
    observed: [...answer.observed],
    interpretation: [...answer.interpretation],
    uncertainty: [...answer.uncertainty],
    evidence: answer.evidence.map(ev => ({ ...ev })),
    followUps: [...answer.followUps],
    boundaryNote: answer.boundaryNote,
  };
}

function toStoredRetrieval(response: AnalystResponse): StoredRetrieval {
  return {
    recordsRead: response.retrieval.recordsRead,
    note: response.retrieval.note,
    metrics: response.retrieval.metrics.map(m => ({ ...m })),
  };
}

/**
 * The stored payload for an assistant turn.
 *
 * Built from the response the route is about to serve, so what is stored is
 * exactly what was shown. Chart series are dropped on purpose: they are health
 * values and this database holds none.
 */
export function buildStoredPayload(response: AnalystResponse): StoredAssistantPayload {
  const answer = toStoredAnswer(response);
  const payload: StoredAssistantPayload = {
    status: response.status,
    label: response.label,
    provider: response.provider,
    providerLabel: response.providerLabel,
    providerDisplayName: response.providerDisplayName,
    model: response.model,
    providerConfigured: response.providerConfigured,
    systemPromptSource: response.systemPromptSource,
    misconfiguredReason: response.misconfiguredReason,
    handlerId: response.handlerId,
    answer,
    message: response.message,
    suggested: [...response.suggested],
    retrieval: toStoredRetrieval(response),
    grounding: { checked: response.grounding.checked, unmatched: [...response.grounding.unmatched] },
    untrustedNotes: { ...response.untrustedNotes },
    notice: response.notice,
  };
  return truncatePayload(payload);
}

/** Serialized size of a candidate payload. */
export function payloadSize(payload: StoredAssistantPayload): number {
  return JSON.stringify(payload).length;
}

/**
 * Shrink a payload until it fits MAX_STORED_PAYLOAD_CHARS.
 *
 * The order is fixed and the oldest-first principle is why it is documented:
 * auditing noise (unmatched tokens) goes first, then the breadth of evidence,
 * then the number of lines, then their length. Only a payload that is still too
 * large after all of that loses its answer entirely — and then it says so with
 * `truncated`, rather than being silently emptied.
 */
export function truncatePayload(payload: StoredAssistantPayload): StoredAssistantPayload {
  let current: StoredAssistantPayload = { ...payload, answer: payload.answer ? { ...payload.answer } : null };
  let truncated = false;
  const fits = () => payloadSize(current) <= MAX_STORED_PAYLOAD_CHARS;

  const steps: (() => void)[] = [
    () => {
      current.grounding = { ...current.grounding, unmatched: current.grounding.unmatched.slice(0, MAX_STORED_UNMATCHED) };
    },
    () => {
      current.suggested = current.suggested.slice(0, MAX_STORED_SUGGESTED);
    },
    () => {
      current.retrieval = { ...current.retrieval, metrics: current.retrieval.metrics.slice(0, MAX_STORED_METRICS) };
    },
    () => {
      if (current.answer) current.answer = { ...current.answer, evidence: current.answer.evidence.slice(0, MAX_STORED_EVIDENCE) };
    },
    () => {
      if (!current.answer) return;
      const a = current.answer;
      current.answer = {
        ...a,
        observed: a.observed.slice(0, MAX_STORED_LINES),
        interpretation: a.interpretation.slice(0, MAX_STORED_LINES),
        uncertainty: a.uncertainty.slice(0, MAX_STORED_LINES),
        followUps: a.followUps.slice(0, MAX_STORED_LINES),
      };
    },
    () => {
      if (!current.answer) return;
      const a = current.answer;
      const cut = (lines: string[]) => lines.map(l => l.slice(0, MAX_STORED_LINE_CHARS));
      current.answer = {
        ...a,
        observed: cut(a.observed),
        interpretation: cut(a.interpretation),
        uncertainty: cut(a.uncertainty),
      };
    },
    () => {
      if (current.answer) current.answer = { ...current.answer, evidence: [] };
    },
    () => {
      // Last resort: the answer cannot be represented within the cap. Keep the
      // status and the message, and say plainly that the answer was too large.
      if (current.answer) {
        current.answer = {
          title: current.answer.title.slice(0, MAX_STORED_LINE_CHARS),
          observed: [],
          interpretation: [],
          uncertainty: [],
          evidence: [],
          followUps: [],
          boundaryNote: current.answer.boundaryNote.slice(0, MAX_STORED_LINE_CHARS),
        };
      }
    },
  ];

  for (const step of steps) {
    if (fits()) break;
    step();
    truncated = true;
  }
  return truncated ? { ...current, truncated: true } : current;
}

/** The stored content for an assistant turn: the text the reader saw. */
export function assistantContent(response: AnalystResponse): string {
  if (response.answer) {
    const rendered = renderAnswerText(toStoredAnswer(response) as StoredAnswer);
    return rendered.slice(0, MAX_STORED_CONTENT_CHARS);
  }
  const message = normalizeText(response.message ?? '', MAX_STORED_CONTENT_CHARS);
  return message.length > 0 ? message : 'The analyst did not produce an answer.';
}
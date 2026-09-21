// ── Conversation view helpers (client-safe) ─────────────
//
// Turning stored turns back into what the analyst renders — including the
// evidence cards and follow-up suggestions that were shown originally.
//
// A stored assistant turn carries a bounded payload (see db/migrations/0003).
// The one thing it deliberately does NOT carry is the answer's chart series:
// those are health values, so a reloaded answer shows its sections, evidence and
// follow-ups without the sparkline. That is why `charts` is reconstructed as an
// empty array here rather than being read from the payload.

import type { AnalystAnswer, AnalystResponse } from '@/lib/analyst/types';
import type { ConversationMessage, StoredAssistantPayload } from '@/lib/analyst/conversation-types';

/** One question and the answer that belongs to it, as the page renders them. */
export interface ConversationExchange {
  /** The stored message id, or a negative id for a turn that is still pending. */
  id: number;
  question: string;
  response: AnalystResponse | null;
  pending: boolean;
  failed: string | null;
}

/** An answer's sections and evidence, with the chart series left out. */
export function answerFromStoredPayload(payload: StoredAssistantPayload): AnalystAnswer | null {
  if (!payload.answer) return null;
  return {
    id: payload.handlerId,
    title: payload.answer.title,
    observed: payload.answer.observed,
    interpretation: payload.answer.interpretation,
    uncertainty: payload.answer.uncertainty,
    evidence: payload.answer.evidence,
    // Not persisted: chart points are health values. The answer still renders.
    charts: [],
    followUps: payload.answer.followUps,
    boundaryNote: payload.answer.boundaryNote,
  };
}

/** Rebuild the response shape the answer view renders from a stored turn. */
export function responseFromMessage(message: ConversationMessage): AnalystResponse | null {
  if (message.role !== 'assistant' || !message.payload) return null;
  const payload = message.payload;
  return {
    status: payload.status,
    label: payload.label,
    provider: payload.provider as AnalystResponse['provider'],
    providerLabel: payload.providerLabel,
    providerDisplayName: payload.providerDisplayName,
    model: payload.model,
    providerConfigured: payload.providerConfigured,
    systemPromptSource: payload.systemPromptSource,
    misconfiguredReason: payload.misconfiguredReason,
    handlerId: payload.handlerId,
    answer: answerFromStoredPayload(payload),
    message: payload.message,
    suggested: payload.suggested,
    notice: payload.notice,
    retrieval: payload.retrieval,
    grounding: payload.grounding,
    untrustedNotes: payload.untrustedNotes,
  };
}

/**
 * A stored thread as a list of exchanges, oldest first.
 *
 * A question opens an exchange; the assistant turn that follows it answers it.
 * An assistant turn with no question before it (never written by this app, but
 * possible from a hand-edited row) is shown as its own exchange with an empty
 * question rather than being dropped.
 */
export function exchangesFromMessages(messages: readonly ConversationMessage[]): ConversationExchange[] {
  const exchanges: ConversationExchange[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      exchanges.push({ id: message.id, question: message.content, response: null, pending: false, failed: null });
      continue;
    }
    const response = responseFromMessage(message);
    const last = exchanges[exchanges.length - 1];
    if (last && last.response === null && !last.pending) {
      last.response = response;
      continue;
    }
    exchanges.push({ id: message.id, question: '', response, pending: false, failed: null });
  }
  return exchanges;
}
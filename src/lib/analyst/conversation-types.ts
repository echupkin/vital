// ── Analyst conversations: shared types ──────────────────────────────────────
//
// The shapes the browser and the server agree on. Deliberately free of any
// server import: the conversation selector and the routes both use them, and
// nothing here carries a credential, a database address or a health value.
//
// A conversation is a title and a list of turns. A turn is the TEXT the reader
// saw — a question, or an answer rendered as text — plus, for an answer, the
// bounded evidence payload and the provenance that produced it.

import type { AnalystAnswer, AnalystEvidence, AnalystStatus } from './types';

export type ConversationRole = 'user' | 'assistant';

/** One conversation in the list: identity and activity, no turns. */
export interface ConversationSummary {
  id: number;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The bounded evidence an assistant turn was answered from.
 *
 * This is the renderable subset of `AnalystResponse`: everything the answer
 * view shows EXCEPT the chart series. Chart points are health values, so they
 * are not persisted (see db/migrations/0003); a reloaded answer shows its
 * evidence cards and follow-up questions but not its sparkline.
 */
export interface StoredAnswer {
  title: string;
  observed: string[];
  interpretation: string[];
  uncertainty: string[];
  evidence: AnalystEvidence[];
  followUps: string[];
  boundaryNote: string;
}

export interface StoredRetrieval {
  recordsRead: number;
  note: string;
  metrics: { metricId: string; window: string; observations: number }[];
}

export interface StoredGrounding {
  checked: number;
  unmatched: string[];
}

export interface StoredUntrustedNotes {
  received: boolean;
  characters: number;
  note: string;
}

export interface StoredAssistantPayload {
  status: AnalystStatus;
  label: string;
  provider: string;
  providerLabel: string;
  providerDisplayName: string;
  model: string | null;
  providerConfigured: boolean;
  systemPromptSource: 'built-in' | 'custom';
  misconfiguredReason: string | null;
  handlerId: string;
  answer: StoredAnswer | null;
  message: string | null;
  suggested: string[];
  retrieval: StoredRetrieval;
  grounding: StoredGrounding;
  untrustedNotes: StoredUntrustedNotes;
  notice: string;
  /** True when the stored payload was cut to fit the size cap. */
  truncated?: boolean;
}

/** One turn, as the API serves it. */
export interface ConversationMessage {
  id: number;
  role: ConversationRole;
  /** The text the reader saw. */
  content: string;
  /** The answer title, when the turn is an answer. */
  title: string | null;
  status: AnalystStatus | null;
  provider: string | null;
  model: string | null;
  /** The provenance line the UI shows. Never a credential. */
  attribution: string | null;
  handlerId: string | null;
  payload: StoredAssistantPayload | null;
  createdAt: string;
}

/** A conversation with its turns, in the order they were said. */
export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

/** Whether conversations are being saved, and why not when they are not. */
export interface ConversationAvailability {
  /** True when a database is configured and the conversations are persisted. */
  available: boolean;
  /** Where they are stored: `postgres`, or `memory` when nothing is. */
  backend: 'postgres' | 'memory';
  /** The honest explanation shown when `available` is false. Null otherwise. */
  reason: string | null;
}

/** The answer view's input, reconstructed from a stored assistant turn. */
export type RehydratedAnswer = StoredAnswer;
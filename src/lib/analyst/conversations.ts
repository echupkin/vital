// ── Analyst conversations: the service (SERVER ONLY) ─────────────────────────
//
// The single place that answers "can conversations be saved, and if so do this".
// The API routes call these functions and turn their results into responses;
// nothing else reaches the store directly.
//
// Two behaviours worth stating plainly:
//
//   * NO DATABASE — the analyst keeps working. A question is still answered, in
//     memory, and every result says `available: false` with the reason, so the
//     UI can say honestly that the conversation is not being saved instead of
//     pretending it is. Nothing is faked.
//
//   * A REFUSAL IS NOT A SILENT DROP — a question past the conversation's turn
//     cap is refused with the reason (409), a title past its cap is refused
//     (400), and an unknown conversation is a 404. Each is a different answer.
//
// Validation and caps come from `conversation-rules` so the numbers live in one
// place. Nothing here logs or returns a credential: the row shapes have none.

import { resolveBackend } from '@/lib/db/backend';
import {
  countMessages,
  deleteConversationRow,
  findConversation,
  insertConversation,
  insertMessage,
  listConversations,
  listMessages,
  listRecentMessages,
  renameConversationRow,
  storeClient,
  type SqlClient,
} from '@/lib/db/analyst-store';
import {
  DEFAULT_TITLE,
  MAX_CONVERSATION_MESSAGES,
  assistantContent,
  attributionFor,
  buildStoredPayload,
  deriveTitle,
  parseConversationId,
  validateTitle,
} from './conversation-rules';
import { MAX_MEMORY_TURNS, boundedHistory, type ChatTurn } from './memory';
import type { AnalystResponse } from './types';
import type {
  ConversationAvailability,
  ConversationDetail,
  ConversationSummary,
} from './conversation-types';

/** Why conversations are not being saved when nothing is configured. */
export const NO_DATABASE_REASON =
  'No Postgres database is configured, so conversations are not saved. This conversation lives in this browser tab only and will not survive a refresh. Configure DATABASE_URL or the VITAL_PG_* variables to save them.';

/**
 * Injected dependencies. `client` is how the offline tests drive these
 * functions: passing `client: null` means "pretend no database is configured",
 * passing a fake means "here is the database".
 */
export interface ConversationDeps {
  env?: NodeJS.ProcessEnv;
  client?: SqlClient | null;
}

interface Resolved {
  availability: ConversationAvailability;
  client: SqlClient | null;
}

/**
 * Resolve whether conversations can be saved, and the client to use.
 *
 * The injected client wins when present, so a test never touches `process.env`.
 * Otherwise the SAME backend resolution the rest of the app uses decides — this
 * never opens a second connection path.
 */
export function resolveConversations(deps: ConversationDeps = {}): Resolved {
  if ('client' in deps) {
    return deps.client
      ? { availability: { available: true, backend: 'postgres', reason: null }, client: deps.client }
      : {
          availability: { available: false, backend: 'memory', reason: NO_DATABASE_REASON },
          client: null,
        };
  }

  const env = deps.env ?? process.env;
  try {
    const backend = resolveBackend(env);
    if (backend.kind === 'files') {
      return { availability: { available: false, backend: 'memory', reason: NO_DATABASE_REASON }, client: null };
    }
    const client = storeClient(env);
    if (!client) {
      return { availability: { available: false, backend: 'memory', reason: NO_DATABASE_REASON }, client: null };
    }
    return { availability: { available: true, backend: 'postgres', reason: null }, client };
  } catch (error) {
    return {
      availability: {
        available: false,
        backend: 'memory',
        reason: `The Postgres configuration is invalid, so conversations are not saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      client: null,
    };
  }
}

export type ConversationResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; availability: ConversationAvailability };

/** How many turns the next exchange needs room for. */
const EXCHANGE_TURNS = 2;

/** List the conversations, newest activity first. Never fails when unconfigured. */
export async function listConversationsForApi(
  deps: ConversationDeps = {}
): Promise<
  { ok: true; status: number; availability: ConversationAvailability; conversations: ConversationSummary[] } | {
    ok: false; status: number; error: string; availability: ConversationAvailability;
  }
> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    // Not an error: the analyst works in memory and the UI is told the truth.
    return { ok: true, status: 200, availability, conversations: [] };
  }
  try {
    return { ok: true, status: 200, availability, conversations: await listConversations(client) };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversations could not be read.'), availability };
  }
}

/** Create a conversation. The title is optional; the default is used without one. */
export async function createConversationForApi(
  deps: ConversationDeps,
  rawTitle: unknown
): Promise<ConversationResult<ConversationSummary>> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    return { ok: false, status: 503, error: availability.reason ?? NO_DATABASE_REASON, availability };
  }
  let title = DEFAULT_TITLE;
  if (rawTitle !== undefined && rawTitle !== null && rawTitle !== '') {
    const validated = validateTitle(rawTitle);
    if (!validated.ok) return { ok: false, status: 400, error: validated.reason, availability };
    title = validated.value;
  }
  try {
    return { ok: true, status: 201, data: await insertConversation(client, title) };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversation could not be created.'), availability };
  }
}

/** Fetch one conversation with its turns. */
export async function readConversationForApi(
  deps: ConversationDeps,
  rawId: unknown
): Promise<ConversationResult<ConversationDetail>> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    return { ok: false, status: 503, error: availability.reason ?? NO_DATABASE_REASON, availability };
  }
  const id = parseConversationId(rawId);
  if (id === null) return { ok: false, status: 400, error: 'A conversation id must be a positive whole number.', availability };
  try {
    const conversation = await findConversation(client, id);
    if (!conversation) {
      return { ok: false, status: 404, error: `There is no conversation with id ${id}.`, availability };
    }
    const messages = await listMessages(client, id);
    return { ok: true, status: 200, data: { ...conversation, messages } };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversation could not be read.'), availability };
  }
}

/** Rename a conversation. */
export async function renameConversationForApi(
  deps: ConversationDeps,
  rawId: unknown,
  rawTitle: unknown
): Promise<ConversationResult<ConversationSummary>> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    return { ok: false, status: 503, error: availability.reason ?? NO_DATABASE_REASON, availability };
  }
  const id = parseConversationId(rawId);
  if (id === null) return { ok: false, status: 400, error: 'A conversation id must be a positive whole number.', availability };
  const validated = validateTitle(rawTitle);
  if (!validated.ok) return { ok: false, status: 400, error: validated.reason, availability };
  try {
    const updated = await renameConversationRow(client, id, validated.value);
    if (!updated) return { ok: false, status: 404, error: `There is no conversation with id ${id}.`, availability };
    return { ok: true, status: 200, data: updated };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversation could not be renamed.'), availability };
  }
}

/** Delete a conversation. Its messages go with it (ON DELETE CASCADE). */
export async function deleteConversationForApi(
  deps: ConversationDeps,
  rawId: unknown
): Promise<ConversationResult<{ id: number }>> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    return { ok: false, status: 503, error: availability.reason ?? NO_DATABASE_REASON, availability };
  }
  const id = parseConversationId(rawId);
  if (id === null) return { ok: false, status: 400, error: 'A conversation id must be a positive whole number.', availability };
  try {
    const deleted = await deleteConversationRow(client, id);
    if (!deleted) return { ok: false, status: 404, error: `There is no conversation with id ${id}.`, availability };
    return { ok: true, status: 200, data: { id } };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversation could not be deleted.'), availability };
  }
}

/**
 * The earlier turns of a conversation, for the memory block.
 *
 * Only the newest turns are loaded (MAX_MEMORY_TURNS * 2, enough for six bounded
 * turns even if every other one is dropped) and they are bounded again by
 * `boundedHistory` in the service. A conversation that does not exist, or a
 * deployment with no database, yields no turns — a new conversation starts
 * with none.
 */
export async function memoryTurnsFor(
  deps: ConversationDeps,
  rawConversationId: unknown
): Promise<ChatTurn[]> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) return [];
  const id = parseConversationId(rawConversationId);
  if (id === null) return [];
  try {
    const messages = await listRecentMessages(client, id, MAX_MEMORY_TURNS * 2);
    return boundedHistory(messages.map(m => ({ role: m.role, content: m.content })));
  } catch {
    // A memory read that fails must not lose the question: answer without it.
    return [];
  }
}

export interface ExchangeOutcome {
  /** True when both turns were written. */
  persisted: boolean;
  /** Why not, when `persisted` is false and the analyst still answered. */
  reason: string | null;
  /** The conversation the exchange belongs to, when one was involved. */
  conversation: ConversationSummary | null;
}

export type AppendExchangeResult =
  | { ok: true; status: number; outcome: ExchangeOutcome }
  | { ok: false; status: number; error: string; availability: ConversationAvailability };

/**
 * Persist one exchange: the question, then the answer that was actually shown.
 *
 * Rules enforced here:
 *   * an answer is stored whenever it was shown — including the honest
 *     explanation shown when the model was unavailable — and NOT stored at all
 *     when there was nothing to show. A reply the guard discarded never reaches
 *     the store because the service never returned it;
 *   * the assistant turn's content is the text the reader saw and its
 *     attribution is the same provenance line the UI shows;
 *   * the per-conversation cap refuses the exchange with a clear reason (409)
 *     rather than silently truncating the thread.
 */
export async function appendExchange(
  deps: ConversationDeps,
  rawConversationId: unknown,
  question: string,
  response: AnalystResponse
): Promise<AppendExchangeResult> {
  const { availability, client } = resolveConversations(deps);
  if (!availability.available || !client) {
    // The analyst still answers; the result says honestly that it was not saved.
    return { ok: true, status: 200, outcome: { persisted: false, reason: availability.reason ?? NO_DATABASE_REASON, conversation: null } };
  }

  try {
    let conversation: ConversationSummary | null;
    if (rawConversationId === undefined || rawConversationId === null || rawConversationId === '') {
      conversation = await insertConversation(client, deriveTitle(question));
    } else {
      const id = parseConversationId(rawConversationId);
      if (id === null) {
        return { ok: false, status: 400, error: 'A conversation id must be a positive whole number.', availability };
      }
      conversation = await findConversation(client, id);
      if (!conversation) {
        return { ok: false, status: 404, error: `There is no conversation with id ${id}.`, availability };
      }
    }

    // Room for the whole exchange, or refuse before writing half of it.
    const existing = await countMessages(client, conversation.id);
    if (existing + EXCHANGE_TURNS > MAX_CONVERSATION_MESSAGES) {
      return {
        ok: false,
        status: 409,
        error: `This conversation has reached its ${MAX_CONVERSATION_MESSAGES}-turn limit. Start a new conversation to keep asking.`,
        availability,
      };
    }

    // The opening question names the conversation unless it was renamed. A
    // conversation that still carries the default title has not been renamed.
    if (conversation.messageCount === 0 && conversation.title === DEFAULT_TITLE) {
      const retitled = await renameConversationRow(client, conversation.id, deriveTitle(question));
      if (retitled) conversation = retitled;
    }

    const userTurn = await insertMessage(client, conversation.id, { role: 'user', content: question }, MAX_CONVERSATION_MESSAGES);
    if (!userTurn.ok) return refusal(userTurn.reason, availability);

    const assistantTurn = await insertMessage(
      client,
      conversation.id,
      {
        role: 'assistant',
        content: assistantContent(response),
        title: response.answer ? response.answer.title : null,
        status: response.status,
        provider: response.provider,
        model: response.model,
        attribution: attributionFor(response),
        handlerId: response.handlerId,
        payload: buildStoredPayload(response),
      },
      MAX_CONVERSATION_MESSAGES
    );
    if (!assistantTurn.ok) return refusal(assistantTurn.reason, availability);

    const updated = (await findConversation(client, conversation.id)) ?? conversation;
    return { ok: true, status: 200, outcome: { persisted: true, reason: null, conversation: updated } };
  } catch (error) {
    return { ok: false, status: 500, error: messageOf(error, 'The conversation could not be saved.'), availability };
  }
}

function refusal(reason: 'conversation_missing' | 'cap_reached', availability: ConversationAvailability): AppendExchangeResult {
  if (reason === 'cap_reached') {
    return {
      ok: false,
      status: 409,
      error: `This conversation has reached its ${MAX_CONVERSATION_MESSAGES}-turn limit. Start a new conversation to keep asking.`,
      availability,
    };
  }
  return { ok: false, status: 404, error: 'That conversation no longer exists.', availability };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
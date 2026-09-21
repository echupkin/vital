// ── Analyst conversation store: Postgres (SERVER ONLY) ───────────────────────
//
// The database half of the conversation store. Every function takes its `client`
// as a parameter — the pool in production, an injected fake in the offline
// tests — so the SQL and the row mapping can be exercised without a live
// database (see analyst-store.test.ts).
//
// CONFIGURATION AND PROVENANCE ONLY. There is no column here for a health value
// and no query selects one: a message holds the text the reader saw and the
// bounded evidence payload it was answered from (see db/migrations/0003). Chart
// series are never written.
//
// The per-conversation turn cap is enforced IN THE SQL: the INSERT only takes a
// row while the conversation holds fewer than the cap, so a concurrent append
// cannot slip past a check made in a previous round-trip. A refusal is reported
// with its reason, never silently dropped.

import type { ConversationMessage, ConversationSummary, StoredAssistantPayload } from '@/lib/analyst/conversation-types';
import { getPool, type PoolLike } from './pool';

/** A connection (or pool) that can run one query. */
export type SqlClient = PoolLike;

/** The version of the APPLICATION RECORD SHAPE stored in these tables. */
export const ANALYST_CONVERSATION_SCHEMA_VERSION = 1;

const CONVERSATION_COLUMNS = 'id, title, message_count, created_at, updated_at';

const INSERT_CONVERSATION = `
  INSERT INTO analyst_conversations (title, message_count, schema_version)
  VALUES ($1, 0, $2)
  RETURNING ${CONVERSATION_COLUMNS}
`;

const SELECT_CONVERSATIONS = `
  SELECT ${CONVERSATION_COLUMNS}
    FROM analyst_conversations
   WHERE archived_at IS NULL
   ORDER BY updated_at DESC, id DESC
   LIMIT $1
`;

const SELECT_CONVERSATION = `
  SELECT ${CONVERSATION_COLUMNS}
    FROM analyst_conversations
   WHERE id = $1
`;

const SELECT_MESSAGES = `
  SELECT id, role, content, title, status, provider, model, attribution, handler_id, payload, created_at
    FROM analyst_messages
   WHERE conversation_id = $1
   ORDER BY created_at ASC, id ASC
`;

const COUNT_MESSAGES = `SELECT count(*)::int AS count FROM analyst_messages WHERE conversation_id = $1`;

const SELECT_RECENT_MESSAGES = `
  SELECT * FROM (
    SELECT id, role, content, title, status, provider, model, attribution, handler_id, payload, created_at
      FROM analyst_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2
  ) recent
  ORDER BY created_at ASC, id ASC
`;

/**
 * Insert one turn, but only while the conversation exists and holds fewer than
 * the cap. `$12` is the cap; the guard runs in the same statement as the insert,
 * so two appends cannot both look under the limit and then both write.
 *
 * `message_count` is advanced from the conversation's own counter rather than
 * re-counted, because the rows inserted by this statement are not visible to the
 * statement's own snapshot.
 */
const INSERT_MESSAGE = `
  WITH inserted AS (
    INSERT INTO analyst_messages
      (conversation_id, role, content, title, status, provider, model, attribution, handler_id, payload, schema_version)
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11
     WHERE EXISTS (SELECT 1 FROM analyst_conversations WHERE id = $1)
       AND (SELECT count(*) FROM analyst_messages WHERE conversation_id = $1) < $12
    RETURNING id, conversation_id, role, content, title, status, provider, model, attribution, handler_id, payload, created_at
  ), bumped AS (
    UPDATE analyst_conversations c
       SET message_count = c.message_count + 1,
           updated_at    = now(),
           revision      = c.revision + 1
     WHERE c.id = $1 AND EXISTS (SELECT 1 FROM inserted)
    RETURNING c.id
  )
  SELECT * FROM inserted
`;

const RENAME_CONVERSATION = `
  UPDATE analyst_conversations
     SET title    = $2,
         revision = revision + 1
   WHERE id = $1
  RETURNING ${CONVERSATION_COLUMNS}
`;

const DELETE_CONVERSATION = `DELETE FROM analyst_conversations WHERE id = $1 RETURNING id`;

/** A timestamp column as an ISO string, whether it arrived as a Date or text. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a JSONB column that may arrive as an object (pg) or a string (a fake). */
function jsonOrNull(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** A database row → the summary the API serves. Never throws. */
export function toConversationSummary(row: Record<string, unknown>): ConversationSummary {
  return {
    id: numberOrZero(row.id),
    title: typeof row.title === 'string' && row.title.trim().length > 0 ? row.title : 'Untitled conversation',
    messageCount: numberOrZero(row.message_count),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** A database row → the message the API serves. Never throws. */
export function toConversationMessage(row: Record<string, unknown>): ConversationMessage {
  const role = row.role === 'assistant' ? 'assistant' : 'user';
  const parsed = jsonOrNull(row.payload);
  return {
    id: numberOrZero(row.id),
    role,
    content: typeof row.content === 'string' ? row.content : '',
    title: typeof row.title === 'string' ? row.title : null,
    status: typeof row.status === 'string' ? (row.status as ConversationMessage['status']) : null,
    provider: typeof row.provider === 'string' ? row.provider : null,
    model: typeof row.model === 'string' ? row.model : null,
    attribution: typeof row.attribution === 'string' ? row.attribution : null,
    handlerId: typeof row.handler_id === 'string' ? row.handler_id : null,
    payload: parsed && typeof parsed === 'object' ? (parsed as StoredAssistantPayload) : null,
    createdAt: iso(row.created_at),
  };
}

/** Create a conversation with a title. Returns the stored summary. */
export async function insertConversation(client: SqlClient, title: string): Promise<ConversationSummary> {
  const result = await client.query(INSERT_CONVERSATION, [title, ANALYST_CONVERSATION_SCHEMA_VERSION]);
  const row = result.rows[0];
  if (!row) throw new Error('The conversation insert returned no row.');
  return toConversationSummary(row);
}

/** Live conversations, most recently active first. */
export async function listConversations(client: SqlClient, limit = 100): Promise<ConversationSummary[]> {
  const result = await client.query(SELECT_CONVERSATIONS, [limit]);
  return result.rows.map(toConversationSummary);
}

/** One conversation, or null when there is no such row. */
export async function findConversation(client: SqlClient, id: number): Promise<ConversationSummary | null> {
  const result = await client.query(SELECT_CONVERSATION, [id]);
  const row = result.rows[0];
  return row ? toConversationSummary(row) : null;
}

/** One conversation's turns, oldest first. */
export async function listMessages(client: SqlClient, conversationId: number): Promise<ConversationMessage[]> {
  const result = await client.query(SELECT_MESSAGES, [conversationId]);
  return result.rows.map(toConversationMessage);
}

/**
 * The most recent `limit` turns of a conversation, oldest first.
 *
 * Used for conversation memory: only the newest turns can matter to a follow-up,
 * so the database returns only those rather than the whole thread.
 */
export async function listRecentMessages(
  client: SqlClient,
  conversationId: number,
  limit: number
): Promise<ConversationMessage[]> {
  const result = await client.query(SELECT_RECENT_MESSAGES, [conversationId, limit]);
  return result.rows.map(toConversationMessage);
}

/** How many turns a conversation holds. */
export async function countMessages(client: SqlClient, conversationId: number): Promise<number> {
  const result = await client.query(COUNT_MESSAGES, [conversationId]);
  return numberOrZero(result.rows[0]?.count);
}

export interface NewMessage {
  role: 'user' | 'assistant';
  content: string;
  title?: string | null;
  status?: string | null;
  provider?: string | null;
  model?: string | null;
  attribution?: string | null;
  handlerId?: string | null;
  payload?: StoredAssistantPayload | null;
}

export type InsertMessageResult =
  | { ok: true; message: ConversationMessage }
  | { ok: false; reason: 'conversation_missing' | 'cap_reached' };

/**
 * Append one turn, enforcing the per-conversation cap in the same statement.
 *
 * A refusal is distinguished by asking whether the conversation exists at all:
 * `conversation_missing` (404) and `cap_reached` (409) are different answers to
 * the reader and must not be reported as the same thing.
 */
export async function insertMessage(
  client: SqlClient,
  conversationId: number,
  message: NewMessage,
  cap: number
): Promise<InsertMessageResult> {
  const result = await client.query(INSERT_MESSAGE, [
    conversationId,
    message.role,
    message.content,
    message.title ?? null,
    message.status ?? null,
    message.provider ?? null,
    message.model ?? null,
    message.attribution ?? null,
    message.handlerId ?? null,
    message.payload ? JSON.stringify(message.payload) : null,
    ANALYST_CONVERSATION_SCHEMA_VERSION,
    cap,
  ]);
  const row = result.rows[0];
  if (row) return { ok: true, message: toConversationMessage(row) };
  const exists = await findConversation(client, conversationId);
  return { ok: false, reason: exists ? 'cap_reached' : 'conversation_missing' };
}

/** Rename a conversation. Returns the updated summary, or null when unknown. */
export async function renameConversationRow(
  client: SqlClient,
  id: number,
  title: string
): Promise<ConversationSummary | null> {
  const result = await client.query(RENAME_CONVERSATION, [id, title]);
  const row = result.rows[0];
  return row ? toConversationSummary(row) : null;
}

/**
 * Delete a conversation. Its messages go with it: the foreign key carries
 * ON DELETE CASCADE, so the database removes them in the same statement.
 * Returns true when a row was deleted.
 */
export async function deleteConversationRow(client: SqlClient, id: number): Promise<boolean> {
  const result = await client.query(DELETE_CONVERSATION, [id]);
  return result.rows.length > 0;
}

/**
 * The pool for this process, or null when no database is configured.
 * The one connection path: nothing here opens a second pool.
 */
export function storeClient(env: NodeJS.ProcessEnv = process.env): SqlClient | null {
  return getPool(env);
}
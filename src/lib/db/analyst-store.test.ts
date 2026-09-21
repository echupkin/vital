// ── Analyst conversation store (offline, injected client) ────────────────────
//
// The store never opens a connection of its own: every function takes the client
// to use, so the SQL and the row mapping can be driven against an in-memory
// stand-in here — no live database in CI.

import { describe, expect, it } from 'vitest';
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
  toConversationMessage,
  toConversationSummary,
} from '@/lib/db/analyst-store';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';

describe('analyst-store — create, read, list', () => {
  it('creates a conversation and returns its stored summary', async () => {
    const db = new FakeAnalystDb();
    const created = await insertConversation(db, 'Why was my resting heart rate higher?');
    expect(created.id).toBeGreaterThan(0);
    expect(created.title).toBe('Why was my resting heart rate higher?');
    expect(created.messageCount).toBe(0);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The insert carries the schema version, and nothing secret.
    expect(db.calls[0].text).toMatch(/INSERT INTO analyst_conversations/);
    expect(db.calls[0].params).toEqual(['Why was my resting heart rate higher?', 1]);
  });

  it('fetches a conversation by id and returns null for an unknown id', async () => {
    const db = new FakeAnalystDb();
    const created = await insertConversation(db, 'Sleep');
    expect((await findConversation(db, created.id))?.title).toBe('Sleep');
    expect(await findConversation(db, 999)).toBeNull();
  });

  it('lists conversations newest activity first', async () => {
    const db = new FakeAnalystDb();
    const first = await insertConversation(db, 'First');
    const second = await insertConversation(db, 'Second');
    // A turn in the FIRST conversation makes it the most recently active.
    await insertMessage(db, first.id, { role: 'user', content: 'hello' }, 200);

    const listed = await listConversations(db);
    expect(listed.map(c => c.id)).toEqual([first.id, second.id]);
    expect(listed[0].messageCount).toBe(1);
    expect(listed[1].messageCount).toBe(0);
  });

  it('reads one conversation\'s turns oldest first, in the order they were said', async () => {
    const db = new FakeAnalystDb();
    const conversation = await insertConversation(db, 'Thread');
    await insertMessage(db, conversation.id, { role: 'user', content: 'first question' }, 200);
    await insertMessage(db, conversation.id, { role: 'assistant', content: 'first answer', status: 'ok', attribution: 'Demo analyst · handler general' }, 200);
    await insertMessage(db, conversation.id, { role: 'user', content: 'second question' }, 200);

    const messages = await listMessages(db, conversation.id);
    expect(messages.map(m => m.content)).toEqual(['first question', 'first answer', 'second question']);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].attribution).toBe('Demo analyst · handler general');
    expect(await countMessages(db, conversation.id)).toBe(3);
  });

  it('returns the most recent turns oldest-first for memory', async () => {
    const db = new FakeAnalystDb();
    const conversation = await insertConversation(db, 'Thread');
    for (let i = 1; i <= 8; i += 1) {
      await insertMessage(db, conversation.id, { role: i % 2 === 1 ? 'user' : 'assistant', content: `turn ${i}` }, 200);
    }
    const recent = await listRecentMessages(db, conversation.id, 3);
    expect(recent.map(m => m.content)).toEqual(['turn 6', 'turn 7', 'turn 8']);
  });
});

describe('analyst-store — rename and delete', () => {
  it('renames without touching the conversation\'s last-activity time', async () => {
    const db = new FakeAnalystDb();
    const conversation = await insertConversation(db, 'Old title');
    await insertMessage(db, conversation.id, { role: 'user', content: 'q' }, 200);
    const before = await findConversation(db, conversation.id);

    const renamed = await renameConversationRow(db, conversation.id, 'New title');
    expect(renamed?.title).toBe('New title');
    expect(renamed?.updatedAt).toBe(before?.updatedAt);
    expect(await renameConversationRow(db, 999, 'x')).toBeNull();
  });

  it('deletes a conversation and cascades to its messages', async () => {
    const db = new FakeAnalystDb();
    const keep = await insertConversation(db, 'Keep');
    const drop = await insertConversation(db, 'Drop');
    await insertMessage(db, keep.id, { role: 'user', content: 'kept' }, 200);
    await insertMessage(db, drop.id, { role: 'user', content: 'removed' }, 200);
    await insertMessage(db, drop.id, { role: 'assistant', content: 'also removed', status: 'ok', attribution: 'x' }, 200);

    expect(db.messageCountOf(drop.id)).toBe(2);
    expect(await deleteConversationRow(db, drop.id)).toBe(true);

    // The conversation row and every turn of it are gone; the other thread is not.
    expect(await findConversation(db, drop.id)).toBeNull();
    expect(db.messageCountOf(drop.id)).toBe(0);
    expect(db.conversationCount()).toBe(1);
    expect(db.messageCountOf(keep.id)).toBe(1);
    expect(await deleteConversationRow(db, drop.id)).toBe(false);
  });
});

describe('analyst-store — caps and validation', () => {
  it('refuses a turn past the per-conversation cap, in the statement itself', async () => {
    const db = new FakeAnalystDb();
    const conversation = await insertConversation(db, 'Tight');
    expect((await insertMessage(db, conversation.id, { role: 'user', content: 'one' }, 1)).ok).toBe(true);

    const refused = await insertMessage(db, conversation.id, { role: 'user', content: 'two' }, 1);
    expect(refused).toEqual({ ok: false, reason: 'cap_reached' });
    expect(db.messageCountOf(conversation.id)).toBe(1);
  });

  it('reports a missing conversation distinctly from a cap refusal', async () => {
    const db = new FakeAnalystDb();
    const result = await insertMessage(db, 4242, { role: 'user', content: 'into the void' }, 200);
    expect(result).toEqual({ ok: false, reason: 'conversation_missing' });
  });
});

describe('analyst-store — row mapping', () => {
  it('maps a conversation row defensively and never throws on junk', () => {
    const summary = toConversationSummary({ id: '7', title: '   ', message_count: null, created_at: null, updated_at: null });
    expect(summary.id).toBe(7);
    expect(summary.title).toBe('Untitled conversation');
    expect(summary.messageCount).toBe(0);
    expect(summary.createdAt).toBe(new Date(0).toISOString());
  });

  it('parses a JSONB payload whether it arrives as an object or as text', () => {
    const payload = { status: 'ok', label: 'Demo analyst' };
    const asObject = toConversationMessage({ id: 1, role: 'assistant', content: 'a', payload, created_at: '2026-01-01T00:00:00.000Z' });
    const asText = toConversationMessage({ id: 2, role: 'assistant', content: 'a', payload: JSON.stringify(payload), created_at: '2026-01-01T00:00:00.000Z' });
    expect(asObject.payload?.label).toBe('Demo analyst');
    expect(asText.payload).toEqual(asObject.payload);
    expect(toConversationMessage({ id: 3, role: 'nonsense', content: 'a' }).role).toBe('user');
  });
});
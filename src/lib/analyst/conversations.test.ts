// ── Conversation service: no-database path, CRUD, caps, persistence rules ────
//
// Deterministic and offline: the store is driven through an injected in-memory
// client, and the analyst responses are produced by the real service in demo
// mode (no provider, no network).

import { describe, expect, it } from 'vitest';
import { askAnalyst } from '@/lib/analyst/service';
import {
  NO_DATABASE_REASON,
  appendExchange,
  createConversationForApi,
  deleteConversationForApi,
  listConversationsForApi,
  memoryTurnsFor,
  readConversationForApi,
  renameConversationForApi,
  resolveConversations,
} from '@/lib/analyst/conversations';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';

const DEMO_ENV = {} as NodeJS.ProcessEnv;

/** A real demo response: the supported-question handler computes it. */
async function okResponse(question = 'How has my sleep changed over the last month?') {
  return askAnalyst({ query: question }, { env: DEMO_ENV });
}

describe('conversations — no database configured', () => {
  it('reports honestly that conversations are not saved', () => {
    const resolved = resolveConversations({ client: null });
    expect(resolved.availability.available).toBe(false);
    expect(resolved.availability.backend).toBe('memory');
    expect(resolved.availability.reason).toBe(NO_DATABASE_REASON);
    expect(resolved.client).toBeNull();
  });

  it('still lists an empty set rather than failing', async () => {
    const listed = await listConversationsForApi({ client: null });
    expect(listed.ok).toBe(true);
    expect(listed.availability.available).toBe(false);
    expect(listed.ok && listed.conversations).toEqual([]);
  });

  it('refuses to create, rename or delete with a clear reason', async () => {
    const created = await createConversationForApi({ client: null }, 'x');
    expect(created.ok).toBe(false);
    expect(!created.ok && created.status).toBe(503);
    expect(!created.ok && created.error).toContain('not saved');

    const renamed = await renameConversationForApi({ client: null }, 1, 'x');
    expect(!renamed.ok && renamed.status).toBe(503);
    const deleted = await deleteConversationForApi({ client: null }, 1);
    expect(!deleted.ok && deleted.status).toBe(503);
    const read = await readConversationForApi({ client: null }, 1);
    expect(!read.ok && read.status).toBe(503);
  });

  it('answers the question and says plainly that it was not persisted', async () => {
    const response = await okResponse();
    const outcome = await appendExchange({ client: null }, null, 'How has my sleep changed over the last month?', response);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.outcome.persisted).toBe(false);
    expect(outcome.ok && outcome.outcome.reason).toBe(NO_DATABASE_REASON);
    expect(await memoryTurnsFor({ client: null }, 1)).toEqual([]);
  });
});

describe('conversations — create, list, read', () => {
  it('creates with the default title and with a supplied one', async () => {
    const db = new FakeAnalystDb();
    const plain = await createConversationForApi({ client: db }, undefined);
    expect(plain.ok && plain.status).toBe(201);
    expect(plain.ok && plain.data.title).toBe('New conversation');

    const named = await createConversationForApi({ client: db }, '  Recovery notes  ');
    expect(named.ok && named.data.title).toBe('Recovery notes');
    expect(db.conversationCount()).toBe(2);
  });

  it('rejects an empty or over-long title with 400', async () => {
    const db = new FakeAnalystDb();
    expect((await createConversationForApi({ client: db }, '   ')).ok).toBe(false);
    const long = await createConversationForApi({ client: db }, 'x'.repeat(500));
    expect(!long.ok && long.status).toBe(400);
    expect((await createConversationForApi({ client: db }, 42)).ok).toBe(false);
    expect(db.conversationCount()).toBe(0);
  });

  it('lists newest activity first and reads one conversation with its turns', async () => {
    const db = new FakeAnalystDb();
    const first = await createConversationForApi({ client: db }, 'First');
    const second = await createConversationForApi({ client: db }, 'Second');
    const firstId = first.ok ? first.data.id : 0;
    const secondId = second.ok ? second.data.id : 0;

    await appendExchange({ client: db }, firstId, 'How is my HRV trending?', await okResponse('How is my HRV trending?'));

    const listed = await listConversationsForApi({ client: db });
    expect(listed.ok && listed.conversations.map(c => c.id)).toEqual([firstId, secondId]);

    const read = await readConversationForApi({ client: db }, firstId);
    expect(read.ok && read.data.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(read.ok && read.data.messageCount).toBe(2);
  });

  it('validates the id and reports an unknown one as 404', async () => {
    const db = new FakeAnalystDb();
    expect((await readConversationForApi({ client: db }, 'nonsense')).ok).toBe(false);
    const missing = await readConversationForApi({ client: db }, 99);
    expect(!missing.ok && missing.status).toBe(404);
    const negative = await readConversationForApi({ client: db }, -1);
    expect(!negative.ok && negative.status).toBe(400);
  });

  it('renames and deletes, and a delete removes the messages', async () => {
    const db = new FakeAnalystDb();
    const created = await createConversationForApi({ client: db }, 'Draft');
    const id = created.ok ? created.data.id : 0;
    await appendExchange({ client: db }, id, 'How is my HRV trending?', await okResponse('How is my HRV trending?'));
    expect(db.messageCountOf(id)).toBe(2);

    const renamed = await renameConversationForApi({ client: db }, id, 'HRV review');
    expect(renamed.ok && renamed.data.title).toBe('HRV review');
    expect((await renameConversationForApi({ client: db }, id, '')).ok).toBe(false);

    const deleted = await deleteConversationForApi({ client: db }, id);
    expect(deleted.ok && deleted.data.id).toBe(id);
    expect(db.messageCountOf(id)).toBe(0);
    expect((await readConversationForApi({ client: db }, id)).ok).toBe(false);
  });
});
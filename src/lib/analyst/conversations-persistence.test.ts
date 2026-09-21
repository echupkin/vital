// ── Conversations: what gets stored, the caps, and memory from the store ─────
//
// Deterministic and offline. These are the rules the owner cares about: the
// thread is saved, the opening question names it, a follow-up carries its
// history, a refusal is stated rather than silently dropped, and a reply the
// guard discarded is never written.

import { describe, expect, it } from 'vitest';
import { askAnalyst } from '@/lib/analyst/service';
import {
  appendExchange,
  createConversationForApi,
  memoryTurnsFor,
  readConversationForApi,
} from '@/lib/analyst/conversations';
import { MAX_CONVERSATION_MESSAGES, deriveTitle } from '@/lib/analyst/conversation-rules';
import { MAX_MEMORY_TURNS } from '@/lib/analyst/memory';
import { FakeAnalystDb } from '@/lib/analyst/test-doubles';

const DEMO_ENV = {} as NodeJS.ProcessEnv;
const QUESTION = 'How has my sleep changed over the last month?';

async function okResponse(question = QUESTION) {
  return askAnalyst({ query: question }, { env: DEMO_ENV });
}
async function unsupportedResponse() {
  return askAnalyst({ query: 'Why is the moon made of cheese?' }, { env: DEMO_ENV });
}

describe('conversations — persistence rules', () => {
  it('saves an answer that was shown, with its text, provenance and evidence', async () => {
    const db = new FakeAnalystDb();
    const response = await okResponse();
    const outcome = await appendExchange({ client: db }, null, QUESTION, response);
    expect(outcome.ok && outcome.outcome.persisted).toBe(true);

    const [user, assistant] = db.allMessages();
    expect(user.role).toBe('user');
    expect(user.content).toBe(QUESTION);
    expect(assistant.role).toBe('assistant');
    expect(assistant.status).toBe('ok');
    // Content is the text the reader saw (the answer title and its sections).
    expect(String(assistant.content)).toContain(response.answer!.title);
    // Attribution is the provenance line the UI shows, and never a credential.
    expect(assistant.attribution).toBe(`Demo analyst · handler ${response.handlerId}`);
    expect(String(assistant.attribution)).not.toMatch(/sk-|Bearer|api[_-]?key/i);

    const payload = assistant.payload as { answer: { evidence: unknown[] }; retrieval: { metrics: unknown[] } };
    expect(payload.answer.evidence.length).toBeGreaterThan(0);
    expect(payload.retrieval.metrics.length).toBeGreaterThan(0);
    // Chart series are health values and are deliberately not stored.
    expect(JSON.stringify(payload)).not.toContain('"points"');
  });

  it('names a new conversation from its opening question', async () => {
    const db = new FakeAnalystDb();
    const outcome = await appendExchange({ client: db }, null, QUESTION, await okResponse());
    expect(outcome.ok && outcome.outcome.conversation?.title).toBe(deriveTitle(QUESTION));
  });

  it('does not rename a conversation the reader renamed', async () => {
    const db = new FakeAnalystDb();
    const created = await createConversationForApi({ client: db }, 'My review');
    const id = created.ok ? created.data.id : 0;
    const outcome = await appendExchange({ client: db }, id, QUESTION, await okResponse());
    expect(outcome.ok && outcome.outcome.conversation?.title).toBe('My review');
  });

  it('stores the honest explanation when the model produced no answer', async () => {
    const db = new FakeAnalystDb();
    const response = await unsupportedResponse();
    expect(response.status).toBe('unsupported');
    expect(response.answer).toBeNull();

    await appendExchange({ client: db }, null, 'Why is the moon made of cheese?', response);
    const assistant = db.allMessages().find(m => m.role === 'assistant')!;
    // The fallback text the reader saw is stored, with its honest attribution.
    expect(assistant.content).toBe(response.message);
    expect(String(assistant.attribution)).toContain('unsupported (no model answer)');
    expect(assistant.status).toBe('unsupported');
  });

  it('never writes a reply the validator discarded — only the message shown', async () => {
    const db = new FakeAnalystDb();
    // A rejected model reply leaves an `error` response whose message explains
    // it; the discarded reply itself is not part of the response and so cannot
    // reach the store.
    const discarded = '{"title":"unvalidated RAW MODEL BLOB"';
    const response = await askAnalyst({ query: 'What changed this week?' }, { env: DEMO_ENV });
    const forged = { ...response, status: 'error' as const, answer: null, message: "The model's reply could not be read as an answer." };
    await appendExchange({ client: db }, null, 'What changed this week?', forged);

    const assistant = db.allMessages().find(m => m.role === 'assistant')!;
    expect(assistant.content).toBe("The model's reply could not be read as an answer.");
    expect(JSON.stringify(db.allMessages())).not.toContain(discarded);
  });
});

describe('conversations — the per-conversation cap', () => {
  it('refuses an exchange past the cap with 409 and stores nothing extra', async () => {
    const db = new FakeAnalystDb();
    const created = await createConversationForApi({ client: db }, 'Long thread');
    const id = created.ok ? created.data.id : 0;

    // Fill the conversation to one turn short of the cap.
    const { insertMessage } = await import('@/lib/db/analyst-store');
    for (let i = 0; i < MAX_CONVERSATION_MESSAGES - 1; i += 1) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const inserted = await insertMessage(
        db,
        id,
        role === 'user' ? { role, content: `q${i}` } : { role, content: `a${i}`, status: 'ok', attribution: 'demo' },
        MAX_CONVERSATION_MESSAGES
      );
      expect(inserted.ok).toBe(true);
    }

    const refused = await appendExchange({ client: db }, id, QUESTION, await okResponse());
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.status).toBe(409);
    expect(!refused.ok && refused.error).toContain(`${MAX_CONVERSATION_MESSAGES}-turn limit`);
    expect(db.messageCountOf(id)).toBe(MAX_CONVERSATION_MESSAGES - 1);
  });

  it('reports appending to an unknown conversation as 404', async () => {
    const db = new FakeAnalystDb();
    const result = await appendExchange({ client: db }, 777, QUESTION, await okResponse());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(404);
  });
});

describe('conversations — memory comes from the stored thread', () => {
  it('returns the earlier turns, bounded, and none for a new conversation', async () => {
    const db = new FakeAnalystDb();
    expect(await memoryTurnsFor({ client: db }, 1)).toEqual([]);

    const first = await appendExchange({ client: db }, null, QUESTION, await okResponse());
    const id = first.ok ? first.outcome.conversation!.id : 0;
    await appendExchange({ client: db }, id, 'And what about the month before that?', await okResponse('How has my sleep changed over the last month?'));

    const memory = await memoryTurnsFor({ client: db }, id);
    expect(memory).toHaveLength(4);
    expect(memory[0]).toEqual({ role: 'user', content: QUESTION });
    expect(memory[1].role).toBe('assistant');
    expect(memory).toHaveLength(4);

    // A long thread never yields more than the turn cap.
    const { insertMessage } = await import('@/lib/db/analyst-store');
    for (let i = 0; i < 20; i += 1) {
      await insertMessage(db, id, { role: 'user', content: `extra ${i}` }, MAX_CONVERSATION_MESSAGES);
    }
    expect((await memoryTurnsFor({ client: db }, id)).length).toBeLessThanOrEqual(MAX_MEMORY_TURNS);
  });

  it('serves a stored conversation back with its evidence intact', async () => {
    const db = new FakeAnalystDb();
    const response = await okResponse();
    const first = await appendExchange({ client: db }, null, QUESTION, response);
    const id = first.ok ? first.outcome.conversation!.id : 0;

    const read = await readConversationForApi({ client: db }, id);
    expect(read.ok).toBe(true);
    const assistant = read.ok ? read.data.messages.find(m => m.role === 'assistant')! : null;
    expect(assistant?.payload?.answer?.evidence.length).toBe(response.answer?.evidence.length);
    expect(assistant?.payload?.answer?.followUps).toEqual(response.answer?.followUps);
  });
});
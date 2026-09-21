// ── Test doubles for the analyst conversation store ──────────────────────────
//
// A small in-memory stand-in for Postgres that implements exactly the statements
// `@/lib/db/analyst-store` issues, with the semantics the real database has:
//
//   * a conversation list ordered by last activity, newest first;
//   * one conversation's turns in the order they were said;
//   * the per-conversation turn cap enforced inside the INSERT, exactly where the
//     real SQL enforces it;
//   * DELETE ... CASCADE: removing a conversation removes its turns;
//   * a rename changes the title but not the conversation's last-activity time.
//
// It is a TEST DOUBLE, not the store: the real SQL is exercised against the real
// database in the project's evidence run. Imported only by *.test.ts files; no
// application module imports it.

import type { SqlClient } from '@/lib/db/analyst-store';

type Row = Record<string, unknown>;

export interface RecordedCall {
  text: string;
  params: unknown[];
}

export class FakeAnalystDb implements SqlClient {
  private conversations = new Map<number, Row>();
  private messages: Row[] = [];
  private nextConversationId = 1;
  private nextMessageId = 1;
  private clock = 0;

  /** Every statement this fake was asked to run, in order. */
  readonly calls: RecordedCall[] = [];

  /** When set, the next query throws it (and then clears). */
  failNext: Error | null = null;

  private stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }

  private summary(conversation: Row): Row {
    return {
      id: conversation.id,
      title: conversation.title,
      message_count: conversation.message_count,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    };
  }

  private messageRow(message: Row): Row {
    return { ...message };
  }

  async query(text: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    this.calls.push({ text, params: [...params] });
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }

    if (/INSERT INTO analyst_conversations/.test(text)) {
      const [title] = params as [string, number];
      const now = this.stamp();
      const row: Row = {
        id: this.nextConversationId++,
        title,
        message_count: 0,
        archived_at: null,
        created_at: now,
        updated_at: now,
      };
      this.conversations.set(row.id as number, row);
      return { rows: [this.summary(row)] };
    }

    if (/FROM analyst_conversations/.test(text) && /archived_at IS NULL/.test(text)) {
      const limit = Number((params as number[])[0] ?? 100);
      const rows = [...this.conversations.values()]
        .filter(c => c.archived_at === null)
        .sort((a, b) => {
          const at = String(a.updated_at);
          const bt = String(b.updated_at);
          if (at !== bt) return at < bt ? 1 : -1;
          return Number(b.id) - Number(a.id);
        })
        .slice(0, limit)
        .map(c => this.summary(c));
      return { rows };
    }

    if (/INSERT INTO analyst_messages/.test(text)) {
      const p = params as [
        number, string, string, string | null, string | null, string | null,
        string | null, string | null, string | null, string | null, number, number,
      ];
      const [conversationId, role, content, title, status, provider, model, attribution, handlerId, payload, , cap] = p;
      const conversation = this.conversations.get(Number(conversationId));
      if (!conversation) return { rows: [] };
      const count = this.messages.filter(m => Number(m.conversation_id) === Number(conversationId)).length;
      if (count >= Number(cap)) return { rows: [] };
      const row: Row = {
        id: this.nextMessageId++,
        conversation_id: Number(conversationId),
        role,
        content,
        title: title ?? null,
        status: status ?? null,
        provider: provider ?? null,
        model: model ?? null,
        attribution: attribution ?? null,
        handler_id: handlerId ?? null,
        // jsonb: the driver hands back an object, so the double stores one too.
        payload: typeof payload === 'string' ? (JSON.parse(payload) as Row) : (payload ?? null),
        created_at: this.stamp(),
      };
      this.messages.push(row);
      conversation.message_count = count + 1;
      conversation.updated_at = row.created_at;
      conversation.revision = Number(conversation.revision ?? 1) + 1;
      return { rows: [this.messageRow(row)] };
    }

    if (/SELECT count\(\*\)/.test(text)) {
      const id = Number((params as number[])[0]);
      return { rows: [{ count: this.messages.filter(m => Number(m.conversation_id) === id).length }] };
    }

    if (/LIMIT \$2/.test(text)) {
      const [conversationId, limit] = params as [number, number];
      const rows = this.messages
        .filter(m => Number(m.conversation_id) === Number(conversationId))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, Number(limit))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(m => this.messageRow(m));
      return { rows };
    }

    if (/FROM analyst_messages/.test(text)) {
      const [conversationId] = params as [number];
      const rows = this.messages
        .filter(m => Number(m.conversation_id) === Number(conversationId))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(m => this.messageRow(m));
      return { rows };
    }

    if (/UPDATE analyst_conversations/.test(text)) {
      const [id, title] = params as [number, string];
      const row = this.conversations.get(Number(id));
      if (!row) return { rows: [] };
      row.title = title;
      row.revision = Number(row.revision ?? 1) + 1;
      return { rows: [this.summary(row)] };
    }

    if (/DELETE FROM analyst_conversations/.test(text)) {
      const id = Number((params as number[])[0]);
      if (!this.conversations.has(id)) return { rows: [] };
      this.conversations.delete(id);
      // ON DELETE CASCADE.
      this.messages = this.messages.filter(m => Number(m.conversation_id) !== id);
      return { rows: [{ id }] };
    }

    // The generic single-row lookup comes LAST: several of the statements above
    // mention `analyst_conversations` in a subquery or a WHERE clause, and they
    // must be matched by their own branch first.
    if (/FROM analyst_conversations/.test(text)) {
      const id = Number((params as number[])[0]);
      const row = this.conversations.get(id);
      return { rows: row ? [this.summary(row)] : [] };
    }

    throw new Error(`FakeAnalystDb does not recognise this statement: ${text.slice(0, 60)}…`);
  }

  // ── Assertions helpers ─────────────────────────────────
  conversationCount(): number {
    return this.conversations.size;
  }

  messageCountOf(id: number): number {
    return this.messages.filter(m => Number(m.conversation_id) === id).length;
  }

  allMessages(): Row[] {
    return this.messages.map(m => ({ ...m }));
  }
}
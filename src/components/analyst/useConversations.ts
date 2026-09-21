'use client';

// ── Conversations hook (SPEC §8) ────────────────────────
//
// The browser's view of the conversation store. Every list, turn and rename
// comes from the server, so the selector survives a refresh, a different browser
// and a different device — it holds no authoritative state of its own.
//
// When the server reports that nothing is being saved (`availability.available`
// is false) the hook says so and the page falls back to the in-memory behaviour
// it had before, honestly labelled.

import { useCallback, useEffect, useState } from 'react';
import type {
  ConversationAvailability,
  ConversationDetail,
  ConversationSummary,
} from '@/lib/analyst/conversation-types';

const UNAVAILABLE: ConversationAvailability = { available: false, backend: 'memory', reason: null };

export interface ConversationsHook {
  availability: ConversationAvailability;
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (title?: string) => Promise<ConversationSummary | null>;
  load: (id: number) => Promise<ConversationDetail | null>;
  rename: (id: number, title: string) => Promise<ConversationSummary | null>;
  remove: (id: number) => Promise<boolean>;
}

/** Read a JSON error message from a failed response, without throwing. */
async function errorFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Fall through to the status line.
  }
  return `The conversations endpoint answered HTTP ${response.status}.`;
}

export function useConversations(): ConversationsHook {
  const [availability, setAvailability] = useState<ConversationAvailability>(UNAVAILABLE);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analyst/conversations', { cache: 'no-store' });
      if (!res.ok) throw new Error(await errorFrom(res));
      const data = (await res.json()) as ConversationAvailability & { conversations?: ConversationSummary[] };
      setAvailability({ available: data.available, backend: data.backend, reason: data.reason });
      setConversations(data.conversations ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The conversations could not be read.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (title?: string) => {
      try {
        const res = await fetch('/api/analyst/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(title === undefined ? {} : { title }),
        });
        if (!res.ok) throw new Error(await errorFrom(res));
        const data = (await res.json()) as { conversation: ConversationSummary };
        await refresh();
        return data.conversation;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The conversation could not be created.');
        return null;
      }
    },
    [refresh]
  );

  const load = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/analyst/conversations/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await errorFrom(res));
      const data = (await res.json()) as { conversation: ConversationDetail };
      return data.conversation;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The conversation could not be read.');
      return null;
    }
  }, []);

  const rename = useCallback(
    async (id: number, title: string) => {
      try {
        const res = await fetch(`/api/analyst/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(await errorFrom(res));
        const data = (await res.json()) as { conversation: ConversationSummary };
        await refresh();
        return data.conversation;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The conversation could not be renamed.');
        return null;
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`/api/analyst/conversations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await errorFrom(res));
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The conversation could not be deleted.');
        return false;
      }
    },
    [refresh]
  );

  return { availability, conversations, loading, error, refresh, create, load, rename, remove };
}
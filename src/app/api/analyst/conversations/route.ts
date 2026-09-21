// ── /api/analyst/conversations (SPEC §8) ─────────────────
//
// The conversation selector's list and its "New conversation" control.
//
//   GET  → { available, backend, reason, conversations: [...] } — newest first.
//          When no database is configured this is a 200 with an empty list and
//          `available: false` plus the honest reason, NOT an error: the analyst
//          keeps working in memory, and the UI has to be able to say so.
//   POST → create a conversation ({ title? }) and return it. 503 when nothing
//          is configured (there is nowhere to create it), 400 for a bad title.
//
// Nothing here returns a credential, a database address or a health value. The
// conversation shapes hold a title, a turn count, two timestamps and turn text.
//
// Responses are private and uncacheable: this is the reader's own history.

import { NextResponse } from 'next/server';
import {
  createConversationForApi,
  listConversationsForApi,
  type ConversationDeps,
} from '@/lib/analyst/conversations';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const result = await listConversationsForApi();
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...result.availability }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json(
    { ...result.availability, conversations: result.conversations },
    { status: result.status, headers: NO_STORE }
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const deps: ConversationDeps = {};
  const result = await createConversationForApi(deps, raw.title);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...result.availability }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json({ conversation: result.data, available: true }, { status: result.status, headers: NO_STORE });
}
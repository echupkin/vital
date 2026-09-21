// ── /api/analyst/conversations/[id] (SPEC §8) ────────────
//
// One conversation: read it with its turns, rename it, or delete it.
//
//   GET    → { conversation: { ..., messages: [...] } } — turns oldest first.
//   PATCH  → { title } rename. 400 for a bad title, 404 for an unknown id.
//   DELETE → remove the conversation; its messages go with it (ON DELETE
//            CASCADE in the schema). 404 when there was nothing to delete.
//
// The id is validated as a positive whole number and never coerced from junk.
// 503 (with the reason) when no database is configured — there is nothing to
// read, rename or delete, and pretending otherwise would be a lie.
//
// Responses are private and uncacheable.

import { NextResponse } from 'next/server';
import {
  deleteConversationForApi,
  readConversationForApi,
  renameConversationForApi,
} from '@/lib/analyst/conversations';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await readConversationForApi({}, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...result.availability }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json({ conversation: result.data, available: true }, { status: result.status, headers: NO_STORE });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const result = await renameConversationForApi({}, id, raw.title);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...result.availability }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json({ conversation: result.data, available: true }, { status: result.status, headers: NO_STORE });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const result = await deleteConversationForApi({}, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...result.availability }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json({ deleted: result.data.id, available: true }, { status: result.status, headers: NO_STORE });
}
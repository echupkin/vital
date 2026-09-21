// ── /api/analyst (SPEC §8) ──────────────────────────────
//
// Server-side analyst endpoint. The browser sends a question; this route runs
// the validated, read-only service and returns a structured answer. No
// credential, no dataset and no provider instance is ever exposed to the client.
//
// A question may name the conversation it belongs to. When it does:
//   * the conversation's earlier turns are loaded (bounded — see memory.ts) and
//     travel with the question, so a follow-up resolves against what was asked;
//   * the question and the answer that was ACTUALLY SHOWN are appended to it.
// A question with no conversation creates one, titled from the question, so the
// very first exchange is saved too.
//
// Nothing is persisted when there is no database: the analyst still answers, and
// the response says `persisted: false` with the reason rather than pretending.
// Nothing is persisted for a question the service refused (an empty or
// over-long question), and no reply the validator discarded ever reaches the
// store because the service never returns it.
//
// Responses are marked private and uncacheable: they are personal health
// context and must not be stored by a shared cache.

import { NextResponse } from 'next/server';
import { askAnalyst, publicConfigState, readAnalystConfig, supportedPrompts, validateQuery } from '@/lib/analyst';
import { appendExchange, memoryTurnsFor, resolveConversations } from '@/lib/analyst/conversations';
import type { UnitSystem } from '@/lib/prefs';
import { LiveDataUnavailableError, installDataset } from '@/lib/adapters/runtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  // Only the configuration STATE is reported. The provider name, model, host and
  // prompt source are safe to show; the key itself never leaves the server and is
  // reduced to `hasKey`.
  const state = publicConfigState(readAnalystConfig());
  // Whether conversations can be saved, so the selector can say so honestly
  // before the reader has asked anything.
  const { availability } = resolveConversations();
  return NextResponse.json(
    { ...state, prompts: supportedPrompts(), conversations: availability },
    { headers: NO_STORE }
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
  const system: UnitSystem = raw.system === 'imperial' ? 'imperial' : 'metric';
  const { availability } = resolveConversations();
  const hasConversation = raw.conversationId !== undefined && raw.conversationId !== null && raw.conversationId !== '';

  // Read the same dataset the pages are serving, in whichever bundle this route
  // handler was compiled into. A live failure is reported, never replaced with
  // demo data (SPEC §10).
  try {
    await installDataset();
  } catch (error) {
    const detail = error instanceof LiveDataUnavailableError ? error.detail : 'The dataset could not be loaded.';
    return NextResponse.json(
      { error: `The analyst cannot read the health data source: ${detail}` },
      { status: 503, headers: NO_STORE }
    );
  }

  // The conversation's memory, when the question belongs to one. Bounded twice:
  // the store returns only the newest turns, and the service bounds them again.
  const history = hasConversation && availability.available ? await memoryTurnsFor({}, raw.conversationId) : [];

  const response = await askAnalyst({
    query: raw.query as string,
    notes: raw.notes as string | undefined,
    system,
    history,
  });

  // A question the service refused was never asked: nothing is saved for it.
  const question = validateQuery(raw.query);
  if (!question.ok) {
    return NextResponse.json(
      { ...response, persisted: false, persistence: { ...availability, reason: 'Nothing was saved: the question was not accepted.' } },
      { status: 200, headers: NO_STORE }
    );
  }

  const outcome = await appendExchange({}, raw.conversationId, question.query, response);
  if (!outcome.ok) {
    // The conversation vanished or hit its turn cap: report it rather than
    // appending to the wrong thread or silently dropping the turn.
    return NextResponse.json(
      { error: outcome.error, ...outcome.availability },
      { status: outcome.status, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      ...response,
      persisted: outcome.outcome.persisted,
      persistence: { ...availability, reason: outcome.outcome.reason },
      conversation: outcome.outcome.conversation,
    },
    { status: 200, headers: NO_STORE }
  );
}
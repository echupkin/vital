// ── /api/analyst (SPEC §8) ──────────────────────────────
//
// Server-side analyst endpoint. The browser sends a question; this route runs
// the validated, read-only service and returns a structured answer. No
// credential, no dataset and no provider instance is ever exposed to the client.
//
// Responses are marked private and uncacheable: they are personal health
// context and must not be stored by a shared cache.

import { NextResponse } from 'next/server';
import { askAnalyst, publicConfigState, readAnalystConfig, supportedPrompts } from '@/lib/analyst';
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
  return NextResponse.json(
    { ...state, prompts: supportedPrompts() },
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

  const response = await askAnalyst({
    query: raw.query as string,
    notes: raw.notes as string | undefined,
    system,
  });

  return NextResponse.json(response, { status: 200, headers: NO_STORE });
}

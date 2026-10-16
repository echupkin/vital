// ── /api/pipeline/quality/correct ───────────────────────

// Turn one data-quality correction on or off (see `@/lib/adapters/quality-correct`).
// Configuration only: a check id. Corrections are on by default.
//
//   POST   { checkId } → correct it ("Fix it"): Vital leaves the repeated
//                        records out of its own totals.
//   DELETE { checkId } → stop correcting: every record counts again.
//
// Both are idempotent, and both drop the cached live data so the next load
// adds the days up again. Either one also removes a silence on that check: a
// reader who turns the correction on or off wants to see the result. The export server is never written to. Ids are
// validated against the correctable checks (400); no database answers 503
// with the reason; any other failure is a 500.

import { NextResponse } from 'next/server';
import { validateCorrectionInput, type CorrectableCheck } from '@/lib/adapters/quality-correct';
import { clearLiveCaches } from '@/lib/adapters/cache';
import { correctionsClient, pgCorrectionOff, pgCorrectionOn } from '@/lib/db/quality-corrections-store';
import { pgRestore } from '@/lib/db/quality-silenced-store';
import { NO_DATABASE_CONFIGURED_REASON } from '@/lib/db/backend';
import type { PoolLike } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function handle(request: Request, write: (client: PoolLike, checkId: CorrectableCheck) => Promise<void>, correcting: boolean) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ error: 'The request body must be JSON.' }, 400);
  }
  const input = validateCorrectionInput(body);
  if (!input.ok) return reply({ error: input.error }, 400);
  try {
    const client = correctionsClient();
    if (!client) return reply({ error: NO_DATABASE_CONFIGURED_REASON }, 503);
    await write(client, input.checkId);
    // Correctable checks are silenced by check alone (metric id '').
    await pgRestore(client, { checkId: input.checkId, metricId: '' });
    clearLiveCaches();
    return reply({ checkId: input.checkId, correcting }, 200);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'The correction could not be saved.' }, 500);
  }
}

export function POST(request: Request) {
  return handle(request, pgCorrectionOn, true);
}

export function DELETE(request: Request) {
  return handle(request, pgCorrectionOff, false);
}

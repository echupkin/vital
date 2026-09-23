// ── /api/lab/results/[id] — a manual correction ──────────────────────────────
//
//   PATCH JSON { value?, valueText?, unit?, refLow?, refHigh?, refText?,
//                refSource?, refBasis?, printedName?, analyteKey? }
//
// Writes the owner's correction and marks the row `manual` with a bumped
// revision — the caller cannot opt out of either, so a corrected row is always
// distinguishable from one the parser produced. Only the fields present are
// changed; a field left out is left alone.
//
// A patch that would leave a row with neither a value nor printed text is
// refused, because the database's own constraint says a result must say
// something.

import { NextResponse } from 'next/server';
import { resolveAnalyte } from '@/lib/lab/analytes';
import type { LabRefSource } from '@/lib/lab/types';
import { updateResult, type ResultPatch, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

const REF_SOURCES: readonly LabRefSource[] = ['report', 'reference_table', 'manual', 'none'];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

type ParseResult = { ok: true; patch: ResultPatch } | { ok: false; error: string };

function parsePatch(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'The request body must be a JSON object.' };
  const raw = body as Record<string, unknown>;
  const patch: ResultPatch = {};

  for (const key of ['value', 'refLow', 'refHigh'] as const) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === null) {
      patch[key] = null;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      patch[key] = value;
    } else {
      return { ok: false, error: `${key} must be a finite number or null.` };
    }
  }

  for (const key of ['valueText', 'unit', 'refText', 'refBasis', 'printedName', 'analyteKey'] as const) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === null) {
      patch[key] = null;
    } else if (typeof value === 'string') {
      patch[key] = value;
    } else {
      return { ok: false, error: `${key} must be a string or null.` };
    }
  }

  if ('refSource' in raw) {
    const value = raw.refSource;
    if (typeof value === 'string' && (REF_SOURCES as readonly string[]).includes(value)) {
      patch.refSource = value as LabRefSource;
    } else {
      return { ok: false, error: `refSource must be one of ${REF_SOURCES.join(', ')}.` };
    }
  }

  const named = typeof patch.printedName === 'string' && patch.printedName.trim().length > 0;
  if (named && (patch.analyteKey === undefined || patch.analyteKey === null || patch.analyteKey === '')) {
    patch.analyteKey = resolveAnalyte(patch.printedName as string).key;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'No recognised field to correct was supplied.' };
  }
  return { ok: true, patch };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'The result id must be a UUID.' }, { status: 400, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be JSON.' }, { status: 400, headers: NO_STORE });
  }

  const parsed = parsePatch(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      { error: 'No Postgres database is configured, so nothing can be corrected.' },
      { status: 503, headers: NO_STORE }
    );
  }

  let result;
  try {
    result = await updateResult(client, id, parsed.patch);
  } catch (error) {
    // The row's own constraint (value or value_text present) is the honest
    // refusal here: the patch would have emptied the result.
    return NextResponse.json(
      {
        error: `The correction was refused: ${
          error instanceof Error ? error.message : 'the row would hold neither a value nor printed text.'
        }`,
      },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!result) {
    return NextResponse.json({ error: 'No such result.' }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ result }, { status: 200, headers: NO_STORE });
}
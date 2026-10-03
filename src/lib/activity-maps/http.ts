// ── Shared request handling for the activity-map routes ─
//
// A Next.js route file may export only its handlers and segment config, so the
// pieces the map routes share live here: the no-store header, JSON body
// parsing, and turning a store error into the right status.

import { NextResponse } from 'next/server';
import { MapConflictError, MapNotFoundError } from '@/lib/db/activity-maps-store';

export const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function errorResponse(message: string, status: number): NextResponse {
  return jsonResponse({ error: message }, status);
}

/** The parsed body, or a 400 response. */
export async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: errorResponse('The request body must be JSON.', 400) };
  }
}

/** A whole, positive revision, or null. */
export function revisionOf(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null;
}

/** A store failure as a response: 404, 409 or 500 with the reason (never a secret). */
export function storeErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof MapNotFoundError) return errorResponse(error.message, 404);
  if (error instanceof MapConflictError) return errorResponse(error.message, 409);
  return errorResponse(error instanceof Error ? error.message : fallback, 500);
}

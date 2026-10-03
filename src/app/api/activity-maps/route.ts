// ── /api/activity-maps ──────────────────────────────────
//
//   GET  → every map, in display order, and the basemap tile configuration.
//   POST → create one from { name, bbox, settings? }; it goes to the end.
//   PUT  → reorder: { order: [id, …] } naming every map exactly once.
//
// Maps are configuration (a framed area and display choices), stored in
// Postgres; see db/migrations/0009. No route or observation is read or written
// here. Responses are private and uncacheable.

import { createMap, listMaps, poolOrThrow, reorderMaps } from '@/lib/db/activity-maps-store';
import { validateMapInput } from '@/lib/activity-maps/types';
import { readTileConfig } from '@/lib/activity-maps/tiles';
import { errorResponse, jsonResponse, readBody, storeErrorResponse } from '@/lib/activity-maps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return jsonResponse({ maps: await listMaps(poolOrThrow()), tiles: readTileConfig() });
  } catch (error) {
    return storeErrorResponse(error, 'The maps could not be read.');
  }
}

export async function POST(request: Request) {
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const input = validateMapInput(read.body);
  if (!input.ok) return errorResponse(input.errors.join(' '), 400);
  try {
    return jsonResponse({ map: await createMap(poolOrThrow(), input.value) }, 201);
  } catch (error) {
    return storeErrorResponse(error, 'The map could not be saved.');
  }
}

export async function PUT(request: Request) {
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const order = (read.body as { order?: unknown } | null)?.order;
  if (!Array.isArray(order) || !order.every(id => typeof id === 'string')) {
    return errorResponse('The body must be { order: [map id, …] }.', 400);
  }
  try {
    return jsonResponse({ maps: await reorderMaps(poolOrThrow(), order as string[]) });
  } catch (error) {
    return storeErrorResponse(error, 'The maps could not be reordered.');
  }
}

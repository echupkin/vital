// ── /api/activity-maps/:id ──────────────────────────────
//
//   PUT    → replace { name, bbox, settings } at { revision }; the stored map
//            comes back with the next revision.
//   DELETE → ?revision=N removes the map.
//
// A write naming a stale revision is refused with 409 rather than overwriting a
// change made in another tab.

import { deleteMap, poolOrThrow, updateMap } from '@/lib/db/activity-maps-store';
import { validateMapInput } from '@/lib/activity-maps/types';
import { errorResponse, jsonResponse, readBody, revisionOf, storeErrorResponse } from '@/lib/activity-maps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const read = await readBody(request);
  if (!read.ok) return read.response;
  const input = validateMapInput(read.body);
  if (!input.ok) return errorResponse(input.errors.join(' '), 400);
  const revision = revisionOf((read.body as { revision?: unknown }).revision);
  if (revision === null) return errorResponse('revision must be the whole revision the change was based on.', 400);
  try {
    return jsonResponse({ map: await updateMap(poolOrThrow(), id, input.value, revision) });
  } catch (error) {
    return storeErrorResponse(error, 'The map could not be saved.');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revision = revisionOf(new URL(request.url).searchParams.get('revision'));
  if (revision === null) return errorResponse('revision must be the whole revision the delete was based on.', 400);
  try {
    await deleteMap(poolOrThrow(), id, revision);
    return jsonResponse({ deleted: id });
  } catch (error) {
    return storeErrorResponse(error, 'The map could not be deleted.');
  }
}

// ── /api/activity-coverage ──────────────────────────────
//
//   GET ?south&west&north&east [&type=…]* [&range=all|N] [&metric=frequency|heart_rate]
//     → the merged coverage of every workout route inside the box: drawable
//       paths, the colour scale, the activity types present and the highlights.
//
// Stateless, so the add-map dialog can preview a box before it is saved.
//
// SERVER-SIDE ONLY. Routes are read through the HAE adapter (the read token
// never leaves this process) and held in memory; they are never stored or
// logged. A source that is not configured or failed answers 200 with
// `available: false` and the reason in words, never an empty map that would
// read as "you went nowhere". A malformed query is a 400. Private, uncacheable.

import { parseCoverageRequest, readCoverage } from '@/lib/activity-maps/service';
import { errorResponse, jsonResponse } from '@/lib/activity-maps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const parsed = parseCoverageRequest(new URL(request.url).searchParams);
  if (typeof parsed === 'string') return errorResponse(parsed, 400);
  return jsonResponse(await readCoverage(parsed));
}

// ── /api/pipeline/status (SPEC §10) ─────────────────────
//
// Server-only route. It reads the stored (encrypted) Health Auto Export
// connection, probes the API only when connected, and
// reports each pipeline stage honestly. The key never leaves the server, and a
// failed live check is surfaced as an explicit state rather than replaced with
// demo data.
//
//   GET                       → the full report, every part checked at once.
//   GET ?part=sources         → the export server and Oura probes.
//   GET ?part=dataset         → the dataset (loaded when cold) and its data-quality stage.
//   GET ?part=workouts        → the workout sources.
//   …&fresh=1                 → "Check again": read the dataset and sync the
//                               workout sources afresh instead of serving the
//                               caches (the probes are always live).
//
// The settings panel asks for the parts separately, so a cold dataset load
// holds up only the stages that depend on it (see `@/lib/pipeline/assemble`).

import { NextResponse } from 'next/server';
import { resolvePart, resolvePipelineStatus } from '@/lib/pipeline/status';
import { PIPELINE_PARTS, type PipelinePart } from '@/lib/pipeline/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Personal health context must never be cached by a shared proxy.
const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const part = params.get('part');
  const fresh = params.get('fresh') === '1';
  if (part === null) {
    return NextResponse.json(await resolvePipelineStatus(), { status: 200, headers: NO_STORE });
  }
  if (!(PIPELINE_PARTS as string[]).includes(part)) {
    return NextResponse.json({ error: `"part" must be one of: ${PIPELINE_PARTS.join(', ')}.` }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json(await resolvePart[part as PipelinePart](fresh ? { fresh } : {}), { status: 200, headers: NO_STORE });
}

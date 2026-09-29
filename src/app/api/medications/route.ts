// ── /api/medications — the windowed medication read ─────────────────────────
//
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
//     → the adapter's windowed read of the Health Auto Export medications
//       endpoint, echoed back with the bounds it was sent with and the span the
//       returned records actually cover.
//
// SERVER-SIDE ONLY. The HAE read token is read from the process environment by
// the adapter and never leaves this process; neither the token nor the upstream
// host ever appears in the response.
//
// WINDOW SEMANTICS (verified against the live source): `from` is inclusive, and
// the upstream `to` is a calendar boundary that EXCLUDES records dated on that
// day. A caller wanting the LAST day D must therefore send `to` = D + 1 day.
// With no `from`/`to` the route defaults to the last 30 days ending today in the
// profile's timezone; see `resolveWindow` in `@/lib/medications/window`. Each
// record's day is attributed in that same zone.
//
// A Next.js route file may export ONLY its handlers and the route segment
// config, so the window resolution and the source label live in that module
// rather than here.
//
// HONESTY. An empty window is an honest empty: 200 with zero records, `covered`
// null and no error. A source that is not configured, or that genuinely failed,
// returns 200 with `available: false` and the reason in words — never a
// fabricated zero, never demo data in its place. A malformed window is a 400.
//
// Nothing is persisted: health data never reaches the database here. The
// response is private and uncacheable.

import { NextResponse } from 'next/server';
import { HaeError } from '@/lib/adapters/hae';
import { loadMedications } from '@/lib/adapters/medications';
import { MEDICATIONS_SOURCE, resolveWindow } from '@/lib/medications/window';
import { readProfile } from '@/lib/profile/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET(request: Request) {
  const { timezone } = await readProfile();
  const window = resolveWindow(new URL(request.url).searchParams, new Date(), timezone);
  if (typeof window === 'string') {
    return NextResponse.json({ error: window }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await loadMedications(window, { timezone });
    return NextResponse.json(
      {
        available: true,
        reason: null,
        window: result.window,
        covered: result.covered,
        records: result.records,
        source: MEDICATIONS_SOURCE,
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (error) {
    // A real failure is reported, never replaced with zeroes or demo data. The
    // adapter's message names no credential and no host.
    const reason =
      error instanceof HaeError
        ? error.message
        : 'The medication records could not be read from the source.';
    return NextResponse.json(
      {
        available: false,
        reason,
        window,
        covered: null,
        records: [],
        source: MEDICATIONS_SOURCE,
      },
      { status: 200, headers: NO_STORE }
    );
  }
}

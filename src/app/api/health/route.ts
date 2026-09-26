// ── /api/health — liveness, and nothing else ────────────
//
// A trivial, always-fast JSON response used by the container HEALTHCHECK.
//
// Why it exists: the healthcheck runs every 30 seconds. Pointed at `/` it
// server-rendered the Overview five thousand-odd times a day, and each render
// read the briefing — which used to be enough to start a generation and probe
// the model. A liveness probe must NOT touch the briefing, the model, the
// dataset or the database: it answers whether the process can serve HTTP at all,
// and that is the whole question it is allowed to answer.
//
// It deliberately does NOT consult Postgres. A database blip must not mark the
// container unhealthy (the app reports a data-source failure on its own
// surfaces; the container should not be restarted for it). Nothing here is
// awaited, nothing is read, nothing is logged.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
  );
}

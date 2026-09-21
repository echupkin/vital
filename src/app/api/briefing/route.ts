// ── /api/briefing (SPEC §5B) ────────────────────────────
//
// The Overview hero's data. Server-side only: the provider configuration, the
// credential and the dataset never leave this process, and the response carries
// the rendered briefing text plus the attribution line that says who wrote it.
//
// GET  — never waits on a model. It serves the briefing written for the current
//        local day (or the previous day's, before the profile's briefing hour),
//        and starts one background generation when today's is due and missing;
//        `pending` tells the browser whether asking again shortly could return a
//        written briefing.
//
// POST — the explicit `Regenerate` control. It replaces the current day's
//        briefing once and returns the replacement, or a 502 stating exactly why
//        the model could not write it (in which case the computed briefing stays
//        on screen). There is no loop here: one request, one generation.
//
// The stored profile is read here (once per request) and injected into the
// briefing, because it decides the day boundary and the greeting and may live in
// Postgres. The briefing engine itself stays synchronous.
//
// Responses are marked private and uncacheable: they are personal health
// context and must not be stored by a shared cache.

import { NextResponse } from 'next/server';
import { readBriefing, regenerateBriefing } from '@/lib/briefing';
import { readProfile } from '@/lib/profile/store';
import type { UnitSystem } from '@/lib/prefs';
import { LiveDataUnavailableError, installDataset } from '@/lib/adapters/runtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

function systemOf(request: Request): UnitSystem {
  return new URL(request.url).searchParams.get('system') === 'imperial' ? 'imperial' : 'metric';
}

/** Read the same dataset the pages are serving. A live failure is reported. */
async function readDataset(): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await installDataset();
    return { ok: true };
  } catch (error) {
    const detail =
      error instanceof LiveDataUnavailableError ? error.detail : 'The dataset could not be loaded.';
    return { ok: false, detail };
  }
}

export async function GET(request: Request) {
  const system = systemOf(request);
  const dataset = await readDataset();
  if (!dataset.ok) {
    return NextResponse.json(
      { error: `The briefing cannot read the health data source: ${dataset.detail}` },
      { status: 503, headers: NO_STORE }
    );
  }
  const profile = await readProfile();
  return NextResponse.json(readBriefing({ system, profile }), { status: 200, headers: NO_STORE });
}

export async function POST(request: Request) {
  const system = systemOf(request);
  const dataset = await readDataset();
  if (!dataset.ok) {
    return NextResponse.json(
      { error: `The briefing cannot read the health data source: ${dataset.detail}` },
      { status: 503, headers: NO_STORE }
    );
  }

  const profile = await readProfile();

  try {
    return NextResponse.json(await regenerateBriefing({ system, profile }), { status: 200, headers: NO_STORE });
  } catch (error) {
    // The day is left uncached, so the next read serves the computed briefing
    // with this reason attached. Nothing is retried here.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The briefing could not be regenerated.' },
      { status: 502, headers: NO_STORE }
    );
  }
}

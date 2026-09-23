// ── /api/profile (SPEC §7, §11) ─────────────────────────
//
// The single server-side owner of the profile. Both the server-rendered
// greeting and the briefing read the same record, so the app's name, timezone
// and briefing hour cannot disagree between surfaces or between browsers.
//
// The record lives in Postgres when a database is configured, and in
// ./data/profile.json when it is not — `@/lib/profile/store` decides, and this
// route does not care which.
//
// The response body IS the profile and nothing else — no path, no timestamp, no
// environment echo. There is no secret field to leak: the profile holds a name,
// a birth date, the person's sex, a short note, a timezone and an hour.
//
//   GET  → the stored profile, or the documented defaults when nothing is stored
//   PUT  → validate, replace the whole record, return what was stored
//
// Validation rejects unknown fields, checks every type, bounds every string and
// requires an IANA timezone and a whole briefing hour. `sex` is a closed set —
// `"male"`, `"female"` or `null` — and is refused otherwise rather than coerced.
// A rejected body changes nothing anywhere.
//
// On concurrency: the profile PUT replaces the whole record and carries no
// client revision, so there is no 409 here. The database still bumps `revision`
// on every write (`@/lib/db/profile-store`), and the revision/409 guard lives on
// the preferences route, which is where a stale write is refused. Adding a
// second, different token to this route would be a new contract, not a fix.
//
// A configured store that cannot be read (database unreachable, configuration
// invalid) answers 500 with the reason: reporting a read failure as "the profile"
// would quietly show different settings than the ones that are stored.
//
// Responses are private and uncacheable: this is the person's own configuration.

import { NextResponse } from 'next/server';
import { readProfile, readProfileState, writeProfile } from '@/lib/profile/store';
import { validateProfileInput } from '@/lib/profile/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const state = await readProfileState();
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(state.profile, { status: 200, headers: NO_STORE });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'The request body must be JSON.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const validated = validateProfileInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join(' ') }, { status: 400, headers: NO_STORE });
  }

  try {
    await writeProfile(validated.profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The profile could not be saved.' },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json(await readProfile(), { status: 200, headers: NO_STORE });
}

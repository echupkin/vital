// ── /api/preferences (SPEC §7, §11) ─────────────────────
//
// The single server-side owner of the display preferences: theme, units and the
// notification flags. One person's settings follow them between browsers and
// devices instead of being trapped in one browser's localStorage.
//
// The record lives in Postgres — `@/lib/prefs/store` decides how it is served,
// and this route does not care.
//
// The response body IS the record and nothing else — no path, no environment
// echo, no secret. The record has no secret field: it holds a theme, a unit
// system, three booleans, and the server's own revision and timestamp.
//
//   GET  → the stored record, or the documented defaults at revision 0 when
//          nothing is stored. A revision of 0 means "nothing has been written
//          yet", which is also what lets the browser import a legacy
//          localStorage value exactly once.
//   PUT  → validate, replace the whole record, bump `revision` and return what
//          was stored. The body must carry the client's last-seen `revision`:
//          a stale write is refused with 409 and the current server copy, so a
//          second device can never silently clobber a newer value.
//
// Validation rejects unknown fields, checks every type and requires a whole,
// non-negative revision. A rejected body changes nothing anywhere.
//
// A configured store that cannot be read answers 500 with the reason rather than
// serving defaults: defaults would look to the reader like their settings had
// been reset, which is a worse lie than an error.
//
// Responses are private and uncacheable: this is the person's own display
// configuration, exactly as the other personal routes treat theirs.

import { NextResponse } from 'next/server';
import {
  planPreferencesWrite,
  readPreferences,
  readPreferencesState,
  writePreferences,
} from '@/lib/prefs/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const state = await readPreferencesState();
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json(state.preferences, { status: 200, headers: NO_STORE });
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

  const plan = planPreferencesWrite(body);
  if (!plan.ok) {
    return NextResponse.json({ error: plan.errors.join(' ') }, { status: 400, headers: NO_STORE });
  }

  const state = await readPreferencesState();
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: 500, headers: NO_STORE });
  }
  const current = state.preferences;

  if (plan.clientRevision !== current.revision) {
    // The client is writing from a copy that is no longer current. Refuse the
    // write and hand back the server's record so the UI can say what happened
    // and let the reader re-apply, instead of overwriting a newer value.
    return NextResponse.json(
      {
        error: `These settings were changed somewhere else (revision ${current.revision}); this change was based on revision ${plan.clientRevision}. Nothing was saved.`,
        preferences: current,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  let stored;
  try {
    stored = await writePreferences(plan.preferences, current.revision + 1);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The preferences could not be saved.' },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json(stored, { status: 200, headers: NO_STORE });
}

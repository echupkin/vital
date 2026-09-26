// ── Root page (Overview) ──────────────────────────────
//
// The briefing is READ here, during this route's server render, in the bundle
// that serves the browser. It is a pure read: the scheduled writer is the
// briefing scheduler (src/lib/briefing/scheduler.ts), armed just below. An
// automatic generation starts here only for a day the scheduler has not yet
// attempted (a restart after the briefing hour, for instance), and then at most
// once — the day-terminal rule in the briefing store guarantees it.
//
// The call is synchronous and never awaits the model: the hero renders the
// computed briefing and the browser swaps in the written one when the follow-up
// read of `/api/briefing` returns it.
//
// The greeting is computed HERE, on the server, in the profile's timezone and
// against the server clock, and handed to the client component as its initial
// value. That is what makes the first paint correct and hydration clean: the
// server and the client render the same string. It is re-derived on every
// server render (so a client-side navigation or a revalidation picks up a new
// hour or a new name) and refreshed on the client as the clock moves.
//
// The stored profile is read once here and handed to both the greeting and the
// briefing read, so the two cannot disagree about the day or the person. The
// read is awaitable because the profile may live in Postgres.

import { OverviewPage } from '@/components/metric/OverviewPage';
import { readBriefing } from '@/lib/briefing';
import { ensureBriefingScheduler } from '@/lib/briefing/scheduler';
import { readProfile } from '@/lib/profile/store';
import { greetingLine } from '@/lib/profile/types';
import { readPreferences } from '@/lib/prefs/store';
import type { UnitSystem } from '@/lib/prefs/types';

export default async function Home() {
  const profile = await readProfile();
  // The cache key includes the unit system: reading 'metric' for a reader who
  // uses imperial primed a briefing they would never be served, and their own
  // copy was written lazily on their first visit instead of on schedule.
  const prefs = await readPreferences().catch(() => null);
  const system: UnitSystem = prefs?.units === 'imperial' ? 'imperial' : 'metric';
  // A pure read: it serves the day's written briefing, or the computed one while
  // the scheduler (or a catch-up attempt for a day the scheduler has not yet
  // touched) writes it. It never originates a generation on its own.
  readBriefing({ system, profile });
  // Writes the briefing AT the configured hour rather than only when someone
  // happens to visit afterwards. Armed here, in the bundle that serves requests
  // (the instrumentation hook runs in a separate module graph — see the note in
  // ./index), and the container's healthcheck now hits /api/health, so the timer
  // is armed by the first request that reaches this route.
  ensureBriefingScheduler(profile);
  const now = new Date();
  return <OverviewPage initialGreeting={greetingLine(profile.name, now, profile.timezone)} />;
}

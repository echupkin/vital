// ── Root page (Overview) ──────────────────────────────
//
// The briefing generation is kicked here, during this route's server render, so
// it runs in the bundle that serves the browser (see src/lib/briefing/kick.ts —
// the instrumentation hook's module graph is a different one). The call is
// synchronous and never awaits the model: the hero renders the computed briefing
// and the browser swaps in the written one when the follow-up read returns it.
//
// The greeting is computed HERE, on the server, in the profile's timezone and
// against the server clock, and handed to the client component as its initial
// value. That is what makes the first paint correct and hydration clean: the
// server and the client render the same string. It is re-derived on every
// server render (so a client-side navigation or a revalidation picks up a new
// hour or a new name) and refreshed on the client as the clock moves.
//
// The stored profile is read once here and handed to both the greeting and the
// briefing kick, so the two cannot disagree about the day or the person. The
// read is awaitable because the profile may live in Postgres.

import { OverviewPage } from '@/components/metric/OverviewPage';
import { kickBriefing } from '@/lib/briefing/kick';
import { ensureBriefingScheduler } from '@/lib/briefing/scheduler';
import { readProfile } from '@/lib/profile/store';
import { greetingLine } from '@/lib/profile/types';
import { readPreferences } from '@/lib/prefs/store';
import type { UnitSystem } from '@/lib/prefs/types';

export default async function Home() {
  const profile = await readProfile();
  // The cache key includes the unit system: kicking 'metric' for a reader who
  // uses imperial primed a briefing they would never be served, and their own
  // copy was written lazily on their first visit instead of on schedule.
  const prefs = await readPreferences().catch(() => null);
  const system: UnitSystem = prefs?.units === 'imperial' ? 'imperial' : 'metric';
  kickBriefing(system, profile);
  // Writes the briefing AT the configured hour rather than only when someone
  // happens to visit afterwards. Armed here, in the bundle that serves requests
  // (the instrumentation hook runs in a separate module graph — see ./kick), and
  // the container's healthcheck hits this route every 30 seconds, so the timer is
  // armed from shortly after startup.
  ensureBriefingScheduler(profile);
  const now = new Date();
  return <OverviewPage initialGreeting={greetingLine(profile.name, now, profile.timezone)} />;
}

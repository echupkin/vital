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
import { readProfile } from '@/lib/profile/store';
import { greetingLine } from '@/lib/profile/types';

export default async function Home() {
  const profile = await readProfile();
  kickBriefing('metric', profile);
  const now = new Date();
  return <OverviewPage initialGreeting={greetingLine(profile.name, now, profile.timezone)} />;
}

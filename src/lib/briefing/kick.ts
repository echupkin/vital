// ── Briefing kick (server-only) ─────────────────────────
//
// Starts today's generation on the bundle that actually serves the browser.
//
// Why this exists rather than relying on the instrumentation warm-up: Next.js
// runs the instrumentation hook in its own module graph, so a cache filled there
// is NOT the cache a route handler reads. Measured, not assumed: a boot warm-up
// that logged a successful 76 s generation left `/api/briefing` still reporting
// a cold cache and starting its own generation. For the same reason the live
// dataset warm-up only appears to help — the container healthcheck's own GET /
// is what warms the serving bundle in practice.
//
// So the Overview route kicks the generation during its server render. It never
// awaits it: `readBriefing` is synchronous, returns the computed briefing, and
// leaves one generation running in the background. The browser's follow-up reads
// of `/api/briefing` land in the same bundle and collect the result.
//
// The stored profile is passed IN rather than read here: it may live in Postgres
// (an async read), and this function must stay synchronous so the hero never
// waits. The caller reads it once per request and hands it over, so the greeting
// and the briefing always agree about the day and the person.

import { readBriefing } from './index';
import type { UnitSystem } from '../prefs';
import type { VitalProfile } from '../profile/types';
import type { BriefingView } from './types';

/**
 * Start (or join) today's briefing generation without waiting for it.
 *
 * Returns the view for this instant — the cached briefing, or the computed one —
 * for a caller that wants it. The Overview ignores the return value: its hero
 * renders the computed briefing server-side and the browser swaps in the written
 * one when it arrives.
 */
export function kickBriefing(system: UnitSystem = 'metric', profile?: VitalProfile): BriefingView {
  return readBriefing({ system, profile });
}

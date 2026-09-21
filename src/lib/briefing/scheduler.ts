// ── Briefing scheduler (server-only) ────────────────────
//
// Writes each day's briefing AT the profile's configured hour, instead of
// waiting for the first visit afterwards.
//
// Why it has to be armed from here rather than from `instrumentation.ts`: that
// hook runs in its own module graph, so a briefing written there is not the one
// the routes read (see the note in ./kick). This module is imported by the
// Overview route, which is the bundle that actually answers requests — and the
// container's healthcheck GETs `/` every 30 seconds, so the timer is armed from
// shortly after startup without anyone opening the app.
//
// Honest limits, stated rather than hidden:
//   * the process must be running at the hour. If the container was down at
//     08:00, nothing is written then; the first request after it comes back
//     writes that day's briefing, and the hero labels the late write.
//   * this is one timer per process. With more than one replica, each would arm
//     its own; the day-keyed cache and Postgres row make the write idempotent, so
//     the worst case is a duplicate attempt, not a duplicate briefing.
//
// A profile change (hour, timezone) is picked up on the next firing: the profile
// is re-read before each write, so the schedule follows the setting.

import { readProfile } from '../profile/store';
import type { VitalProfile } from '../profile/types';
import { warmBriefing } from './index';
import { briefingInstant, nextBriefingAt } from './schedule';

/** setTimeout is fine for a day; this is the Node maximum, used as a guard. */
const MAX_DELAY_MS = 2_147_483_647;

interface Armed {
  timer: NodeJS.Timeout;
  /** The instant this timer is aiming at, so a re-arm only happens when it moves. */
  targetAt: number;
}

let armed: Armed | null = null;
let lastRunAt: string | null = null;

function log(message: string): void {
  console.log(`[vital-briefing] ${message}`);
}

/** Test seam: forget the timer and the last-run stamp. */
export function resetBriefingSchedulerForTests(): void {
  if (armed) clearTimeout(armed.timer);
  armed = null;
  lastRunAt = null;
}

/** What the scheduler is currently aiming at, for the pipeline/report surfaces. */
export function briefingSchedulerState(): { armed: boolean; targetAt: number | null; lastRunAt: string | null } {
  return { armed: armed !== null, targetAt: armed?.targetAt ?? null, lastRunAt };
}

async function fire(): Promise<void> {
  armed = null;
  lastRunAt = new Date().toISOString();
  let profile: VitalProfile;
  try {
    // Re-read: the hour or the timezone may have changed since this was armed.
    profile = await readProfile();
  } catch (error) {
    log(`could not read the profile, so this run is skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
    return;
  }

  try {
    const outcome = await warmBriefing({ profile });
    log(
      outcome.ok
        ? `wrote the briefing at the configured hour (${outcome.engine}${outcome.model ? `, ${outcome.model}` : ''}).`
        : `could not write the briefing at the configured hour: ${outcome.reason ?? 'unknown reason'}. ` +
          'The next request will retry, and the hero reports the computed briefing in the meantime.'
    );
  } catch (error) {
    // A generation failure must never take the process down or stop the schedule:
    // the next day's run still has to be armed.
    log(`the scheduled write failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  // Arm the next day using the profile as it is now.
  try {
    arm(await readProfile());
  } catch {
    // If the profile cannot be read, keep going with the one we have.
    arm(profile);
  }
}

function arm(profile: VitalProfile): void {
  const targetAt = nextBriefingAt(profile);
  if (!Number.isFinite(targetAt)) return;
  if (armed && armed.targetAt === targetAt) return; // already aiming there
  if (armed) clearTimeout(armed.timer);
  const delay = Math.min(Math.max(targetAt - Date.now(), 0), MAX_DELAY_MS);
  const timer = setTimeout(() => {
    void fire();
  }, delay);
  // The timer must not hold the process open on its own.
  if (typeof timer.unref === 'function') timer.unref();
  armed = { timer, targetAt };
  log(
    `next briefing scheduled for ${new Date(targetAt).toISOString()} ` +
      `(${profile.timezone}, hour ${profile.briefingHour}), in ${Math.round(delay / 60000)} min.`
  );
}

/**
 * Make sure a timer is aiming at the next configured hour. Cheap and idempotent:
 * call it from a request path on every render.
 */
export function ensureBriefingScheduler(profile: VitalProfile): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    arm(profile);
  } catch (error) {
    // Scheduling is a background convenience: never fail a page render for it.
    log(`could not arm the scheduler: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

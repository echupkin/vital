// ── Today's briefing: the day schedule ───────────────────
//
// Which local calendar day the briefing belongs to, and whether a new one may
// be written yet. Deliberately free of any server dependency: the client uses
// the same function to label the hero, so the label and the cache key can never
// disagree about what day it is.
//
// One day's briefing is written once, at/after the profile's briefing hour, on
// the first request. Before that hour the PREVIOUS day's briefing is the current
// one — today's has not been written yet and must not be written early.

import { addDays, dayKey } from '../analytics/windows';
import { localHour, type VitalProfile } from '../profile/types';

export interface BriefingSchedule {
  /** The local day (profile timezone) this briefing is for, and is labelled with. */
  coversDay: string;
  /** Today's local day key. */
  todayKey: string;
  /** True once the profile's briefing hour has passed today. */
  allowed: boolean;
  /** The profile's briefing hour (0–23). */
  hour: number;
  /** The local hour right now. */
  hourNow: number;
}

export function briefingSchedule(profile: VitalProfile, now: Date = new Date()): BriefingSchedule {
  const todayKey = dayKey(now, profile.timezone);
  const hourNow = localHour(now, profile.timezone);
  const allowed = hourNow >= profile.briefingHour;
  return {
    coversDay: allowed ? todayKey : addDays(todayKey, -1),
    todayKey,
    allowed,
    hour: profile.briefingHour,
    hourNow,
  };
}

/** Local wall-clock label for the instant a briefing was written ("06:12"). */
export function briefingTimeLabel(iso: string, timezone: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return 'unknown';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(parsed));
  const hh = parts.find(p => p.type === 'hour')?.value ?? '00';
  const mm = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

// ── When the next briefing is due ───────────────────────
//
// The scheduler (./scheduler) writes the briefing AT the configured hour rather
// than waiting for the first visit afterwards, so it needs the instant, not the
// hour number. Converting a local wall-clock time in a named zone to an instant
// is the part that goes wrong around daylight-saving changes, so it is done here,
// once, and tested.

/**
 * Minutes east of UTC for a zone at an instant.
 *
 * Derived by formatting the instant in the target zone and reading the fields
 * back as if they were UTC: the difference is the offset.
 */
function zoneOffsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return (asUtc - at.getTime()) / 60000;
}

/**
 * The instant of `hour` o'clock local time on a local calendar day.
 *
 * The offset is applied twice: the first pass lands near the answer, the second
 * corrects for a daylight-saving change that the first pass crossed. A local time
 * that does not exist (the spring-forward hour) resolves to the following
 * instant, which is the honest behaviour — no briefing is silently skipped.
 */
export function briefingInstant(dayKeyString: string, hour: number, timezone: string): number {
  const naive = Date.parse(`${dayKeyString}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(naive)) return NaN;
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = zoneOffsetMinutes(timezone, new Date(guess));
    guess = naive - offset * 60000;
  }
  return guess;
}

/** The next instant a briefing is due for this profile (strictly after `now`). */
export function nextBriefingAt(profile: VitalProfile, now: Date = new Date()): number {
  const today = dayKey(now, profile.timezone);
  const todayAt = briefingInstant(today, profile.briefingHour, profile.timezone);
  if (Number.isFinite(todayAt) && todayAt > now.getTime()) return todayAt;
  return briefingInstant(addDays(today, 1), profile.briefingHour, profile.timezone);
}

/** Milliseconds until the next briefing is due. Never negative. */
export function msUntilNextBriefing(profile: VitalProfile, now: Date = new Date()): number {
  return Math.max(0, nextBriefingAt(profile, now) - now.getTime());
}

/**
 * Was this briefing written later than the configured hour?
 *
 * Used to label the hero honestly. A briefing written by the scheduler lands on
 * the hour; one written after a restart, or while the process was down at the
 * hour, is a catch-up write and says so rather than looking like the schedule
 * ran correctly.
 */
export function briefingWrittenLate(
  generatedAt: string,
  hour: number,
  timezone: string,
  toleranceMinutes = 5
): boolean {
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(parsed));
  const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm > hour * 60 + toleranceMinutes;
}

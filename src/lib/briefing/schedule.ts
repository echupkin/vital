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

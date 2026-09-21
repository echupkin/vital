// ── Profile: shared types and pure rules ────────────────
//
// The profile is the small set of facts Vital knows about the person that the
// health report cannot contain: a display name, a date of birth, a short note,
// the timezone the app's calendar days are cut on, and the hour a new briefing
// may be written.
//
// It is OWNED BY THE SERVER and stored as JSON on a writable volume
// (`./data/profile.json` → `/app/data/profile.json`; see `store.ts`). Both the
// server-rendered greeting and the (server-side) briefing read it, so it is not
// tied to one browser.
//
// This module has NO imports, so the browser can use the types, the greeting
// rules and the validator without pulling the filesystem store into the bundle.
//
// Nothing secret belongs here. There is no field for a credential, a token or a
// health record, and the route that serves this shape returns nothing else.

import { addDays, dayKey } from '../analytics/windows';

export interface VitalProfile {
  /**
   * Display name. `null` when unset — every consumer falls back to its neutral
   * form rather than to a literal name.
   */
  name: string | null;
  /** ISO calendar date (`YYYY-MM-DD`) of birth, or `null`. */
  dateOfBirth: string | null;
  /**
   * Free text for context the health report cannot carry (a training goal, a
   * medication that affects heart rate). Treated as UNTRUSTED DATA by every
   * prompt that receives it — never as instructions.
   */
  notes: string | null;
  /** IANA timezone. The single source of truth for the app's calendar days. */
  timezone: string;
  /** Local hour (0–23) at/after which a new briefing may be written. */
  briefingHour: number;
}

/** The fields a profile may contain. Anything else is rejected by the route. */
export const PROFILE_FIELDS = ['name', 'dateOfBirth', 'notes', 'timezone', 'briefingHour'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const PROFILE_NAME_MAX = 80;
export const PROFILE_NOTES_MAX = 500;

/** Default hour a new briefing is allowed to be written. */
export const DEFAULT_BRIEFING_HOUR = 6;
/** Fallback timezone when the profile has none and no environment override. */
export const DEFAULT_PROFILE_TIMEZONE = 'America/Chicago';

/** Where the profile lives on the host and in the container (documented copy). */
export const PROFILE_HOST_PATH = './data/profile.json';
export const PROFILE_CONTAINER_PATH = '/app/data/profile.json';

export function defaultProfile(timezone: string = DEFAULT_PROFILE_TIMEZONE): VitalProfile {
  return {
    name: null,
    dateOfBirth: null,
    notes: null,
    timezone,
    briefingHour: DEFAULT_BRIEFING_HOUR,
  };
}

// ── Validation ──────────────────────────────────────────

export interface ProfileValidationOk {
  ok: true;
  profile: VitalProfile;
}

export interface ProfileValidationErr {
  ok: false;
  errors: string[];
}

/** True when `tz` is an IANA zone this runtime recognises. */
export function isTimezone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** True when `value` is a real `YYYY-MM-DD` calendar date. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Today's calendar day in a timezone, as a `YYYY-MM-DD` key. */
export function todayKeyIn(timezone: string, now: Date = new Date()): string {
  return dayKey(now, timezone);
}

function optionalString(
  body: Record<string, unknown>,
  field: 'name' | 'dateOfBirth' | 'notes',
  max: number,
  errors: string[]
): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors.push(`"${field}" must be a string or null.`);
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    errors.push(`"${field}" must be ${max} characters or fewer (received ${trimmed.length}).`);
    return null;
  }
  return trimmed;
}

/**
 * Validate an incoming profile body.
 *
 * Rejects unknown fields rather than silently dropping them, validates every
 * type, bounds every string, and returns a complete profile — so a PUT always
 * replaces the whole record and no field can be left in a half-written state.
 */
export function validateProfileInput(raw: unknown, now: Date = new Date()): ProfileValidationOk | ProfileValidationErr {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The request body must be a JSON object.'] };
  }
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const unknown = Object.keys(body).filter(key => !(PROFILE_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    errors.push(`Unknown field(s): ${unknown.join(', ')}. Allowed fields are ${PROFILE_FIELDS.join(', ')}.`);
  }

  const name = optionalString(body, 'name', PROFILE_NAME_MAX, errors);

  const dateOfBirth = optionalString(body, 'dateOfBirth', 10, errors);
  if (dateOfBirth !== null) {
    if (!isCalendarDate(dateOfBirth)) {
      errors.push('"dateOfBirth" must be a real calendar date in YYYY-MM-DD form.');
    } else if (dateOfBirth > dayKey(now, 'UTC')) {
      errors.push('"dateOfBirth" must not be in the future.');
    }
  }

  const notes = optionalString(body, 'notes', PROFILE_NOTES_MAX, errors);

  const rawTimezone = body.timezone;
  let timezone = DEFAULT_PROFILE_TIMEZONE;
  if (rawTimezone === undefined) {
    errors.push('"timezone" is required.');
  } else if (typeof rawTimezone !== 'string' || !isTimezone(rawTimezone.trim())) {
    errors.push('"timezone" must be an IANA timezone name (for example America/Chicago).');
  } else {
    timezone = rawTimezone.trim();
  }

  const rawHour = body.briefingHour;
  let briefingHour = DEFAULT_BRIEFING_HOUR;
  if (rawHour === undefined) {
    errors.push('"briefingHour" is required.');
  } else if (typeof rawHour !== 'number' || !Number.isInteger(rawHour) || rawHour < 0 || rawHour > 23) {
    errors.push('"briefingHour" must be a whole hour between 0 and 23.');
  } else {
    briefingHour = rawHour;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, profile: { name, dateOfBirth, notes, timezone, briefingHour } };
}

// ── Greeting ────────────────────────────────────────────
//
// ONE band scheme, used by every greeting in the app (the Overview headline and
// any other surface that greets by time of day):
//
//     05:00–11:59  morning
//     12:00–16:59  afternoon
//     17:00–04:59  evening
//
// 04:59 is therefore still evening, which is the honest reading of a late night.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export const MORNING_START_HOUR = 5;
export const AFTERNOON_START_HOUR = 12;
export const EVENING_START_HOUR = 17;

export function timeOfDayAt(hour: number): TimeOfDay {
  if (hour >= MORNING_START_HOUR && hour < AFTERNOON_START_HOUR) return 'morning';
  if (hour >= AFTERNOON_START_HOUR && hour < EVENING_START_HOUR) return 'afternoon';
  return 'evening';
}

/** The hour (0–23) of an instant, evaluated in a timezone. */
export function localHour(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  return Number.isFinite(hour) ? hour % 24 : 0;
}

export function timeOfDay(instant: Date, timezone: string): TimeOfDay {
  return timeOfDayAt(localHour(instant, timezone));
}

const GREETING_WORD: Record<TimeOfDay, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
};

/**
 * The greeting line for an instant, in the profile's timezone.
 *
 * With no name it greets without one (`Good evening`) rather than inventing or
 * defaulting to a literal name.
 */
export function greetingLine(name: string | null, instant: Date, timezone: string): string {
  const word = GREETING_WORD[timeOfDay(instant, timezone)];
  const trimmed = name?.trim();
  return trimmed ? `${word}, ${trimmed}` : word;
}

/** Up to two initials for an avatar, or `null` when there is no name. */
export function initialsOf(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(w => w[0]!.toUpperCase());
  return letters.join('');
}

/** Whole years from a date of birth to `now`, or `null` when there is none. */
export function ageInYears(dateOfBirth: string | null, now: Date = new Date()): number | null {
  if (!dateOfBirth || !isCalendarDate(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const today = dayKey(now, 'UTC');
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * The same day, one day earlier. Re-exported here so callers of the briefing
 * schedule do not need to reach into the analytics module.
 */
export function previousDay(key: string): string {
  return addDays(key, -1);
}

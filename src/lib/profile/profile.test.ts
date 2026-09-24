// ── The profile: validation, greeting bands and the store ──
//
// The profile is server-owned state, so these tests care about three things:
// what the route will accept, what the greeting says (and does not say) at each
// hour, and that an unconfigured store reports a clear reason instead of
// writing to a file or crashing.

import { describe, expect, it } from 'vitest';
import {
  PROFILE_NAME_MAX,
  PROFILE_NOTES_MAX,
  ageInYears,
  defaultProfile,
  greetingLine,
  initialsOf,
  isCalendarDate,
  isTimezone,
  localHour,
  timeOfDay,
  timeOfDayAt,
  validateProfileInput,
} from '@/lib/profile/types';
import { readProfile, readProfileState, writeProfile } from '@/lib/profile/store';
import { NO_DATABASE_CONFIGURED_REASON } from '@/lib/db/backend';

/** An environment with no database configured: there is no file fallback. */
const NO_DB_ENV = {} as NodeJS.ProcessEnv;

describe('greeting by time of day', () => {
  it('uses one band scheme everywhere (05–11:59 morning, 12–16:59 afternoon, 17–04:59 evening)', () => {
    expect(timeOfDayAt(4)).toBe('evening');
    expect(timeOfDayAt(5)).toBe('morning');
    expect(timeOfDayAt(11)).toBe('morning');
    expect(timeOfDayAt(12)).toBe('afternoon');
    expect(timeOfDayAt(16)).toBe('afternoon');
    expect(timeOfDayAt(17)).toBe('evening');
    expect(timeOfDayAt(23)).toBe('evening');
    expect(timeOfDayAt(0)).toBe('evening');
  });

  it('reads the clock in the profile timezone, not the server default', () => {
    // 02:00 UTC is 21:00 the previous evening in Chicago.
    const instant = new Date('2026-09-18T02:00:00.000Z');
    expect(localHour(instant, 'UTC')).toBe(2);
    expect(timeOfDay(instant, 'UTC')).toBe('evening');
    expect(localHour(instant, 'America/Chicago')).toBe(21);
    expect(timeOfDay(instant, 'America/Chicago')).toBe('evening');

    // 13:00 UTC is 08:00 in Chicago: morning there, afternoon in UTC.
    const mid = new Date('2026-09-18T13:00:00.000Z');
    expect(timeOfDay(mid, 'America/Chicago')).toBe('morning');
    expect(timeOfDay(mid, 'UTC')).toBe('afternoon');
  });

  it('greets with the configured name, and without one when there is none', () => {
    const morning = new Date('2026-09-18T13:00:00.000Z'); // 08:00 Chicago
    const evening = new Date('2026-09-18T23:00:00.000Z'); // 18:00 Chicago
    expect(greetingLine('Avery', morning, 'America/Chicago')).toBe('Good morning, Avery');
    expect(greetingLine('Avery', evening, 'America/Chicago')).toBe('Good evening, Avery');
    // No name: greet without one — never a literal, never an invented default.
    expect(greetingLine(null, morning, 'America/Chicago')).toBe('Good morning');
    expect(greetingLine('   ', evening, 'America/Chicago')).toBe('Good evening');
  });

  it('derives avatar initials from the name, or nothing at all', () => {
    expect(initialsOf('Avery')).toBe('A');
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('  ada   lovelace  byron ')).toBe('AL');
    expect(initialsOf(null)).toBeNull();
    expect(initialsOf('  ')).toBeNull();
  });

  it('derives an age from a date of birth, or null', () => {
    expect(ageInYears('1990-01-01', new Date('2026-01-01T12:00:00.000Z'))).toBe(36);
    expect(ageInYears('1990-06-15', new Date('2026-01-01T12:00:00.000Z'))).toBe(35);
    expect(ageInYears(null)).toBeNull();
    expect(ageInYears('not-a-date')).toBeNull();
  });
});

describe('profile validation', () => {
  const valid = {
    name: 'Avery',
    dateOfBirth: '1985-04-12',
    sex: null,
    notes: 'Training for a half marathon.',
    timezone: 'America/Chicago',
    briefingHour: 6,
  };

  it('accepts a complete profile and normalises blanks to null', () => {
    const result = validateProfileInput(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profile).toEqual(valid);

    const blank = validateProfileInput({ ...valid, name: '   ', notes: '' });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.profile.name).toBeNull();
    if (blank.ok) expect(blank.profile.notes).toBeNull();
  });

  it('accepts only male, female or null for sex, and rejects everything else', () => {
    for (const sex of ['male', 'female', null] as const) {
      const accepted = validateProfileInput({ ...valid, sex });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.profile.sex).toBe(sex);
    }
    // A missing key is "not set", never a default.
    const missing = validateProfileInput({ ...valid, sex: undefined });
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.profile.sex).toBeNull();

    // Anything else is refused rather than coerced — including a near miss.
    for (const junk of ['MALE', 'Male', 'other', 'unknown', 'm', '', 0, 1, true, {}, [], 'nonbinary']) {
      const rejected = validateProfileInput({ ...valid, sex: junk });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.errors.join(' ')).toMatch(/"sex" must be/);
    }
  });

  it('rejects unknown fields instead of dropping them silently', () => {
    const result = validateProfileInput({ ...valid, apiKey: 'sk-nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Unknown field\(s\): apiKey/);
  });

  it('rejects non-objects', () => {
    for (const bad of [null, 'string', 42, []]) {
      expect(validateProfileInput(bad).ok).toBe(false);
    }
  });

  it('bounds string lengths', () => {
    const tooLong = validateProfileInput({ ...valid, name: 'x'.repeat(PROFILE_NAME_MAX + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.join(' ')).toMatch(/80 characters or fewer/);

    const notes = validateProfileInput({ ...valid, notes: 'y'.repeat(PROFILE_NOTES_MAX + 1) });
    expect(notes.ok).toBe(false);
  });

  it('checks types and the timezone / hour ranges', () => {
    expect(validateProfileInput({ ...valid, name: 5 }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, timezone: 'Mars/Olympus' }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, timezone: '' }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, briefingHour: 24 }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, briefingHour: -1 }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, briefingHour: 6.5 }).ok).toBe(false);
    expect(validateProfileInput({ ...valid, briefingHour: 0 }).ok).toBe(true);
    expect(validateProfileInput({ ...valid, briefingHour: 23 }).ok).toBe(true);
  });

  it('requires a real calendar date of birth that is not in the future', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(validateProfileInput({ ...valid, dateOfBirth: '12/04/1985' }).ok).toBe(false);
    const future = validateProfileInput({ ...valid, dateOfBirth: '2999-01-01' });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors.join(' ')).toMatch(/future/);
  });

  it('recognises IANA timezones', () => {
    expect(isTimezone('America/Chicago')).toBe(true);
    expect(isTimezone('UTC')).toBe(true);
    expect(isTimezone('Not/AZone')).toBe(false);
  });
});

describe('the profile store — Postgres is the only backend', () => {
  it('reports the reason, and uses no file, when no database is configured', async () => {
    const state = await readProfileState(NO_DB_ENV);
    expect(state.backend).toBe('postgres');
    expect(state.stored).toBe(false);
    expect(state.profile).toEqual(defaultProfile());
    // Never a literal name.
    expect(state.profile.name).toBeNull();
    // The actionable reason — not a silent fallback to a file.
    expect(state.error).toBe(NO_DATABASE_CONFIGURED_REASON);
  });

  it('serves the documented defaults from readProfile, never a crash', async () => {
    expect(await readProfile(NO_DB_ENV)).toEqual(defaultProfile());
  });

  it('throws with the reason when there is no database to write to', async () => {
    await expect(writeProfile(defaultProfile(), NO_DB_ENV)).rejects.toThrow(
      /No Postgres database is configured/
    );
    await expect(writeProfile(defaultProfile(), NO_DB_ENV)).rejects.toThrow(/VITAL_PG_/);
  });
});

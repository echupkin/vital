// ── The profile: validation, greeting bands and the store ──
//
// The profile is server-owned state, so these tests care about three things:
// what the route will accept, what the greeting says (and does not say) at each
// hour, and that a missing or corrupt file degrades to defaults instead of
// crashing.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  type VitalProfile,
} from '@/lib/profile/types';
import { profileFilePath, readProfile, readProfileState, writeProfile } from '@/lib/profile/store';

const dirs: string[] = [];
function tempProfileEnv(): { env: NodeJS.ProcessEnv; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vital-profile-'));
  dirs.push(dir);
  const path = join(dir, 'profile.json');
  return { env: { VITAL_PROFILE_PATH: path } as unknown as NodeJS.ProcessEnv, path };
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

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

describe('the profile store', () => {
  it('falls back to documented defaults when no file exists', async () => {
    const { env } = tempProfileEnv();
    const state = await readProfileState(env);
    expect(state.backend).toBe('files');
    expect(state.stored).toBe(false);
    expect(state.error).toBeNull();
    expect(state.profile).toEqual(defaultProfile());
    // Never a literal name.
    expect(state.profile.name).toBeNull();
  });

  it('round-trips a profile through the file', async () => {
    const { env, path } = tempProfileEnv();
    const profile: VitalProfile = {
      name: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      notes: 'Counts things.',
      timezone: 'Europe/London',
      briefingHour: 7,
    };
    await writeProfile(profile, env);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(profile);
    expect(await readProfile(env)).toEqual(profile);
    expect((await readProfileState(env)).stored).toBe(true);
  });

  it('never throws on a corrupt or invalid file, and says why', async () => {
    const { env, path } = tempProfileEnv();
    writeFileSync(path, '{ not json', 'utf8');
    const broken = await readProfileState(env);
    expect(broken.profile).toEqual(defaultProfile());
    expect(broken.stored).toBe(false);
    expect(broken.error).toMatch(/not valid JSON/);

    writeFileSync(path, JSON.stringify({ name: 'x', briefingHour: 99, timezone: 'UTC' }), 'utf8');
    const invalid = await readProfileState(env);
    expect(invalid.profile).toEqual(defaultProfile());
    expect(invalid.error).toMatch(/not a valid profile/);
  });

  it('refuses to write a profile the validator rejects', async () => {
    const { env, path } = tempProfileEnv();
    await expect(
      writeProfile({ ...defaultProfile(), briefingHour: 42 } as VitalProfile, env)
    ).rejects.toThrow(/Refusing to write an invalid profile/);
    expect(existsSync(path)).toBe(false);
  });

  it('reports the writable path it will use', () => {
    const { env, path } = tempProfileEnv();
    expect(profileFilePath(env)).toBe(path);
    expect(profileFilePath({} as NodeJS.ProcessEnv)).toMatch(/data\/profile\.json$/);
  });
});

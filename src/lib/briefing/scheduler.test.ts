// ── The briefing schedule and its scheduler ─────────────
//
// The owner's report that started this: a briefing labelled "written 19:08" when
// the profile says the briefing hour is 08:00. The cause was that generation was
// lazy — the first request after the hour wrote it — so these tests pin down both
// halves of the fix: the instant the briefing is DUE, and the timer that writes it
// without waiting for a visit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const profile = {
  name: null,
  dateOfBirth: null,
  notes: null,
  timezone: 'America/Chicago',
  briefingHour: 8,
};

const warmBriefing = vi.fn(async () => ({ ok: true, model: null, engine: 'computed' as const, latencyMs: 1 }));
const readProfile = vi.fn(async () => profile);

vi.mock('@/lib/briefing/index', () => ({ warmBriefing: () => warmBriefing() }));
vi.mock('@/lib/profile/store', () => ({ readProfile: () => readProfile() }));

import {
  briefingInstant,
  briefingSchedule,
  briefingTimeLabel,
  briefingWrittenLate,
  msUntilNextBriefing,
  nextBriefingAt,
} from './schedule';
import { briefingSchedulerState, ensureBriefingScheduler, resetBriefingSchedulerForTests } from './scheduler';

const HOUR_MS = 3_600_000;

describe('the instant a briefing is due', () => {
  it('is today at the configured hour when that hour is still ahead', () => {
    // 2026-09-21 06:00 local (CDT, UTC-5) — 08:00 today is still to come.
    const now = new Date('2026-09-21T11:00:00Z');
    const at = nextBriefingAt(profile, now);
    expect(new Date(at).toISOString()).toBe('2026-09-21T13:00:00.000Z'); // 08:00 CDT
  });

  it('is tomorrow at the configured hour once today’s has passed', () => {
    // 19:08 local — the exact situation reported: today's hour is long gone.
    const now = new Date('2026-09-21T00:08:00Z'); // 2026-09-20 19:08 CDT
    const at = nextBriefingAt(profile, now);
    expect(new Date(at).toISOString()).toBe('2026-09-21T13:00:00.000Z'); // 08:00 CDT on the 21st
  });

  it('converts the local hour correctly across a daylight-saving change', () => {
    // US DST starts 2026-03-08. The day after, Chicago is UTC-5.
    const afterDst = briefingInstant('2026-03-09', 8, 'America/Chicago');
    expect(new Date(afterDst).toISOString()).toBe('2026-03-09T13:00:00.000Z');
    // And before it, during standard time (UTC-6), 08:00 is 14:00Z.
    const beforeDst = briefingInstant('2026-03-01', 8, 'America/Chicago');
    expect(new Date(beforeDst).toISOString()).toBe('2026-03-01T14:00:00.000Z');
  });

  it('never reports a negative wait', () => {
    const now = new Date('2026-09-21T13:00:00.000Z'); // exactly the hour
    expect(msUntilNextBriefing(profile, now)).toBeGreaterThan(0);
    expect(msUntilNextBriefing(profile, now)).toBeLessThanOrEqual(24 * HOUR_MS + 1);
  });
});

describe('the schedule rule the hero labels with', () => {
  it('is not allowed before the hour, and shows the previous day', () => {
    const schedule = briefingSchedule(profile, new Date('2026-09-21T11:00:00Z')); // 06:00 CDT
    expect(schedule.allowed).toBe(false);
    expect(schedule.coversDay).toBe('2026-09-20');
  });

  it('is allowed after the hour, and covers today', () => {
    const schedule = briefingSchedule(profile, new Date('2026-09-21T14:00:00Z')); // 09:00 CDT
    expect(schedule.allowed).toBe(true);
    expect(schedule.coversDay).toBe('2026-09-21');
  });
});

describe('labelling a late write honestly', () => {
  it('flags a briefing written long after the hour', () => {
    // 19:08 local against an 08:00 hour — the reported case.
    expect(briefingWrittenLate('2026-09-21T00:08:19.277Z', 8, 'America/Chicago')).toBe(true);
    expect(briefingTimeLabel('2026-09-21T00:08:19.277Z', 'America/Chicago')).toBe('19:08');
  });

  it('does not flag a briefing written on the hour', () => {
    expect(briefingWrittenLate('2026-09-21T13:00:30.000Z', 8, 'America/Chicago')).toBe(false);
  });

  it('allows the few minutes a generation takes', () => {
    expect(briefingWrittenLate('2026-09-21T13:04:00.000Z', 8, 'America/Chicago')).toBe(false);
    expect(briefingWrittenLate('2026-09-21T13:07:00.000Z', 8, 'America/Chicago')).toBe(true);
  });
});

describe('the scheduler writes at the hour instead of on the next visit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T20:00:00Z')); // 15:00 CDT on the 20th
    warmBriefing.mockClear();
    resetBriefingSchedulerForTests();
  });

  afterEach(() => {
    resetBriefingSchedulerForTests();
    vi.useRealTimers();
  });

  it('arms a timer aimed at the next configured hour', () => {
    ensureBriefingScheduler(profile);
    const state = briefingSchedulerState();
    expect(state.armed).toBe(true);
    // Next 08:00 CDT is the 21st at 13:00Z.
    expect(new Date(state.targetAt!).toISOString()).toBe('2026-09-21T13:00:00.000Z');
  });

  it('is idempotent: arming twice does not double-schedule', () => {
    ensureBriefingScheduler(profile);
    const first = briefingSchedulerState().targetAt;
    ensureBriefingScheduler(profile);
    expect(briefingSchedulerState().targetAt).toBe(first);
    expect(briefingSchedulerState().armed).toBe(true);
  });

  it('writes the briefing when the hour arrives, with nobody visiting', async () => {
    ensureBriefingScheduler(profile);
    expect(warmBriefing).not.toHaveBeenCalled();

    // 17 hours from 15:00 CDT to 08:00 CDT the next morning. Advance the timer by
    // the real delay and let the async write resolve.
    await vi.advanceTimersByTimeAsync(17 * HOUR_MS);
    expect(warmBriefing).toHaveBeenCalledTimes(1);

    // …and re-arms for the following day rather than firing again.
    await vi.advanceTimersByTimeAsync(23 * HOUR_MS);
    expect(warmBriefing).toHaveBeenCalledTimes(1);
  });

  it('re-arms when the configured hour moves', () => {
    ensureBriefingScheduler(profile);
    const before = briefingSchedulerState().targetAt;
    ensureBriefingScheduler({ ...profile, briefingHour: 6 });
    const after = briefingSchedulerState().targetAt;
    expect(after).not.toBe(before);
    expect(new Date(after!).toISOString()).toBe('2026-09-21T11:00:00.000Z'); // 06:00 CDT
  });
});

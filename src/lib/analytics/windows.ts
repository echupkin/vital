// ── Timezone-aware day arithmetic ───────────────────────
//
// Every window in Vital is a *calendar-day* window in the user's timezone.
// Day keys are plain 'YYYY-MM-DD' strings so that string comparison, sorting,
// and difference math never drift across DST or UTC offsets.

export const FIXTURE_TZ = 'America/Chicago';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** 'YYYY-MM-DD' for an instant, evaluated in the given timezone. */
export function dayKey(input: string | Date, tz: string = FIXTURE_TZ): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return dayFormatter(tz).format(d);
}

/** Parse a day key into a UTC-anchored Date at midday (DST-proof). */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export function addDays(key: string, delta: number): string {
  const d = dayKeyToDate(key);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00.000Z`);
  const db = Date.parse(`${b}T00:00:00.000Z`);
  return Math.round((db - da) / 86400000);
}

/** True when `a` is strictly before `b`. */
export function isBefore(a: string, b: string): boolean {
  return a < b;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Sep 16' — parsed from the day key itself, never through a Date offset. */
export function formatDayKeyShort(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}`;
}

/** 'Sep 16, 2026' */
export function formatDayKeyLong(key: string): string {
  const [y] = key.split('-').map(Number);
  return `${formatDayKeyShort(key)}, ${y}`;
}

/**
 * "Sep 16 '26" — the compact year-bearing form, for an axis tick whose slot is
 * too narrow for `formatDayKeyLong`. A two-digit year is a year; a bare
 * 'Sep 16' is not, and is never used where a year can be shown at all.
 */
export function formatDayKeyCompact(key: string): string {
  const [y] = key.split('-').map(Number);
  const year = Number.isFinite(y) ? String(y).slice(-2).padStart(2, '0') : '--';
  return `${formatDayKeyShort(key)} '${year}`;
}

/** The calendar year of a day key, as text — '2026'. */
export function dayKeyYear(key: string): string {
  return key.slice(0, 4);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(key: string): string {
  return WEEKDAYS[dayKeyToDate(key).getUTCDay()];
}

// ── Windows ────────────────────────────────────────────

export interface DayWindow {
  /** Inclusive first day key. */
  startKey: string;
  /** Inclusive last day key. */
  endKey: string;
  label: string;
}

export function makeWindow(startKey: string, endKey: string, label: string): DayWindow {
  return { startKey, endKey, label };
}

/** The `days`-day window ending on (and including) `endKey`. */
export function trailingWindow(endKey: string, days: number, label?: string): DayWindow {
  return {
    startKey: addDays(endKey, -(days - 1)),
    endKey,
    label: label ?? `Last ${days} days`,
  };
}

/**
 * The `days`-day window ending the day BEFORE `win.startKey`.
 * This is the SPEC §9 baseline: it excludes the evaluated period entirely.
 */
export function previousWindow(win: DayWindow, days: number, label?: string): DayWindow {
  const endKey = addDays(win.startKey, -1);
  return {
    startKey: addDays(endKey, -(days - 1)),
    endKey,
    label: label ?? `Previous ${days} days`,
  };
}

export function windowRangeLabel(win: DayWindow): string {
  return `${formatDayKeyShort(win.startKey)} – ${formatDayKeyShort(win.endKey)}`;
}

/** Number of calendar days covered by the window (inclusive). */
export function windowDays(win: DayWindow): number {
  return diffDays(win.startKey, win.endKey) + 1;
}

export function containsDay(win: DayWindow, key: string): boolean {
  return key >= win.startKey && key <= win.endKey;
}

/** Selection by day key — no Date comparison, so no timezone drift. */
export function selectByWindow<T extends { key: string }>(records: T[], win: DayWindow): T[] {
  return records.filter(r => containsDay(win, r.key));
}
// ── Medications page view model (pure) ──────────────────────────────────────
//
// Everything the Medications surface DECIDES, as pure functions of the adapter's
// read model: the window it asks for, the doses that fall on one day, how the
// records group per medication, the per-day series and every count and label it
// renders. No I/O, no React, no clock, so all of it is unit-tested in view.test.ts
// rather than through the DOM.
//
// THE RULES ENCODED HERE, none of which is negotiable:
//   * a missing dose is NEVER rendered as 0 — a dosage the source omits is said
//     in words ("no dosage recorded");
//   * a record whose `scheduledDate` is null is attributable to no day: it is
//     returned by `undatedRecords` and is never dropped, never counted into a day
//     and never crashes a grouping;
//   * a day with no records is EXCLUDED from the per-day series rather than
//     plotted as a zero-height bar (`dailyStatusSeries`);
//   * a name is the source's own text — the grouping key is the adapter's, and
//     no strength is parsed out or invented here;
//   * nothing here is advice or a judgement. The surface reports what was logged.

import { addDays, dayKey, formatDayKeyLong } from '@/lib/analytics/windows';
import type {
  MedicationCoverage,
  MedicationRecord,
  MedicationStatus,
} from '@/lib/adapters/medications';

/**
 * The zone used when a caller passes none — mirrors `MEDICATION_DAY_TIMEZONE` in
 * the adapter. Kept here (rather than re-importing the server-only adapter into
 * a component bundle) and pinned by a test so the two cannot drift silently.
 * Pages pass the profile's timezone, the zone the route attributed days in.
 */
export const MEDICATION_DAY_TZ = 'UTC';

/** How many days back the surface reads, the reference day included. */
export const MEDICATIONS_LOOKBACK_DAYS = 30;

export interface MedicationWindow {
  from: string;
  to: string;
}

/**
 * The window to request from the adapter.
 *
 * `from` is inclusive; the upstream `to` is a calendar boundary that EXCLUDES
 * records dated on that day (verified against the live source), so `to` is set
 * one day past the last day to be shown.
 */
export function medicationsWindow(
  referenceDay: string,
  days: number = MEDICATIONS_LOOKBACK_DAYS
): MedicationWindow {
  return {
    from: addDays(referenceDay, -(days - 1)),
    to: addDays(referenceDay, 1),
  };
}

// ── Records, split the way the surface shows them ───────────────────────────

/** Records attributable to `day`, by scheduled time. Undated records are never here. */
export function recordsOnDay(records: MedicationRecord[], day: string): MedicationRecord[] {
  return records
    .filter(record => record.dayKey === day)
    .sort((a, b) => (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? ''));
}

/** Records attributable to NO day (`scheduledDate` null), listed rather than dropped. */
export function undatedRecords(records: MedicationRecord[]): MedicationRecord[] {
  return records
    .filter(record => record.dayKey === null)
    .sort((a, b) => a.displayText.localeCompare(b.displayText));
}

export interface StatusCounts {
  taken: number;
  skipped: number;
  unknown: number;
}

export function countStatuses(records: MedicationRecord[]): StatusCounts {
  const counts: StatusCounts = { taken: 0, skipped: 0, unknown: 0 };
  for (const record of records) {
    if (record.status === 'Taken') counts.taken += 1;
    else if (record.status === 'Skipped') counts.skipped += 1;
    else counts.unknown += 1;
  }
  return counts;
}

/** The statuses with a record behind them, as words. A status with none is not shown. */
export function statusSummaryWords(records: MedicationRecord[]): string[] {
  const counts = countStatuses(records);
  const words: string[] = [];
  if (counts.taken > 0) words.push(`${counts.taken} Taken`);
  if (counts.skipped > 0) words.push(`${counts.skipped} Skipped`);
  if (counts.unknown > 0) words.push(`${counts.unknown} with no status recorded`);
  return words;
}

// ── Per-medication grouping ─────────────────────────────────────────────────

export interface MedicationGroup {
  key: string;
  /** Distinct recorded days (newest first). Days with no record are absent. */
  days: string[];
  /** The newest recorded day, or null when the group holds only undated records. */
  lastDay: string | null;
  skipped: number;
  records: MedicationRecord[];
}

/**
 * Group the window's records by the adapter's `groupingKey`.
 *
 * Ordered by the newest recorded day (descending), then by name, so a medication
 * logged most recently reads first. A group holding only undated records sorts
 * last and reports `lastDay: null` rather than a fabricated day.
 */
export function groupMedications(records: MedicationRecord[]): MedicationGroup[] {
  const byKey = new Map<string, MedicationRecord[]>();
  for (const record of records) {
    const bucket = byKey.get(record.groupingKey);
    if (bucket) bucket.push(record);
    else byKey.set(record.groupingKey, [record]);
  }

  const groups: MedicationGroup[] = [];
  for (const [key, groupRecords] of byKey) {
    const days = [...new Set(groupRecords.map(r => r.dayKey).filter((d): d is string => d !== null))]
      .sort()
      .reverse();
    groups.push({
      key,
      days,
      lastDay: days.length > 0 ? days[0] : null,
      skipped: groupRecords.filter(r => r.status === 'Skipped').length,
      records: groupRecords,
    });
  }

  return groups.sort((a, b) => {
    if (a.lastDay !== b.lastDay) {
      if (a.lastDay === null) return 1;
      if (b.lastDay === null) return -1;
      return b.lastDay.localeCompare(a.lastDay);
    }
    return a.key.localeCompare(b.key);
  });
}

// ── Per-day series (the compact chart's model) ──────────────────────────────

export interface MedicationDayRow {
  day: string;
  taken: number;
  skipped: number;
  unknown: number;
}

/**
 * One row per day that HAS records, oldest first. A day with no records is
 * excluded rather than plotted as zero — a missing day is not a zero dose.
 */
export function dailyStatusSeries(records: MedicationRecord[]): MedicationDayRow[] {
  const byDay = new Map<string, MedicationDayRow>();
  for (const record of records) {
    if (record.dayKey === null) continue;
    let row = byDay.get(record.dayKey);
    if (!row) {
      row = { day: record.dayKey, taken: 0, skipped: 0, unknown: 0 };
      byDay.set(record.dayKey, row);
    }
    if (record.status === 'Taken') row.taken += 1;
    else if (record.status === 'Skipped') row.skipped += 1;
    else row.unknown += 1;
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// ── Labels ──────────────────────────────────────────────────────────────────

/**
 * A count of dose units. Domain-local, mirroring `formatNumber` in the Lab view
 * model: there is no registry metric behind a medication dose, so the metric
 * formatters do not apply. A null dosage is never rendered as 0.
 */
export function formatUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'no dosage recorded';
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded} ${rounded === 1 ? 'unit' : 'units'}`;
}

/**
 * The time of day a dose was scheduled for, in the zone its day was attributed
 * in — '3:00 AM'. Deterministic: the profile's zone, not the runtime's clock.
 */
export function scheduledTimeLabel(
  scheduledDate: string | null,
  timezone: string = MEDICATION_DAY_TZ
): string {
  if (!scheduledDate) return 'no scheduled time';
  const when = new Date(scheduledDate);
  if (Number.isNaN(when.getTime())) return 'no scheduled time';
  return when.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
}

export interface CoverageDays {
  from: string;
  to: string;
}

/**
 * The day keys the returned records actually cover, or null when the window
 * yielded nothing attributable. Derived from the adapter's `covered` span.
 */
export function coverageDays(
  covered: MedicationCoverage | null,
  timezone: string = MEDICATION_DAY_TZ
): CoverageDays | null {
  if (!covered) return null;
  return {
    from: dayKey(covered.from, timezone),
    to: dayKey(covered.to, timezone),
  };
}

/** 'Aug 25, 2026 – Sep 28, 2026' for a covered span, or null when there is none. */
export function coverageLabel(
  covered: MedicationCoverage | null,
  timezone: string = MEDICATION_DAY_TZ
): string | null {
  const span = coverageDays(covered, timezone);
  if (!span) return null;
  return `${formatDayKeyLong(span.from)} – ${formatDayKeyLong(span.to)}`;
}

/** The set of day keys any record in the window falls on (undated excluded). */
export function recordedDays(records: MedicationRecord[]): string[] {
  return [...new Set(records.map(r => r.dayKey).filter((d): d is string => d !== null))].sort();
}

/** True when the window yielded nothing at all — the honest empty state. */
export function hasNoRecords(records: MedicationRecord[]): boolean {
  return records.length === 0;
}

export type { MedicationStatus };

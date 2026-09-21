// ── Blood pressure: window and reference threshold ──────
//
// The Health page shows only the last week of readings, each with its date, and
// flags any reading above 120/80.
//
// 120/80 mmHg is a commonly cited *reference threshold*. It is not a diagnosis,
// it is not specific to any one person, and a reading above it is not by itself
// a statement about that person's health — the wording belongs in the UI, and
// the rule itself lives here so it is testable on its own.

import type { BloodPressureObservation } from '../metrics/types';
import { containsDay, type DayWindow } from './windows';

export const BP_REFERENCE_THRESHOLD = { systolic: 120, diastolic: 80 } as const;

/** Readings that fall inside the window, oldest first. */
export function bloodPressureInWindow(
  records: BloodPressureObservation[],
  win: DayWindow
): BloodPressureObservation[] {
  return records.filter(r => containsDay(win, r.date));
}

/**
 * True when a reading is above the reference threshold on either number —
 * systolic above 120 **or** diastolic above 80.
 */
export function isAboveBloodPressureReference(
  reading: Pick<BloodPressureObservation, 'systolic' | 'diastolic'>
): boolean {
  return (
    reading.systolic > BP_REFERENCE_THRESHOLD.systolic ||
    reading.diastolic > BP_REFERENCE_THRESHOLD.diastolic
  );
}

// ── Blood pressure: last week, and the 120/80 callout ───
//
// Owner request 3: the Health tab shows only the last 7 days of readings, each
// with its date, and calls out any reading above 120 systolic or 80 diastolic.
// 120/80 is a reference threshold, never a diagnosis.

import { describe, expect, it } from 'vitest';
import {
  BP_REFERENCE_THRESHOLD,
  bloodPressureInWindow,
  isAboveBloodPressureReference,
} from '@/lib/analytics';
import { addDays } from '@/lib/analytics/windows';
import type { BloodPressureObservation } from '@/lib/metrics/types';

const REF = '2026-09-18';

function reading(date: string, systolic: number, diastolic: number): BloodPressureObservation {
  return { date, systolic, diastolic, units: 'mmHg', source: 'test cuff' };
}

const RECORDS: BloodPressureObservation[] = [
  reading(addDays(REF, -20), 145, 92), // outside the 7-day window
  reading(addDays(REF, -6), 109, 71),
  reading(addDays(REF, -3), 113, 69),
  reading(addDays(REF, -1), 131, 78), // above on systolic only
  reading(REF, 118, 84), // above on diastolic only
  reading(REF, 120, 80), // exactly at the threshold — not above it
];

describe('blood pressure window', () => {
  it('keeps only the last 7 days, oldest first, each with its date', () => {
    const win = { startKey: addDays(REF, -6), endKey: REF, label: 'Last 7 days' };
    const recent = bloodPressureInWindow(RECORDS, win);
    expect(recent.map(r => r.date)).toEqual([
      addDays(REF, -6),
      addDays(REF, -3),
      addDays(REF, -1),
      REF,
      REF,
    ]);
    // The older reading is outside the window and is not shown.
    expect(recent.some(r => r.systolic === 145)).toBe(false);
    // Every row carries the date it was taken.
    for (const r of recent) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the 120/80 reference threshold', () => {
  it('flags a reading above it on either number, and not one exactly at it', () => {
    expect(BP_REFERENCE_THRESHOLD).toEqual({ systolic: 120, diastolic: 80 });
    expect(isAboveBloodPressureReference(reading('2026-09-18', 121, 70))).toBe(true);
    expect(isAboveBloodPressureReference(reading('2026-09-18', 120, 81))).toBe(true);
    expect(isAboveBloodPressureReference(reading('2026-09-18', 120, 80))).toBe(false);
    expect(isAboveBloodPressureReference(reading('2026-09-18', 109, 71))).toBe(false);
  });

  it('selects exactly the readings to call out, with their dates and values', () => {
    const win = { startKey: addDays(REF, -6), endKey: REF, label: 'Last 7 days' };
    const above = bloodPressureInWindow(RECORDS, win).filter(isAboveBloodPressureReference);
    expect(above).toHaveLength(2);
    expect(above.map(r => `${r.date} ${r.systolic}/${r.diastolic}`)).toEqual([
      `${addDays(REF, -1)} 131/78`,
      `${REF} 118/84`,
    ]);
  });
});

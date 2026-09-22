import { describe, expect, it } from 'vitest';

import { getAllMetrics } from './registry';

// ── Every metric opens on a 30-day window ────────────────
//
// The app briefly defaulted several metrics and pages to 90 days or a year,
// which showed sparse, mostly-empty charts because the history is shorter than
// the window (a year of data does not exist yet for most metrics). 30 days is
// the window the product promises by default; longer ranges stay selectable.
//
// This is a product decision, not a detail: if a future metric needs a different
// default, change this test deliberately rather than letting one metric drift.

describe('metric default ranges', () => {
  it('defaults every metric to a 30-day window', () => {
    const wrong = getAllMetrics()
      .filter(m => m.defaultRange !== '30d')
      .map(m => `${m.id}: ${m.defaultRange}`);

    expect(wrong).toEqual([]);
  });

  it('has metrics to check, so the assertion above cannot pass vacuously', () => {
    expect(getAllMetrics().length).toBeGreaterThan(20);
  });

  it('still offers longer ranges as choices, they are just not the default', () => {
    // The default is not a cap: the detail page's range control keeps 90D, 1Y
    // and All selectable.
    const ranges = new Set(getAllMetrics().map(m => m.defaultRange));
    expect(ranges.has('30d')).toBe(true);
  });
});
// ── The year on the x axis, and always in the tooltip ───────────────────────
//
// The owner's defect: a chart spanning 2023 → 2026 labelled its axis "Aug 31"
// and said the same on hover. The tooltip is now unconditional, and the axis
// form is chosen from MEASURED label widths. These tests exercise the
// FORMATTER — no DOM, no chart snapshot.
//
// The widths used below are the real ones: 'Aug 31, 2023' renders 74px and
// "Aug 31 '23" 59.5px in the app at the 11px tick font. `measure` scales by
// glyph count, calibrated to that (12 glyphs ≈ 74px), so every boundary in
// these tests is a real pixel boundary.

import { describe, it, expect } from 'vitest';
import {
  AXIS_FONT_SIZE,
  estimateTextWidth,
  labelsFit,
  planDateAxis,
  tickCapacity,
  tooltipDateLabel,
  type AxisDatePlan,
} from './axis-dates';
import { formatDayKeyCompact, formatDayKeyLong } from './windows';

/** 6.2px a glyph — the app's 11px sans stack, as measured in a browser. */
const measure = (label: string) => label.length * 6.2;
/** The gap recharts enforces between two ticks, unchanged. */
const GAP = 32;
/** The x axis of a 640px chart: 640 − 46px y-axis − 4px left − 12px right margin. */
const AXIS_640 = 578;

/** Three observations spanning two calendar years — the owner's case. */
const MULTI_YEAR = ['2023-08-31', '2023-12-01', '2024-03-15'];
/** Two observations inside one calendar year. */
const ONE_YEAR = ['2024-01-05', '2024-02-05'];
/** Monthly observations crossing from one year into the next. */
const MANY = [
  '2023-09-15', '2023-10-15', '2023-11-15', '2023-12-15',
  '2024-01-15', '2024-02-15', '2024-03-15', '2024-04-15',
  '2024-05-15', '2024-06-15', '2024-07-15', '2024-08-15',
];

/**
 * The invariant behind "no two tick labels overlap at the real rendered width":
 * the ticks the axis shows are evenly spread, so the widest label plus the gap
 * must fit between two adjacent ticks.
 */
function expectNoOverlap(plan: AxisDatePlan, keys: string[], width: number) {
  const widest = Math.max(...keys.map(key => measure(plan.label(key))));
  expect(labelsFit(widest, width, plan.ticks, GAP)).toBe(true);
}

describe('formatDayKeyCompact', () => {
  it("carries a two-digit year — \"Aug 31 '23\" — never a bare 'Aug 31'", () => {
    expect(formatDayKeyCompact('2023-08-31')).toBe("Aug 31 '23");
    expect(formatDayKeyCompact('2026-09-16')).toBe("Sep 16 '26");
    expect(formatDayKeyCompact('2024-01-01')).not.toBe('Jan 1');
  });
});

describe('the tooltip date', () => {
  it('always carries the full year, for many observations and for a single one', () => {
    for (const key of MULTI_YEAR) {
      expect(tooltipDateLabel(key)).toBe(formatDayKeyLong(key));
      expect(tooltipDateLabel(key)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    }
    // The single-observation chart draws the same tooltip.
    expect(tooltipDateLabel('2024-01-01')).toBe('Jan 1, 2024');
  });

  it('never degrades to the axis fallback, however narrow the chart is', () => {
    const cramped = planDateAxis({ keys: MULTI_YEAR, width: 60, measure, minTickGap: GAP });
    for (const key of MULTI_YEAR) {
      expect(tooltipDateLabel(key)).not.toBe(cramped.label(key));
      expect(tooltipDateLabel(key)).toContain(', 20');
    }
  });
});

describe('the axis date form', () => {
  it('shows the full date, year included, when it fits between the ticks', () => {
    const plan = planDateAxis({ keys: MULTI_YEAR, width: AXIS_640, measure, minTickGap: GAP });
    expect(plan.format).toBe('full');
    expect(MULTI_YEAR.map(plan.label)).toEqual(['Aug 31, 2023', 'Dec 1, 2023', 'Mar 15, 2024']);
    expectNoOverlap(plan, MULTI_YEAR, AXIS_640);
  });

  it('makes the same call on the real widths of a 640px chart', () => {
    // The widths the browser actually paints for these labels at 11px.
    const painted: Record<string, number> = {
      'Aug 31, 2023': 74,
      'Dec 1, 2023': 66.8,
      'Mar 15, 2024': 73.3,
      "Aug 31 '23": 59.5,
      "Dec 1 '23": 52.3,
      "Mar 15 '24": 58.8,
    };
    const plan = planDateAxis({
      keys: MULTI_YEAR,
      width: AXIS_640,
      measure: label => painted[label] ?? estimateTextWidth(label),
      minTickGap: GAP,
    });
    expect(plan.format).toBe('full');
    expect(MULTI_YEAR.map(plan.label)).toEqual(['Aug 31, 2023', 'Dec 1, 2023', 'Mar 15, 2024']);
  });

  it('uses the compact form only when the full date does not fit, and keeps the year', () => {
    // The same three observations, the same ticks — only the width differs.
    const wide = planDateAxis({ keys: MULTI_YEAR, width: AXIS_640, measure, minTickGap: GAP });
    const narrow = planDateAxis({ keys: MULTI_YEAR, width: 104, measure, minTickGap: GAP });
    expect(wide.format).toBe('full');
    expect(narrow.format).toBe('compact');
    expect(MULTI_YEAR.map(narrow.label)).toEqual(["Aug 31 '23", "Dec 1 '23", "Mar 15 '24"]);
    for (const label of MULTI_YEAR.map(narrow.label)) expect(label).toMatch(/'\d{2}$/);
    expectNoOverlap(narrow, MULTI_YEAR, 104);
  });

  it('prefers the compact year-bearing form when the full date would cost ticks', () => {
    // The same monthly series: here the full date does NOT fit between the
    // ticks, the compact one does — so the axis keeps the year AND the ticks.
    const plan = planDateAxis({ keys: MANY, width: 205, measure, minTickGap: GAP });
    const widestFull = Math.max(...MANY.map(key => measure(formatDayKeyLong(key))));
    expect(labelsFit(widestFull, 205, plan.ticks, GAP)).toBe(false);
    expect(plan.format).toBe('compact');
    for (const key of MANY) expect(plan.label(key)).toMatch(/'\d{2}$/);
    expectNoOverlap(plan, MANY, 205);
  });

  it('carries the year on EVERY tick of a multi-year range at every width', () => {
    for (const width of [104, 150, 200, 300, 400, AXIS_640, 900]) {
      for (const keys of [MULTI_YEAR, MANY]) {
        const plan = planDateAxis({ keys, width, measure, minTickGap: GAP });
        expect(plan.format).not.toBe('sparse');
        for (const key of keys) expect(plan.label(key)).toMatch(/(, \d{4}|'\d{2})$/);
        expectNoOverlap(plan, keys, width);
      }
    }
  });

  it('falls back to first, last and year-change ticks only when one compact label cannot fit', () => {
    const plan = planDateAxis({ keys: MULTI_YEAR, width: 60, measure, minTickGap: GAP });
    expect(plan.format).toBe('sparse');
    expect(plan.label('2023-08-31')).toBe("Aug 31 '23");
    expect(plan.label('2023-12-01')).toBe('Dec 1');
    expect(plan.label('2024-03-15')).toBe("Mar 15 '24");
  });

  it('still carries the year on both ends when the year never changes', () => {
    const plan = planDateAxis({ keys: ONE_YEAR, width: 50, measure, minTickGap: GAP });
    expect(plan.format).toBe('sparse');
    expect(plan.label(ONE_YEAR[0]!)).toBe("Jan 5 '24");
    expect(plan.label(ONE_YEAR[1]!)).toBe("Feb 5 '24");
  });

  it('shows the full date for a single observation at any usable width', () => {
    for (const width of [90, 200, AXIS_640]) {
      const plan = planDateAxis({ keys: ['2024-01-01'], width, measure, minTickGap: GAP });
      expect(plan.format).toBe('full');
      expect(plan.label('2024-01-01')).toBe('Jan 1, 2024');
    }
  });

  it('has no labels to place for an empty series', () => {
    const plan = planDateAxis({ keys: [], width: 320, measure, minTickGap: GAP });
    expect(plan.ticks).toBe(0);
    expect(plan.label('2024-01-01')).toBe("Jan 1 '24");
  });
});

describe('the capacity arithmetic', () => {
  it('holds at least one tick, and never more than one per observation', () => {
    expect(tickCapacity(60, 1000, GAP, 3)).toBe(3);
    expect(tickCapacity(60, 20, GAP, 3)).toBe(1);
    expect(tickCapacity(60, 200, GAP, 0)).toBe(0);
    expect(tickCapacity(0, 500, 0, 4)).toBe(4);
  });

  it('rejects a set of labels that would collide, and accepts one that will not', () => {
    expect(labelsFit(74, 300, 3, GAP)).toBe(true);
    expect(labelsFit(74, 120, 3, GAP)).toBe(false);
    // A lone label needs only to fit the axis.
    expect(labelsFit(74, 80, 1, GAP)).toBe(true);
    expect(labelsFit(74, 40, 1, GAP)).toBe(false);
    expect(labelsFit(74, 300, 0, GAP)).toBe(false);
  });
});

describe('the server-render width estimate', () => {
  it('grows with the label and is only used where no canvas exists', () => {
    expect(estimateTextWidth('', AXIS_FONT_SIZE)).toBe(0);
    expect(estimateTextWidth('Aug 31, 2023')).toBeGreaterThan(estimateTextWidth("Aug '23"));
    expect(estimateTextWidth("Aug '23")).toBeGreaterThan(0);
  });
});

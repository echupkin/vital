// ── The year on the x axis, wherever it can fit ─────────────────────────────
//
// The owner's defect: a chart spanning several years showed "Aug 31" and no
// year at all, on the axis or on hover. The tooltip is now unconditional (see
// `formatDayKeyLong`), and this module decides what the AXIS can carry.
//
// THREE FORMS, richest first, chosen from MEASURED label widths rather than a
// guess:
//
//   full     'Aug 31, 2023'  — when the full date fits between two ticks;
//   compact  "Aug '23"       — when the full date does not fit but the
//                              two-digit year does;
//   sparse   the first tick, the last tick and every tick where the year
//            CHANGES carry "Aug '23"; the ticks between them carry 'Aug 31'.
//            The last resort, reached only when the chart is narrower than a
//            single compact label, and always covered by the tooltip.
//
// NOTHING IS ASSUMED ABOUT WIDTH. The caller passes the axis width in pixels and
// a `measure` function that returns the rendered width of a label at the app's
// tick font — `measureTextWidth` measures it with the canvas the browser will
// actually paint with. The estimator below is only the server-render fallback,
// where no canvas exists and nothing is painted at all.
//
// WHY A CAPACITY MODEL RATHER THAN A TICK LIST. Recharts thins the ticks itself:
// it works back from the end of the axis, measuring each label, and keeps a tick
// only when it clears the previously kept one by `minTickGap`. So the spacing
// behaviour is preserved exactly, and a chart cannot be made to overlap its own
// tick labels by the text we hand it. What we decide is the FORM: a form "fits"
// when the widest label it produces, plus `minTickGap`, is no wider than the
// distance between two adjacent ticks — and the number of ticks is what the axis
// can hold at that label width.

import { dayKeyYear, formatDayKeyCompact, formatDayKeyLong, formatDayKeyShort } from './windows';

export type AxisDateFormat = 'full' | 'compact' | 'sparse';

export interface AxisDatePlan {
  /** Which form the axis uses. */
  format: AxisDateFormat;
  /** The label for a tick's day key. */
  label: (key: string) => string;
  /** How many ticks the form expects the axis to be able to show. */
  ticks: number;
}

export interface AxisDatePlanOptions {
  /** The day keys the axis may label, in chart order. */
  keys: string[];
  /** Width available to the axis itself, in pixels. */
  width: number;
  /** Rendered width of a label at the tick font, in pixels. */
  measure: (label: string) => number;
  /** recharts' own minimum gap between two kept ticks. Unchanged. */
  minTickGap?: number;
}

/** The tick font the charts use for both axes. */
export const AXIS_FONT_SIZE = 11;

/** The app's sans stack, as `tailwind.config.ts` and `globals.css` declare it. */
export const AXIS_FONT_FAMILY = '-apple-system, "Segoe UI", Inter, system-ui, sans-serif';

/**
 * The tooltip's date line — the FULL date, year included, on every chart and
 * for every observation count, including a single one. The axis may have to
 * fall back to a compact form; the tooltip never does.
 */
export function tooltipDateLabel(key: string): string {
  return formatDayKeyLong(key);
}

/**
 * How many ticks of this label width the axis can hold: labels of width
 * `widest`, `minTickGap` apart, across `width`. At least one, never more than
 * one per observation.
 */
export function tickCapacity(widest: number, width: number, minTickGap: number, keys: number): number {
  if (keys <= 0) return 0;
  const step = widest + minTickGap;
  if (step <= 0) return keys;
  return Math.min(keys, Math.max(1, Math.floor(width / step) + 1));
}

/**
 * True when `ticks` labels of measured width `widest`, spread evenly across
 * `width`, clear each other by `minTickGap` — and a lone label fits the axis.
 */
export function labelsFit(widest: number, width: number, ticks: number, minTickGap: number): boolean {
  if (ticks <= 0) return false;
  if (ticks === 1) return widest <= width;
  return widest + minTickGap <= width / (ticks - 1);
}

/** The widest of a set of labels — the one that decides whether they fit. */
function widest(labels: string[], measure: (label: string) => number): number {
  return labels.reduce((max, label) => Math.max(max, measure(label)), 0);
}

/**
 * The first tick, the last tick and every tick where the year changes carry the
 * year; the ones between them carry only the month and day. Recharts keeps the
 * two ends of the axis in preference to the middle, so those are the ticks most
 * likely to be on screen when the chart is very narrow.
 */
function sparseLabel(keys: string[]): (key: string) => string {
  const carrying = new Set<string>();
  let previousYear: string | null = null;
  keys.forEach((key, index) => {
    const year = dayKeyYear(key);
    if (index === 0 || index === keys.length - 1 || year !== previousYear) carrying.add(key);
    previousYear = year;
  });
  return (key: string) => (carrying.has(key) ? formatDayKeyCompact(key) : formatDayKeyShort(key));
}

/**
 * The richest date form the axis can carry without any two labels colliding.
 * `minTickGap` is used exactly as recharts applies it — the room a label must
 * leave for its neighbour.
 */
export function planDateAxis({
  keys,
  width,
  measure,
  minTickGap = 32,
}: AxisDatePlanOptions): AxisDatePlan {
  if (keys.length === 0) {
    return { format: 'compact', label: formatDayKeyCompact, ticks: 0 };
  }

  const fullLabels = keys.map(formatDayKeyLong);
  const compactLabels = keys.map(formatDayKeyCompact);
  // The tick count is counted with the NARROWER form, so the decision is made
  // against the smallest slot the axis can offer.
  const ticks = tickCapacity(widest(compactLabels, measure), width, minTickGap, keys.length);

  if (labelsFit(widest(fullLabels, measure), width, ticks, minTickGap)) {
    return { format: 'full', label: formatDayKeyLong, ticks };
  }
  if (labelsFit(widest(compactLabels, measure), width, ticks, minTickGap)) {
    return { format: 'compact', label: formatDayKeyCompact, ticks };
  }
  return { format: 'sparse', label: sparseLabel(keys), ticks };
}

// ── Measuring a label ───────────────────────────────────────────────────────

/** Rough advance widths, as a fraction of the font size, for the SSR fallback. */
const NARROW = new Set(['i', 'l', 'j', 't', 'f', 'I', 'r', '1', ' ', '.', "'", ',', ':', ';', '|', '-']);

/**
 * A width estimate used ONLY where no canvas exists (a server render, a unit
 * test): the browser path measures the real thing with `measureTextWidth`.
 */
export function estimateTextWidth(text: string, fontSize: number = AXIS_FONT_SIZE): number {
  let units = 0;
  for (const character of text) {
    units += NARROW.has(character) ? 0.32 : /[A-Z0-9]/.test(character) ? 0.66 : 0.55;
  }
  return units * fontSize;
}

/**
 * A label measurer at the app's tick font. In the browser this is a real canvas
 * `measureText` — the same font string the SVG tick uses — so the planner is
 * deciding on the width the reader will actually see.
 */
export function measureTextWidth(
  fontSize: number = AXIS_FONT_SIZE,
  fontFamily: string = AXIS_FONT_FAMILY
): (label: string) => number {
  const fallback = (label: string) => estimateTextWidth(label, fontSize);
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return fallback;
  const context = document.createElement('canvas').getContext?.('2d');
  if (!context) return fallback;
  context.font = `${fontSize}px ${fontFamily}`;
  const cache = new Map<string, number>();
  return (label: string) => {
    let width = cache.get(label);
    if (width === undefined) {
      width = context.measureText(label).width;
      cache.set(label, width);
    }
    return width;
  };
}

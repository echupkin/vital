'use client';

// ── Measuring the axis, so the date form is chosen on real width ────────────
//
// A chart cannot know how wide its x axis will be until it is on screen, and the
// formatter must not guess: 'Aug 31, 2023' and "Aug '23" are only interchangeable
// if the wider one fits. This hook reports the element's measured width (and
// keeps it current through a `ResizeObserver`, so a window resize or a sidebar
// toggle re-decides the form) and returns the resulting `AxisDatePlan`.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AXIS_FONT_SIZE,
  measureTextWidth,
  planDateAxis,
  type AxisDatePlan,
} from '@/lib/analytics/axis-dates';

/**
 * The width assumed before the element has been measured: a server render, or
 * the first client paint. Deliberately NARROW — until the real width arrives the
 * planner is conservative, and the measured width only ever widens the labels.
 */
export const UNMEASURED_AXIS_WIDTH = 320;

export function useAxisDatePlan(
  keys: string[],
  options: { minTickGap?: number; reservedWidth?: number } = {}
): { ref: React.RefObject<HTMLDivElement | null>; plan: AxisDatePlan } {
  const { minTickGap = 32, reservedWidth = 0 } = options;
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(UNMEASURED_AXIS_WIDTH);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const measured = node.clientWidth - reservedWidth;
      if (measured > 0) setWidth(measured);
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [reservedWidth]);

  const measure = useMemo(() => measureTextWidth(AXIS_FONT_SIZE), []);
  // The keys arrive as a fresh array every render; their contents are what the
  // plan depends on.
  const signature = keys.join(',');
  const plan = useMemo(
    () =>
      planDateAxis({
        keys: signature ? signature.split(',') : [],
        width,
        measure,
        minTickGap,
      }),
    [signature, width, measure, minTickGap]
  );

  return { ref, plan };
}

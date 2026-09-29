// ── The /api/medications window resolution (pure) ───────────────────────────
//
// Kept out of the route module because a Next.js route file may export ONLY its
// HTTP handlers and the route segment config — an extra export fails the build.
// This module is therefore the route's testable seam: the window defaulting and
// validation the route runs, as a pure function of the query string.

import { dayKey } from '@/lib/analytics/windows';
import { MEDICATION_DAY_TZ, MEDICATIONS_LOOKBACK_DAYS, medicationsWindow } from './view';

/** Named in words only — the upstream host is never disclosed. */
export const MEDICATIONS_SOURCE = 'Health Auto Export';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedWindow {
  from: string;
  to: string;
}

/**
 * Resolve the requested window, or an error message when a bound is malformed.
 *
 * `from` is inclusive; the upstream `to` is a calendar boundary that EXCLUDES
 * records dated on that day, so a caller wanting the last day D sends D + 1 day.
 * Absent bounds default to the last 30 days ending today in `timezone`.
 */
export function resolveWindow(
  params: URLSearchParams,
  now: Date = new Date(),
  timezone: string = MEDICATION_DAY_TZ
): ResolvedWindow | string {
  const fallback = medicationsWindow(dayKey(now, timezone), MEDICATIONS_LOOKBACK_DAYS);
  const from = (params.get('from') ?? '').trim() || fallback.from;
  const to = (params.get('to') ?? '').trim() || fallback.to;
  if (!DAY_KEY.test(from) || !DAY_KEY.test(to)) {
    return 'The window bounds must be calendar days in YYYY-MM-DD form.';
  }
  if (to <= from) {
    return 'The window end must fall after its start.';
  }
  return { from, to };
}

// ── Body goal: how long, at which pace ──────────────────
//
// Arrival is always a projection from a pace — the band's two ends, the pace
// in use, and the measured trend when it is heading toward the goal. There is
// no deadline anywhere, so nothing can be "behind": a trend that is flat or
// moving away is described as what it is, beside what the chosen pace implies.

import { addDays } from '../analytics/windows';
import { WEIGHT_TREND_WINDOW } from '../analytics/weight-trend';
import type { GoalPhase } from './phase';
import type { EffectivePace, PaceBand } from './pace';

export interface ProjectionRow {
  id: 'band-slow' | 'band-fast' | 'chosen' | 'trend';
  label: string;
  /** Size of the pace, kg/week. */
  kgPerWeek: number;
  pct: number;
  weeks: number;
  arrival: string;
}

export interface Projection {
  /** Weight still to change, kg, signed (negative = to lose). */
  remainingKg: number;
  rows: ProjectionRow[];
  /** The pace in use's row. */
  chosen: ProjectionRow | null;
  /** A sentence about the measured trend when it has no row of its own. */
  trendNote: string | null;
}

function row(id: ProjectionRow['id'], label: string, kgPerWeek: number, weightKg: number, remainingKg: number, today: string): ProjectionRow | null {
  if (!(kgPerWeek > 0)) return null;
  const weeks = Math.abs(remainingKg) / kgPerWeek;
  return { id, label, kgPerWeek, pct: (kgPerWeek / weightKg) * 100, weeks, arrival: addDays(today, Math.round(weeks * 7)) };
}

export function projectArrival(input: {
  phase: GoalPhase;
  remainingKg: number;
  weightKg: number;
  band: PaceBand;
  pace: EffectivePace;
  trendKgPerWeek: number | null;
  today: string;
  /** Formats a signed kg/week for the trend note, in display units. */
  formatRate: (kgPerWeek: number) => string;
}): Projection {
  const { phase, remainingKg, weightKg, band, pace, trendKgPerWeek, today, formatRate } = input;
  if (phase === 'maintain') return { remainingKg, rows: [], chosen: null, trendNote: null };

  const rows: ProjectionRow[] = [];
  const push = (r: ProjectionRow | null) => { if (r) rows.push(r); };
  const chosenLabel = pace.source === 'custom' ? 'Your pace' : 'Recommended pace';
  const chosen = row('chosen', chosenLabel, Math.abs(pace.kgPerWeek), weightKg, remainingKg, today);
  push(row('band-slow', 'Slower end of the recommended range', (band.minPct * weightKg) / 100, weightKg, remainingKg, today));
  push(chosen);
  push(row('band-fast', 'Faster end of the recommended range', (band.maxPct * weightKg) / 100, weightKg, remainingKg, today));

  let trendNote: string | null = null;
  const atPace = pace.source === 'custom' ? 'At your pace' : 'At the recommended pace';
  const toward = trendKgPerWeek !== null && Math.sign(trendKgPerWeek) === Math.sign(remainingKg) && Math.abs(trendKgPerWeek) >= 0.05;
  if (toward) {
    push(row('trend', `Current pace (your ${WEIGHT_TREND_WINDOW})`, Math.abs(trendKgPerWeek!), weightKg, remainingKg, today));
  } else if (trendKgPerWeek !== null && chosen) {
    const weeks = Math.round(chosen.weeks);
    trendNote =
      Math.abs(trendKgPerWeek) < 0.05
        ? `Weight has held steady over the ${WEIGHT_TREND_WINDOW}. ${atPace} the goal is about ${weeks} week${weeks === 1 ? '' : 's'} away.`
        : `Weight has moved ${formatRate(trendKgPerWeek)} over the ${WEIGHT_TREND_WINDOW}, away from the goal. ${atPace} the goal is about ${weeks} week${weeks === 1 ? '' : 's'} away.`;
  }

  rows.sort((a, b) => a.kgPerWeek - b.kgPerWeek);
  return { remainingKg, rows, chosen, trendNote };
}

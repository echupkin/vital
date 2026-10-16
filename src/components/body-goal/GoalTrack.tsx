'use client';

// ── Is the trend on the right track? ────────────────────
//
// Replaces a progress bar on the goal card and the Overview tile: a progress
// bar early in a cut only shows how far there is to go, and at the goal it is
// simply full. This shows the weight trend instead, against what the goal
// needs.
//
//   cutting / gaining  one axis from "moving away" through "steady" to
//                      "faster", with the recommended range shaded, the
//                      too-fast zone hatched and a marker at the trend.
//   at the goal        the maintenance range around the goal, with a marker
//                      at the current (seven-day) weight.
//
// The status above it describes the data; it never measures the reader against
// a deadline.

import { WEIGHT_TREND_WINDOW } from '@/lib/analytics/weight-trend';
import { BULK_RISK_PCT, CUT_RISK_PCT } from '@/lib/body-goal/constants';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { GoalTrack as Track } from '@/lib/body-goal/track';
import type { UnitSystem } from '@/lib/prefs';
import { Badge } from '@/components/ui/primitives';
import { formatKg, formatRate } from './format';

const BADGE: Record<Track['tone'], 'success' | 'warning' | 'default'> = { good: 'success', caution: 'warning', neutral: 'default' };
const MARKER: Record<Track['tone'], string> = {
  good: 'var(--color-category-body)',
  caution: 'var(--color-category-attention)',
  neutral: 'var(--color-text-secondary)',
};
const HATCH = 'repeating-linear-gradient(135deg, var(--color-category-attention) 0 3px, transparent 3px 7px)';

export function GoalTrack({ report, units, compact = false }: { report: BodyGoalReport; units: UnitSystem; compact?: boolean }) {
  const { track } = report;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={BADGE[track.tone]}>{track.label}</Badge>
        {track.status !== 'unknown' && <span className="text-[11px] text-text-secondary">{WEIGHT_TREND_WINDOW}</span>}
      </div>
      {!compact && <p className="mt-1.5 text-sm text-text-secondary">{track.detail}</p>}
      <div className={compact ? 'mt-3' : 'mt-4'}>
        {report.phase.phase === 'maintain' ? <HoldGauge report={report} units={units} /> : <PaceGauge report={report} units={units} />}
      </div>
    </div>
  );
}

/** Keep a label inside the gauge at either edge. */
function shift(x: number): string {
  if (x < 8) return 'translateX(0)';
  if (x > 92) return 'translateX(-100%)';
  return 'translateX(-50%)';
}

function Marker({ x, color, label }: { x: number; color: string; label: string }) {
  return (
    <>
      <span className="absolute top-0 text-[11px] font-medium tnum text-text-primary whitespace-nowrap" style={{ left: `${x}%`, transform: shift(x) }}>
        {label}
      </span>
      <span
        className="absolute rounded-full border-2"
        style={{ top: 18, left: `calc(${x}% - 7px)`, width: 14, height: 14, background: color, borderColor: 'var(--color-surface)', boxShadow: `0 0 0 1px ${color}` }}
      />
    </>
  );
}

function Tick({ x, label, strong = false }: { x: number; label: string; strong?: boolean }) {
  return (
    <span
      className={`absolute text-[10px] whitespace-nowrap ${strong ? 'text-text-primary' : 'text-text-secondary'}`}
      style={{ top: 38, left: `${x}%`, transform: shift(x) }}
    >
      {label}
    </span>
  );
}

const BAR_TOP = 20;
const BAR = 10;

/** Cutting or gaining: the trend's speed toward the goal, from "away" to "faster". */
function PaceGauge({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const { band, phase, weight, track } = report;
  if (!band || !phase.phase || phase.phase === 'maintain' || weight.ratePct === null || weight.rateKgPerWeek === null) return null;
  const cutting = phase.phase === 'cut';
  const toward = cutting ? -weight.ratePct : weight.ratePct;
  const riskPct = Math.max(cutting ? CUT_RISK_PCT : BULK_RISK_PCT, band.maxPct);
  const step = (v: number) => Math.ceil(v / 0.25) * 0.25;
  const hi = Math.min(2.5, step(Math.max(band.maxPct * 1.5, riskPct * 1.35, toward * 1.1)));
  const lo = -Math.min(2.5, Math.max(0.5, step(-toward * 1.1)));
  const x = (pct: number) => Math.min(100, Math.max(0, ((pct - lo) / (hi - lo)) * 100));
  const summary = `${track.label}. The weight trend (${WEIGHT_TREND_WINDOW}) is ${formatRate(weight.rateKgPerWeek, units)}; the recommended range is ${band.minPct}–${band.maxPct} % of body weight a week toward the goal.`;

  return (
    <div className="relative w-full" style={{ height: 52 }} role="img" aria-label={summary}>
      <div className="absolute inset-x-0 rounded-full bg-surface-muted overflow-hidden" style={{ top: BAR_TOP, height: BAR }}>
        <div className="absolute inset-y-0" style={{ left: `${x(riskPct)}%`, right: 0, background: HATCH, opacity: 0.35 }} />
        <div
          className="absolute inset-y-0 rounded-full"
          style={{ left: `${x(band.minPct)}%`, width: `${x(band.maxPct) - x(band.minPct)}%`, background: 'var(--color-category-body)', opacity: 0.55 }}
        />
      </div>
      <span className="absolute w-px bg-border-strong" style={{ top: BAR_TOP - 3, height: BAR + 6, left: `${x(0)}%` }} aria-hidden="true" />
      <div aria-hidden="true">
        <Marker x={x(toward)} color={MARKER[track.tone]} label={formatRate(weight.rateKgPerWeek, units)} />
        <Tick x={0} label="← Away" />
        <Tick x={x(0)} label="Steady" />
        <Tick x={x((band.minPct + band.maxPct) / 2)} label="Recommended" strong />
        <Tick x={100} label="Faster →" />
      </div>
    </div>
  );
}

/** At the goal: the current weight in the maintenance range. */
function HoldGauge({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const range = report.maintenance;
  const now = report.weight.current?.value ?? null;
  if (!range || now === null) return null;
  const span = range.highKg - range.lowKg;
  const lo = Math.min(range.lowKg - span * 0.6, now - span * 0.1);
  const hi = Math.max(range.highKg + span * 0.6, now + span * 0.1);
  const x = (kg: number) => Math.min(100, Math.max(0, ((kg - lo) / (hi - lo)) * 100));
  const summary = `${report.track.label}. Seven-day weight ${formatKg(now, units)}; the maintenance range is ${formatKg(range.lowKg, units)}–${formatKg(range.highKg, units)}.`;

  return (
    <div className="relative w-full" style={{ height: 52 }} role="img" aria-label={summary}>
      <div className="absolute inset-x-0 rounded-full bg-surface-muted overflow-hidden" style={{ top: BAR_TOP, height: BAR }}>
        <div
          className="absolute inset-y-0 rounded-full"
          style={{ left: `${x(range.lowKg)}%`, width: `${x(range.highKg) - x(range.lowKg)}%`, background: 'var(--color-category-body)', opacity: 0.55 }}
        />
      </div>
      <span className="absolute w-px bg-border-strong" style={{ top: BAR_TOP - 3, height: BAR + 6, left: `${x(range.centerKg)}%` }} aria-hidden="true" />
      <div aria-hidden="true">
        <Marker x={x(now)} color={MARKER[report.track.tone]} label={formatKg(now, units)} />
        <Tick x={0} label="← Lower" />
        <Tick x={x(range.centerKg)} label={`Goal ${formatKg(range.centerKg, units)}`} strong />
        <Tick x={100} label="Higher →" />
      </div>
    </div>
  );
}

'use client';

// ── Pace, as a scale from slower to faster ──────────────
//
// One horizontal axis of pace (share of body weight per week): the recommended
// range as a band, the zone past which a faster pace costs muscle (cutting) or
// adds mostly fat (gaining), and markers for the measured trend and — with a
// goal — the pace in use, each with when it would arrive. The exact numbers
// stay one click away in a table, for screen readers and for anyone who wants
// them. Without a goal the same scale shows only the measured trend, read
// against the range for the direction weight is going.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { WEIGHT_TREND_WINDOW } from '@/lib/analytics/weight-trend';
import { BULK_RISK_PCT, CUT_RISK_PCT } from '@/lib/body-goal/constants';
import type { PaceBand } from '@/lib/body-goal/pace';
import type { GoalPhase } from '@/lib/body-goal/phase';
import type { ProjectionRow } from '@/lib/body-goal/projection';
import type { BodyReading } from '@/lib/body-goal/reading';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { UnitSystem } from '@/lib/prefs';
import { DataStateNote } from '@/components/ui/primitives';
import { formatKg, formatPct, formatWeeks } from './format';

const ROW = 46;
const BAR = 12;
const TREND_TITLE = `Current pace, ${WEIGHT_TREND_WINDOW}`;

interface Marker {
  id: string;
  /** Size as % of body weight per week. */
  pct: number;
  title: string;
  /** Weeks and arrival, when there is a goal to arrive at. */
  arrival: { weeks: number; day: string } | null;
  tone: 'plan' | 'trend';
}

/** Place a short tick label so it never runs off either edge of the scale. */
function anchor(x: number): string {
  if (x < 14) return 'translateX(0)';
  if (x > 86) return 'translateX(-100%)';
  return 'translateX(-50%)';
}

/**
 * A marker's label, centred over its point where it fits and pushed inside the
 * scale where it would not. A marker label is wider than a tick's, so how far
 * in it must sit depends on the width of the card: it is measured, and
 * measured again whenever the scale is resized (a phone turned, a sidebar
 * opened). Until then the label falls back to the fixed-threshold anchor.
 */
function ScaleLabel({ pos, className, style, children }: { pos: number; className: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const label = ref.current;
    const scale = label?.offsetParent as HTMLElement | null;
    if (!label || !scale) return;
    const place = () => {
      const width = scale.clientWidth;
      const own = label.offsetWidth;
      const centred = (pos / 100) * width - own / 2;
      setLeft(Math.max(0, Math.min(width - own, centred)));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(scale);
    observer.observe(label);
    return () => observer.disconnect();
  }, [pos]);
  return (
    <div
      ref={ref}
      className={className}
      style={left === null ? { ...style, left: `${pos}%`, transform: anchor(pos) } : { ...style, left }}
    >
      {children}
    </div>
  );
}

/** The scale for a goal: the measured trend and the pace in use, with arrival dates. */
export function PaceScale({ report, units }: { report: BodyGoalReport; units: UnitSystem }) {
  const band = report.band;
  const phase = report.phase.phase;
  const weightKg = report.weight.current?.value ?? null;
  const rows = report.projection?.rows ?? [];
  if (!band || !phase || phase === 'maintain' || weightKg === null || rows.length === 0) return null;

  const find = (id: ProjectionRow['id']) => rows.find(r => r.id === id) ?? null;
  const chosen = find('chosen');
  const trend = find('trend');
  const markers: Marker[] = [];
  if (trend) markers.push({ id: trend.id, pct: trend.pct, title: TREND_TITLE, arrival: { weeks: trend.weeks, day: trend.arrival }, tone: 'trend' });
  if (chosen) {
    markers.push({
      id: chosen.id,
      pct: chosen.pct,
      title: report.pace?.source === 'custom' ? 'Your pace' : 'Recommended pace',
      arrival: { weeks: chosen.weeks, day: chosen.arrival },
      tone: 'plan',
    });
  }
  return (
    <PaceScaleView
      phase={phase}
      band={band}
      weightKg={weightKg}
      markers={markers}
      rows={rows}
      span={{ slow: find('band-slow'), fast: find('band-fast') }}
      note={report.projection?.trendNote ?? null}
      units={units}
    />
  );
}

/** The scale without a goal: only the measured trend, against the range for the way weight is going. */
export function TrendPaceScale({ reading, units }: { reading: BodyReading; units: UnitSystem }) {
  const d = reading.direction;
  const weightKg = reading.weight.current?.value ?? null;
  const ratePct = reading.weight.ratePct;
  if (!d || d.phase === 'maintain' || weightKg === null || ratePct === null) return null;
  return (
    <PaceScaleView
      phase={d.phase}
      band={d.band}
      weightKg={weightKg}
      markers={[{ id: 'trend', pct: Math.abs(ratePct), title: TREND_TITLE, arrival: null, tone: 'trend' }]}
      rows={null}
      span={null}
      note={null}
      units={units}
    />
  );
}

function PaceScaleView({
  phase, band, weightKg, markers: placed, rows, span, note, units,
}: {
  phase: Exclude<GoalPhase, 'maintain'>;
  band: PaceBand;
  weightKg: number;
  markers: Marker[];
  /** The projection table, with a goal. */
  rows: ProjectionRow[] | null;
  /** The projection at each edge of the band, with a goal. */
  span: { slow: ProjectionRow | null; fast: ProjectionRow | null } | null;
  note: string | null;
  units: UnitSystem;
}) {
  const cutting = phase === 'cut';
  const riskPct = Math.max(cutting ? CUT_RISK_PCT : BULK_RISK_PCT, band.maxPct);

  const maxPct = Math.min(
    2.5,
    Math.ceil(Math.max(band.maxPct * 1.5, riskPct * 1.35, ...placed.map(m => m.pct * 1.1)) / 0.25) * 0.25
  );
  const x = (pct: number) => Math.min(100, Math.max(0, (pct / maxPct) * 100));
  const perWeek = (pct: number) => formatKg((pct * weightKg) / 100, units);

  const markers = placed.map((m, level) => ({ ...m, level }));
  const levels = Math.max(1, markers.length);
  const barTop = levels * ROW + 6;
  const height = barTop + BAR + 26;
  const slow = span?.slow ?? null;
  const fast = span?.fast ?? null;

  const ticks = [0, band.minPct, band.maxPct, ...(riskPct > band.maxPct ? [riskPct] : [])];
  const summary =
    `Pace from slower to faster. Recommended ${band.minPct}–${band.maxPct} % of body weight a week (${perWeek(band.minPct)}–${perWeek(band.maxPct)}).` +
    markers.map(m => ` ${m.title}: ${perWeek(m.pct)} a week${m.arrival ? `, arriving around ${formatDayKeyLong(m.arrival.day)}` : ''}.`).join('');

  return (
    <div>
      <div className="flex justify-between text-[11px] font-medium text-text-secondary mb-2">
        <span>← Slower{cutting ? ' · keeps more muscle' : ' · less fat'}</span>
        <span>{cutting ? 'costs more muscle · ' : 'more fat · '}Faster →</span>
      </div>

      <div className="relative w-full" style={{ height }} role="img" aria-label={summary}>
        {/* The scale itself */}
        <div className="absolute inset-x-0 rounded-full bg-surface-muted overflow-hidden" style={{ top: barTop, height: BAR }}>
          <div
            className="absolute inset-y-0"
            style={{
              left: `${x(riskPct)}%`,
              right: 0,
              background: 'repeating-linear-gradient(135deg, var(--color-category-attention) 0 3px, transparent 3px 7px)',
              opacity: 0.35,
            }}
          />
          <div
            className="absolute inset-y-0 rounded-full"
            style={{ left: `${x(band.minPct)}%`, width: `${x(band.maxPct) - x(band.minPct)}%`, background: 'var(--color-category-body)', opacity: 0.55 }}
          />
        </div>

        {/* Ticks under the scale */}
        {ticks.map(t => (
          <span
            key={t}
            className="absolute text-[10px] tnum text-text-secondary whitespace-nowrap"
            style={{ top: barTop + BAR + 6, left: `${x(t)}%`, transform: anchor(x(t)) }}
          >
            {t === 0 ? '0' : perWeek(t)}
          </span>
        ))}

        {/* Markers: a label above the scale, joined to it by a line */}
        {markers.map(m => {
          const pos = x(m.pct);
          const color = m.tone === 'plan' ? 'var(--color-category-body)' : 'var(--color-text-primary)';
          const labelTop = m.level * ROW;
          const clipped = m.pct > maxPct;
          return (
            <div key={m.id} aria-hidden="true">
              <ScaleLabel
                pos={pos}
                className="absolute rounded-control border bg-surface px-2 py-1 shadow-sm whitespace-nowrap"
                style={{ top: labelTop, borderColor: color }}
              >
                <div className="text-[11px] font-medium text-text-primary leading-tight">{m.title}</div>
                <div className="text-[11px] tnum text-text-secondary leading-tight">
                  {perWeek(m.pct)}/week{clipped ? ' (off the scale)' : ''}
                  {m.arrival && ` · ${formatWeeks(m.arrival.weeks)} · ${formatDayKeyShort(m.arrival.day)}`}
                </div>
              </ScaleLabel>
              <div className="absolute w-px" style={{ top: labelTop + 38, height: barTop - labelTop - 38 + BAR / 2, left: `${pos}%`, background: color }} />
              <div
                className="absolute rounded-full border-2"
                style={{ top: barTop + BAR / 2 - 7, left: `calc(${pos}% - 7px)`, width: 14, height: 14, background: m.tone === 'plan' ? color : 'var(--color-surface)', borderColor: color }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 space-y-1.5 text-[12px] text-text-secondary leading-relaxed">
        <p className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 inline-block h-2.5 w-4 shrink-0 rounded-sm" style={{ background: 'var(--color-category-body)', opacity: 0.55 }} />
          <span>
            Recommended: {perWeek(band.minPct)}–{perWeek(band.maxPct)} a week ({band.minPct}–{band.maxPct} % of body weight)
            {slow && fast && <>, arriving between <span className="tnum text-text-primary">{formatDayKeyLong(fast.arrival)}</span> and <span className="tnum text-text-primary">{formatDayKeyLong(slow.arrival)}</span> ({formatWeeks(fast.weeks).replace('~', '')}–{formatWeeks(slow.weeks).replace('~', '')})</>}.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 inline-block h-2.5 w-4 shrink-0 rounded-sm"
            style={{ background: 'repeating-linear-gradient(135deg, var(--color-category-attention) 0 3px, transparent 3px 7px)', opacity: 0.6 }}
          />
          <span>
            {cutting
              ? `Past about ${riskPct} % of body weight a week (${perWeek(riskPct)}), more of what is lost tends to be muscle, and recovery has less to work with.`
              : `Past about ${riskPct} % of body weight a week (${perWeek(riskPct)}), most of the extra is fat rather than muscle.`}
          </span>
        </p>
        {note && <p>{note}</p>}
      </div>

      {rows && rows.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-primary">Show as a table</summary>
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Pace options">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-3 font-medium">Pace</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Per week</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Weeks</th>
                  <th scope="col" className="py-2 font-medium">Around</th>
                </tr>
              </thead>
              <tbody>
                {/* Slowest first, like the scale reads left to right; the measured current pace stands out. */}
                {[...rows].sort((a, b) => a.kgPerWeek - b.kgPerWeek).map(r => (
                  <tr
                    key={r.id}
                    className={`border-b border-border/50 text-text-primary ${r.id === 'trend' ? 'bg-accent-tint font-medium' : ''}`}
                    aria-current={r.id === 'trend' ? 'true' : undefined}
                  >
                    <td className={`py-2 pr-3 ${r.id === 'trend' ? 'pl-2 rounded-l-control' : ''}`}>{r.label}</td>
                    <td className="py-2 pr-3 tnum whitespace-nowrap">{formatKg(r.kgPerWeek, units)} · {formatPct(r.pct, 2)}</td>
                    <td className="py-2 pr-3 tnum">{formatWeeks(r.weeks)}</td>
                    <td className={`py-2 tnum whitespace-nowrap ${r.id === 'trend' ? 'pr-2 rounded-r-control' : ''}`}>{formatDayKeyLong(r.arrival)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="mt-3">
        <DataStateNote>
          {band.basis}{' '}
          {span
            ? 'Slower usually costs a couple of weeks and keeps more muscle (or, when gaining, adds less fat).'
            : cutting
              ? 'Losing more slowly keeps more muscle.'
              : 'Gaining more slowly adds less fat.'}
        </DataStateNote>
      </div>
    </div>
  );
}

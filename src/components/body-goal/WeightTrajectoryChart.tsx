'use client';

// ── Weight trajectory chart ─────────────────────────────
//
// Weigh-ins as a thin muted line and the seven-day mean as the trend line.
// With a goal set, also the goal weight as a reference line and — dashed,
// clearly a projection — where the trend weight goes at the chosen rate. Once
// the goal is reached, the goal line becomes the maintenance range: the target
// as a dashed baseline inside the band of weights that count as holding it,
// drawn like the metric page's baseline band. The weigh-in line joins
// consecutive weigh-ins; it does not mean weight was measured in between. The
// trend line is the mean of the weigh-ins in each seven-day span, nothing more.

import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, diffDays, formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { mean } from '@/lib/analytics/stats';
import { convertValue } from '@/lib/metrics/format';
import type { UnitSystem } from '@/lib/prefs';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import type { DayValue } from '@/lib/body-goal/trend';
import { weightUnit } from './format';

/** The projection is drawn at most this far ahead, so a slow pace does not flatten the history. */
const MAX_PROJECTION_DAYS = 120;

interface Row {
  date: string;
  weighIn?: number;
  trend?: number;
  projected?: number;
}

export function WeightTrajectoryChart({
  weights, from, today, report, units,
}: {
  weights: DayValue[];
  /** First day of the history drawn (the section's window). */
  from: string;
  today: string;
  /** The goal's report, or null when no goal is set (no goal line, no projection). */
  report: BodyGoalReport | null;
  units: UnitSystem;
}) {
  const show = (kg: number) => Math.round(convertValue(kg, 'kg', units) * 10) / 10;
  const history = weights.filter(w => w.key >= from && w.key <= today);
  const byDay = new Map(history.map(w => [w.key, w.value]));

  const rows: Row[] = [];
  for (let day = from; day <= today; day = addDays(day, 1)) {
    const span = history.filter(w => w.key > addDays(day, -7) && w.key <= day);
    const row: Row = { date: day };
    if (byDay.has(day)) row.weighIn = show(byDay.get(day)!);
    if (span.length) row.trend = show(mean(span.map(w => w.value)));
    rows.push(row);
  }

  const chosen = report?.projection?.chosen ?? null;
  const current = report?.weight.current?.value ?? null;
  const goalKg = report?.goalWeightKg ?? null;
  if (chosen && current !== null && goalKg !== null) {
    const days = Math.min(MAX_PROJECTION_DAYS, diffDays(today, chosen.arrival));
    const perDay = (goalKg - current) / Math.max(1, diffDays(today, chosen.arrival));
    rows[rows.length - 1].projected = show(current);
    for (let i = 1; i <= days; i++) {
      rows.push({ date: addDays(today, i), projected: show(current + perDay * i) });
    }
  }

  const values = rows.flatMap(r => [r.weighIn, r.trend, r.projected]).filter((v): v is number => v !== undefined);
  const range = report?.maintenance ?? null;
  const hold = range ? { center: show(range.centerKg), low: show(range.lowKg), high: show(range.highKg) } : null;
  // At maintenance the range's centre stands in for the goal line.
  const goal = hold ? null : goalKg !== null ? show(goalKg) : null;
  if (goal !== null) values.push(goal);
  if (hold) values.push(hold.low, hold.high);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values));
  const unit = weightUnit(units);
  const axis = { tick: { fontSize: 10, fill: 'var(--color-text-secondary)' }, tickLine: false as const, axisLine: false as const };
  const summary = `Weight from ${formatDayKeyLong(from)} to ${formatDayKeyLong(today)}: ${history.length} weigh-ins${goal !== null ? `, goal ${goal} ${unit}` : ''}${hold ? `, maintaining ${hold.center} ${unit} within ${hold.low}–${hold.high} ${unit}` : ''}${chosen ? `, projected to reach it around ${formatDayKeyLong(chosen.arrival)} at the chosen rate` : ''}.`;

  return (
    <figure className="m-0">
      <div role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis {...axis} dataKey="date" minTickGap={40} interval="preserveStartEnd" tickFormatter={(v: string) => formatDayKeyShort(v)} />
            <YAxis {...axis} width={40} domain={[lo, hi]} ticks={ticks} allowDecimals={false} />
            <Tooltip cursor={{ stroke: 'var(--color-border)' }} content={<ChartTooltip unit={unit} />} />
            {/* An array, not a fragment: recharts reads its children with react-is 18,
                which does not recognise React 19 fragments, and drops what is inside one. */}
            {hold && [
              <ReferenceArea key="hold-band" y1={hold.low} y2={hold.high} fill="var(--color-category-body)" fillOpacity={0.12} stroke="none" />,
              <ReferenceLine
                key="hold-center"
                y={hold.center}
                stroke="var(--color-text-secondary)"
                strokeDasharray="4 4"
                strokeWidth={1}
                opacity={0.8}
                label={{ value: `Maintain ${hold.center} ${unit}`, position: 'insideTopRight', fontSize: 10, fill: 'var(--color-text-secondary)' }}
              />,
            ]}
            {[
              goal !== null && (
                <ReferenceLine
                  key="goal"
                  y={goal}
                  stroke="var(--color-category-body)"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  label={{ value: `Goal ${goal} ${unit}`, position: 'insideTopRight', fontSize: 10, fill: 'var(--color-text-secondary)' }}
                />
              ),
              chosen && <ReferenceLine key="today" x={today} stroke="var(--color-border-strong)" strokeWidth={1} />,
            ]}
            <Line dataKey="weighIn" stroke="var(--color-text-secondary)" strokeOpacity={0.45} strokeWidth={1.25} dot={false} activeDot={{ r: 3, fill: 'var(--color-text-secondary)', strokeWidth: 0 }} connectNulls isAnimationActive={false} />
            <Line dataKey="trend" stroke="var(--color-category-body)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="projected" stroke="var(--color-category-body)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span><span aria-hidden="true" className="inline-block h-px w-4 mr-1.5 align-middle" style={{ background: 'var(--color-text-secondary)', opacity: 0.6 }} />Weigh-ins</span>
        <span><span aria-hidden="true" className="inline-block h-0.5 w-4 bg-category-body mr-1.5 align-middle" />Seven-day average</span>
        {chosen && <span><span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-category-body mr-1.5 align-middle" />Projection at the chosen rate</span>}
        {hold && (
          <span title={range!.basis}>
            <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm mr-1.5 align-middle" style={{ background: 'var(--color-category-body)', opacity: 0.25 }} />
            Maintenance range {hold.low}–{hold.high} {unit}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Evenly spaced round ticks covering [min, max], about five of them. */
function niceTicks(min: number, max: number): { ticks: number[]; lo: number; hi: number } {
  const span = Math.max(1, max - min);
  const raw = span / 4;
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50].find(s => s >= raw) ?? Math.ceil(raw / 10) * 10;
  const lo = Math.floor((min - step * 0.25) / step) * step;
  const hi = Math.ceil((max + step * 0.25) / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 10) / 10);
  return { ticks, lo, hi };
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length || !label) return null;
  const get = (key: string) => payload.find(p => p.dataKey === key)?.value;
  const weighIn = get('weighIn');
  const trend = get('trend');
  const projected = get('projected');
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
      <div className="text-text-secondary">{formatDayKeyLong(label)}</div>
      {weighIn !== undefined && <div className="tnum text-text-primary">Weigh-in {weighIn} {unit}</div>}
      {trend !== undefined && <div className="tnum text-text-primary">Seven-day average {trend} {unit}</div>}
      {projected !== undefined && trend === undefined && <div className="tnum text-text-secondary">Projected {projected} {unit}</div>}
    </div>
  );
}

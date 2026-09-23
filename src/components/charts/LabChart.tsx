'use client';

// ── Lab charts: a trend, a range position, or a labelled reading ─────────────
//
// Follows `MetricChart.tsx` deliberately: the same CSS-variable tokens for every
// stroke and fill (so both themes are readable), the same tick styling, a
// tooltip that gives the date and the value with its unit, the unit named on the
// axis, and `role="img"` with a sentence a screen reader can read.
//
// THREE SHAPES, because three different things are true of these numbers:
//
//   * TWO OR MORE numeric observations  → a trend line across the observation
//     dates, with the reference interval shaded behind it;
//   * EXACTLY ONE numeric observation   → a compact horizontal range-position
//     chart: the interval band with the value marked inside or outside it. A
//     one-point trend line would be a lie about change over time;
//   * NO numeric observation            → nothing is plotted. `NEGATIVE`, `TRACE`
//     and `<0.5` are shown as labelled readings, never as a number.
//
// Every chart is accompanied by `LabObservationTable`, the accessible
// alternative, which carries the same rows in text.

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { TONE_COLOR } from '@/lib/lab/tone';
import type { LabChartModel } from '@/lib/lab/view';
import { chartDomain, formatNumber, formatReading } from '@/lib/lab/view';

const AXIS = {
  tick: { fontSize: 11, fill: 'var(--color-text-secondary)' },
  tickLine: false as const,
  axisLine: false as const,
};

// ── The trend chart (two or more numeric observations) ──────────────────────

interface TrendDatum {
  date: string;
  value: number;
  tone: string;
  statusLabel: string;
  reading: string;
}

function LabTooltip({ active, payload, unit }: any) {
  if (!active || !payload || !payload.length) return null;
  const datum = payload[0]?.payload as TrendDatum | undefined;
  if (!datum) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="text-text-secondary mb-1">{formatDayKeyShort(datum.date)}</div>
      <div className="tnum text-text-primary font-medium">{datum.reading}</div>
      <div className="text-text-secondary mt-0.5">{datum.statusLabel}</div>
      {unit && <div className="text-[10px] text-text-secondary mt-0.5">unit {unit}</div>}
    </div>
  );
}

function ToneDots(props: any) {
  const { cx, cy, payload } = props;
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;
  const datum = payload as TrendDatum | undefined;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      style={{ fill: datum?.tone ?? 'var(--color-accent)' }}
      stroke="var(--color-surface)"
      strokeWidth={1}
    />
  );
}

function LabTrend({
  model,
  analyteName,
  height,
  domain,
}: {
  model: LabChartModel;
  analyteName: string;
  height: number;
  domain: [number, number] | null;
}) {
  const data: TrendDatum[] = model.numeric.map(point => ({
    date: point.resultOn,
    value: point.value as number,
    tone: TONE_COLOR[point.tone],
    statusLabel: point.statusLabel,
    reading: formatReading(point),
  }));
  const band = model.band;
  const unit = model.unit && model.unit.trim().length > 0 ? model.unit : null;

  return (
    <div role="img" aria-label={`${analyteName} trend chart. ${describeTrend(model)}`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis {...AXIS} dataKey="date" minTickGap={32} tickFormatter={(v: string) => formatDayKeyShort(v)} />
          <YAxis
            {...AXIS}
            width={unit ? 62 : 46}
            domain={domain ? [domain[0], domain[1]] : ['auto', 'auto']}
            label={
              unit
                ? {
                    value: unit,
                    angle: -90,
                    position: 'insideLeft',
                    offset: 4,
                    style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
                  }
                : undefined
            }
            tickFormatter={(v: number) => formatNumber(v)}
          />
          <Tooltip content={<LabTooltip unit={unit} />} />
          {band && (band.low !== null || band.high !== null) && (
            <>
              <ReferenceArea
                y1={band.low ?? domain?.[0]}
                y2={band.high ?? domain?.[1]}
                fill="var(--color-accent)"
                fillOpacity={0.08}
                stroke="none"
              />
              {band.low !== null && (
                <ReferenceLine y={band.low} stroke="var(--color-border)" strokeDasharray="4 4" strokeWidth={1} />
              )}
              {band.high !== null && (
                <ReferenceLine y={band.high} stroke="var(--color-border)" strokeDasharray="4 4" strokeWidth={1} />
              )}
            </>
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-accent)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={<ToneDots />}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <ChartFootnote model={model} />
    </div>
  );
}

function describeTrend(model: LabChartModel): string {
  const values = model.numeric.map(point => point.value as number);
  const first = model.numeric[0]!;
  const last = model.numeric[model.numeric.length - 1]!;
  return `${model.numeric.length} observations from ${formatDayKeyLong(first.resultOn)} to ${formatDayKeyLong(
    last.resultOn
  )}, values ${formatNumber(Math.min(...values))} to ${formatNumber(Math.max(...values))}${
    model.unit ? ` ${model.unit}` : ''
  }. Latest ${formatReading(last)} on ${formatDayKeyLong(last.resultOn)}: ${last.statusLabel}.`;
}

// ── The range-position chart (exactly one numeric observation) ──────────────

function LabRangePosition({ model, analyteName }: { model: LabChartModel; analyteName: string }) {
  const point = model.numeric[0]!;
  const band = model.band;
  const domain = rangeDomain(model);
  const [min, max] = domain;
  const span = max - min || 1;
  const pct = (value: number) => ((value - min) / span) * 100;

  const bandLeft = band?.low !== null && band?.low !== undefined ? pct(band.low) : 0;
  const bandRight = band?.high !== null && band?.high !== undefined ? pct(band.high) : 100;
  const inside =
    band && band.low !== null && band.high !== null
      ? (point.value as number) >= band.low && (point.value as number) <= band.high
      : null;
  const markerPct = Math.min(98, Math.max(2, pct(point.value as number)));

  return (
    <figure className="mt-1">
      <figcaption className="sr-only">
        {`${analyteName} range position. One observation, ${formatReading(point)} on ${formatDayKeyLong(
          point.resultOn
        )}. ${positionSentence(inside, band?.text ?? null)}`}
      </figcaption>
      <div
        className="relative h-16 rounded-control border border-border bg-surface-muted/40 overflow-hidden"
        role="img"
        aria-label={`${analyteName}: one observation, ${formatReading(point)}, recorded ${formatDayKeyLong(
          point.resultOn
        )}. ${positionSentence(inside, band?.text ?? null)} Status: ${point.statusLabel}.`}
      >
        {/* The interval band. Drawn only when an interval actually applies. */}
        {band && (band.low !== null || band.high !== null) && (
          <div
            className="absolute inset-y-3 bg-accent-tint border-l border-r border-border"
            style={{ left: `${bandLeft}%`, width: `${Math.max(2, bandRight - bandLeft)}%` }}
            aria-hidden="true"
          />
        )}
        {/* The observed value. */}
        <div className="absolute inset-y-0" style={{ left: `${markerPct}%` }} aria-hidden="true">
          <div className="w-px h-full" style={{ backgroundColor: TONE_COLOR[point.tone] }} />
          <div
            className="absolute -translate-x-1/2 top-0 px-1.5 py-0.5 rounded text-[10px] tnum whitespace-nowrap bg-surface border border-border text-text-primary"
          >
            {formatNumber(point.value as number)}
            {inside === false ? ' · outside' : ''}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-[10px] text-text-secondary tnum">
        <span>{formatNumber(min)}</span>
        <span>
          interval {band?.text ?? 'none'} · {band?.provenance ?? 'not scored'}
        </span>
        <span>{formatNumber(max)}</span>
      </div>
      <p className="text-xs text-text-secondary mt-1">
        One observation, so there is no trend to draw: the value is shown against the interval it was scored
        against. Recorded {formatDayKeyLong(point.resultOn)} · {point.statusLabel}.
      </p>
    </figure>
  );
}

function positionSentence(inside: boolean | null, intervalText: string | null): string {
  if (inside === null) return `No reference interval applies, so its position in a range is not known.`;
  return `It falls ${inside ? 'inside' : 'outside'} the interval ${intervalText ?? ''}`.trim() + '.';
}

/** Bounds for the position chart, always wide enough to hold the band. */
function rangeDomain(model: LabChartModel): [number, number] {
  const value = model.numeric[0]!.value as number;
  const values = [value];
  if (model.band?.low !== null && model.band?.low !== undefined) values.push(model.band.low);
  if (model.band?.high !== null && model.band?.high !== undefined) values.push(model.band.high);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.15;
  return [min - pad, max + pad];
}

// ── The labelled readings (nothing numeric to plot) ─────────────────────────

function LabReadings({ model, analyteName }: { model: LabChartModel; analyteName: string }) {
  return (
    <div className="mt-1">
      <p className="text-xs text-text-secondary mb-2">
        {analyteName} has no numeric value in these observations, so nothing is plotted. Each reading is shown as
        the document printed it.
      </p>
      <ul className="list-none p-0 m-0 divide-y divide-border border border-border rounded-control">
        {model.readings.map(point => (
          <li key={point.resultId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="text-text-secondary tnum">{formatDayKeyLong(point.resultOn)}</span>
            <span className="text-text-primary font-medium">{formatReading(point)}</span>
            <span className="text-text-secondary text-xs">{point.statusLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── The chart, choosing its own shape ───────────────────────────────────────

export function LabChart({
  analyteName,
  model,
  height = 200,
  domain = null,
}: {
  analyteName: string;
  model: LabChartModel;
  height?: number;
  domain?: [number, number] | null;
}) {
  if (model.numeric.length === 0 && model.readings.length === 0) {
    return <p className="text-xs text-text-secondary">No observation is stored for this analyte.</p>;
  }
  if (model.mode === 'readings') return <LabReadings model={model} analyteName={analyteName} />;
  if (model.mode === 'range') return <LabRangePosition model={model} analyteName={analyteName} />;
  // The axis always spans the interval band as well as the values, so a band is
  // never silently clipped by an auto-scaled axis.
  return (
    <LabTrend
      model={model}
      analyteName={analyteName}
      height={height}
      domain={domain ?? chartDomain(model)}
    />
  );
}

/** The band's provenance, in words, under a chart. Never a colour alone. */
function ChartFootnote({ model }: { model: LabChartModel }) {
  const band = model.band;
  if (!band) return null;
  return (
    <p className="text-[10px] text-text-secondary mt-1 leading-relaxed">
      Shaded band: {band.text ?? 'no interval'} — {band.provenance}.
      {model.bandVaries
        ? ' The observations were not all scored against the same interval; the band shown is the one the latest value was scored against, and each row in the table carries its own.'
        : ''}
    </p>
  );
}

// ── The accessible alternative: the same rows, in text ─────────────────────

export interface LabTableRow {
  id: string;
  date: string;
  reading: string;
  interval: string | null;
  intervalProvenance: string;
  status: string;
  /** Source document and its date, when known. */
  source: string;
  /** Printed name and extraction pass, when known. */
  provenance: string | null;
  /** Why the row is unscored, when it is. */
  note: string | null;
}

export function LabObservationTable({
  rows,
  caption,
  showProvenance = false,
}: {
  rows: LabTableRow[];
  caption: string;
  showProvenance?: boolean;
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-sm text-left min-w-[640px]">
        <caption className="text-left text-xs text-text-secondary mb-2">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-text-secondary">
            <th scope="col" className="py-2 pr-4 font-medium">Observation date</th>
            <th scope="col" className="py-2 pr-4 font-medium">Value</th>
            <th scope="col" className="py-2 pr-4 font-medium">Status</th>
            <th scope="col" className="py-2 pr-4 font-medium">Interval</th>
            <th scope="col" className="py-2 pr-4 font-medium">Interval source</th>
            <th scope="col" className="py-2 font-medium">Source document</th>
            {showProvenance && <th scope="col" className="py-2 pl-4 font-medium">Row provenance</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-b border-border/50 align-top">
              <td className="py-2 pr-4 text-text-primary tnum whitespace-nowrap">{formatDayKeyLong(row.date)}</td>
              <td className="py-2 pr-4 text-text-primary tnum">{row.reading}</td>
              <td className="py-2 pr-4 text-text-secondary">{row.status}</td>
              <td className="py-2 pr-4 text-text-secondary tnum">{row.interval ?? 'none'}</td>
              <td className="py-2 pr-4 text-text-secondary">{row.intervalProvenance}</td>
              <td className="py-2 text-text-secondary">
                {row.source}
                {row.note && <span className="block text-[11px] mt-0.5">{row.note}</span>}
              </td>
              {showProvenance && (
                <td className="py-2 pl-4 text-text-secondary text-[11px]">
                  {row.provenance ?? 'no stored row provenance'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A stable key for a table row. */
export function rowKey(...parts: Array<string | number | null | undefined>): string {
  return parts.filter(part => part !== null && part !== undefined).join(':');
}

'use client';

// ── Lab charts: a trend, a range position, or a labelled reading ─────────────
//
// Follows `MetricChart.tsx` deliberately: the same CSS-variable tokens for every
// stroke and fill (so both themes are readable), the same tick styling, a
// tooltip that gives the date and the value with its unit, the unit named on the
// axis, and `role="img"` with a sentence a screen reader can read.
//
// THE REFERENCE INTERVAL IS DRAWN AS A BAND. The chart shows the good range
// itself, not just an in/out word: the interval is shaded across the chart, both
// limits are drawn as DASHED lines and LABELLED with their number and unit, and
// the source of the interval is named in text beneath the chart (`printed on the
// report` / `general reference interval`). The shading therefore never carries
// meaning by colour alone — the labels and the source line do that job — and a
// metric with NO interval draws no band at all and says so.
//
// WHAT IS DELIBERATELY NOT DRAWN, though a mock-up may show it: a dashed segment
// running to a separate grey dot. That is a PROJECTION, and Vital has no
// forecast model — only real observations are plotted. The band is never
// labelled "optimal": it is the reference interval the document printed (or the
// cited general interval), and that is the only basis anything here may claim.
//
// THREE SHAPES, because three different things are true of these numbers:
//
//   * TWO OR MORE numeric observations  → a trend line across the observation
//     dates, with the reference interval banded behind it;
//   * EXACTLY ONE numeric observation   → a compact horizontal range-position
//     chart: the interval band with the value marked inside or outside it. A
//     one-point trend line would be a lie about change over time;
//   * NO numeric observation            → nothing is plotted. `NEGATIVE`, `TRACE`
//     and `<0.5` are shown as labelled readings, never as a number.
//
// Every chart is accompanied by `LabObservationTable`, the accessible
// alternative, which carries the same rows in text. No element animates, so
// `prefers-reduced-motion` is respected by construction.

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import { TONE_COLOR } from '@/lib/lab/tone';
import type { LabChartModel, LabPoint } from '@/lib/lab/view';
import { chartDomain, formatNumber, formatReading, referenceRangeText } from '@/lib/lab/view';

const AXIS = {
  tick: { fontSize: 11, fill: 'var(--color-text-secondary)' },
  tickLine: false as const,
  axisLine: false as const,
};

/** A band limit labelled with its own number AND unit — never colour alone. */
function limitLabel(value: number, unit: string | null): string {
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

/** The band, in words, for a screen reader and for a reader who cannot see colour. */
function bandSentence(model: LabChartModel): string {
  const band = model.band;
  if (!band) return 'No reference interval with numeric limits applies, so no band is drawn.';
  const unit = model.unit && model.unit.trim().length > 0 ? ` ${model.unit}` : '';
  const parts: string[] = [];
  if (band.low !== null) parts.push(`low ${formatNumber(band.low)}${unit}`);
  if (band.high !== null) parts.push(`high ${formatNumber(band.high)}${unit}`);
  const source = band.source ? ` (source: ${band.source})` : '';
  return `Reference band ${parts.length > 0 ? parts.join(', ') : 'with no printed limit'}${source}.`;
}

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
          {/* The reference range itself, shaded behind the observations. The
              shading carries NO meaning by colour alone: it is LABELLED
              "Reference range", both limits are drawn as DASHED lines LABELLED
              with their number and unit, and the source is stated in words
              beneath the chart.

              THE FILL READS AS A BAND IN BOTH THEMES. `--color-accent` flips with
              the theme (dark green on the light surface, light green on the dark
              one), so one opacity is visible on white and on near-black alike; at
              the old 0.08 it was imperceptible on the light theme. The dashed
              limit lines are drawn in the secondary TEXT colour rather than the
              hairline border colour, so they are legible on the band instead of
              vanishing into it.

              These three are DIRECT children of the chart on purpose: recharts
              only enumerates reference elements it finds at the chart's own top
              level, so wrapping them in a Fragment (as an earlier revision did)
              dropped the band from the SVG entirely — the chart drew no band at
              all, in either theme. */}
          {band && (
            <ReferenceArea
              y1={band.low ?? domain?.[0]}
              y2={band.high ?? domain?.[1]}
              fill="var(--color-accent)"
              fillOpacity={0.22}
              stroke="none"
              isAnimationActive={false}
              label={{
                value: 'Reference range',
                position: 'insideTopLeft',
                fontSize: 10,
                fill: 'var(--color-text-secondary)',
              }}
            />
          )}
          {band && band.low !== null && (
            <ReferenceLine
              y={band.low}
              stroke="var(--color-text-secondary)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: limitLabel(band.low, unit),
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'var(--color-text-secondary)',
              }}
            />
          )}
          {band && band.high !== null && (
            <ReferenceLine
              y={band.high}
              stroke="var(--color-text-secondary)"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{
                value: limitLabel(band.high, unit),
                position: 'insideBottomRight',
                fontSize: 10,
                fill: 'var(--color-text-secondary)',
              }}
            />
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
  }. ${bandSentence(model)} Latest ${formatReading(last)} on ${formatDayKeyLong(
    last.resultOn
  )}: ${last.statusLabel}.`;
}

// ── The range-position chart (exactly one numeric observation) ──────────────

function LabRangePosition({ model, analyteName }: { model: LabChartModel; analyteName: string }) {
  const point = model.numeric[0]!;
  const band = model.band;
  const unit = model.unit && model.unit.trim().length > 0 ? model.unit : null;
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
        )}. ${positionSentence(inside, band?.text ?? null)} ${bandSentence(model)}`}
      </figcaption>
      <div
        className="relative h-20 rounded-control border border-border bg-surface-muted/40 overflow-hidden"
        role="img"
        aria-label={`${analyteName}: one observation, ${formatReading(point)}, recorded ${formatDayKeyLong(
          point.resultOn
        )}. ${positionSentence(inside, band?.text ?? null)} ${bandSentence(model)} Status: ${
          point.statusLabel
        }.`}
      >
        {/* The interval band, shaded. Drawn only when an interval actually applies. */}
        {band && (
          <div
            className="absolute inset-y-3 bg-accent-tint"
            style={{ left: `${bandLeft}%`, width: `${Math.max(2, bandRight - bandLeft)}%` }}
            aria-hidden="true"
          />
        )}
        {/* Both limits: a DASHED line, each LABELLED with its number and unit. */}
        {band?.low !== null && band?.low !== undefined && (
          <div className="absolute inset-y-0" style={{ left: `${bandLeft}%` }} aria-hidden="true">
            <div className="w-0 h-full border-l border-dashed border-text-secondary" />
            <span className="absolute -translate-x-1/2 top-0 px-1 text-[10px] tnum text-text-secondary bg-surface">
              {limitLabel(band.low, unit)}
            </span>
          </div>
        )}
        {band?.high !== null && band?.high !== undefined && (
          <div className="absolute inset-y-0" style={{ left: `${bandRight}%` }} aria-hidden="true">
            <div className="w-0 h-full border-l border-dashed border-text-secondary" />
            <span className="absolute -translate-x-1/2 bottom-0 px-1 text-[10px] tnum text-text-secondary bg-surface">
              {limitLabel(band.high, unit)}
            </span>
          </div>
        )}
        {/* The observed value. */}
        <div className="absolute inset-y-0" style={{ left: `${markerPct}%` }} aria-hidden="true">
          <div className="w-px h-full" style={{ backgroundColor: TONE_COLOR[point.tone] }} />
          <div className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] tnum whitespace-nowrap bg-surface border border-border text-text-primary">
            {formatNumber(point.value as number)}
            {inside === false ? ' · outside' : ''}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-[10px] text-text-secondary tnum">
        <span>{formatNumber(min)}</span>
        <span>
          reference interval {band?.text ?? 'none'}
          {band?.source ? ` · ${band.source}` : ''}
        </span>
        <span>{formatNumber(max)}</span>
      </div>
      <ChartFootnote model={model} />
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
      <ChartFootnote model={model} />
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

// ── The two compact cards beneath a chart ───────────────────────────────────

/**
 * Beneath the chart: the LATEST RESULT (value and unit, with its own observation
 * date) and the REFERENCE RANGE (low–high with the unit, and the source of the
 * interval in words). When no interval with numeric limits applies, the range
 * card says so plainly instead of showing an invented one.
 */
export function LabChartFacts({
  model,
  latest,
  className = '',
}: {
  model: LabChartModel;
  latest: LabPoint | null;
  className?: string;
}) {
  const band = model.band;
  const unit = model.unit && model.unit.trim().length > 0 ? model.unit : null;
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className}`}>
      <div className="rounded-control border border-border p-3">
        <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Latest result</div>
        <div className="text-lg font-semibold tnum text-text-primary leading-none">
          {latest ? formatReading(latest) : 'no observation'}
        </div>
        <div className="text-[11px] text-text-secondary mt-1 leading-relaxed">
          {latest
            ? `Observation date ${formatDayKeyLong(latest.resultOn)} · ${latest.statusLabel}`
            : 'No observation is stored for this analyte.'}
        </div>
      </div>
      <div className="rounded-control border border-border p-3">
        <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Reference range</div>
        {band ? (
          <>
            <div className="text-lg font-semibold tnum text-text-primary leading-none">
              {referenceRangeText(band, unit)}
            </div>
            <div className="text-[11px] text-text-secondary mt-1 leading-relaxed">
              {band.source ? `Interval ${band.source}.` : 'The interval’s source was not recorded.'}
              {band.text ? ` The report printed “${band.text}”.` : ''}
            </div>
          </>
        ) : (
          <div className="text-xs text-text-secondary leading-relaxed">
            No reference interval with numeric limits applies to this result, so{' '}
            <strong className="font-medium text-text-primary">no band is drawn</strong> — nothing is invented to
            fill the gap.
          </div>
        )}
      </div>
    </div>
  );
}

// ── The band's provenance, in words, under a chart ──────────────────────────

/** Never a colour alone, and never an invented range. */
function ChartFootnote({ model }: { model: LabChartModel }) {
  const band = model.band;
  if (!band) {
    return (
      <p className="text-[10px] text-text-secondary mt-1 leading-relaxed">
        No reference interval with numeric limits applies here, so no band is drawn.
      </p>
    );
  }
  return (
    <p className="text-[10px] text-text-secondary mt-1 leading-relaxed">
      Shaded band: the reference interval {band.text ?? 'the report printed'} —{' '}
      {band.source ? `source: ${band.source}` : band.provenance}.
      {model.bandVaries
        ? ' The observations were not all scored against the same interval; the band shown is the one the latest value was scored against, and each row in the table carries its own.'
        : ''}
    </p>
  );
}

// ── The accessible alternative: the same rows, in text ──────────────────────

export interface LabTableRow {
  id: string;
  date: string;
  reading: string;
  interval: string | null;
  intervalProvenance: string;
  status: string;
  /** Why the row carries no status, or the basis of its verdict, when either is known. */
  note: string | null;
  /** Printed name, extraction pass and report flag, when known. Never a document name. */
  provenance: string | null;
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
            <th scope="col" className="py-2 font-medium">Note</th>
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
              <td className="py-2 text-text-secondary text-[11px] leading-relaxed">{row.note ?? '—'}</td>
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

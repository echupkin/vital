'use client';

import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, Brush, CartesianGrid, BarChart, Bar,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { getMetric } from '@/lib/metrics';
import { formatMetricTick, formatMetricWithUnit, metricUnit, formatMetricValue } from '@/lib/metrics/format';
import type { UnitSystem } from '@/lib/prefs';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { tooltipDateLabel } from '@/lib/analytics/axis-dates';
import { useAxisDatePlan } from './useAxisDatePlan';

export interface ChartDataPoint {
  date: string;
  value: number;
  baseline?: number;
}

interface MetricChartProps {
  metricId: string;
  data: ChartDataPoint[];
  /** Mean + interquartile-ish band for the baseline reference area. */
  baselineBand?: { mean: number; low: number; high: number; label: string } | null;
  showBaseline?: boolean;
  height?: number;
  range?: string;
  showBrush?: boolean;
  units?: UnitSystem;
  /** Draw a marker at every observation — use for sparsely sampled metrics. */
  showDots?: boolean;
  className?: string;
}

function TooltipBox({ metricId, units, label, value }: {
  metricId: string;
  units: UnitSystem;
  label: string;
  value: number;
}) {
  const meta = getMetric(metricId);
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-sm">
      {/* ALWAYS the full date, year included. */}
      <div className="text-text-secondary text-xs mb-1">{tooltipDateLabel(label)}</div>
      <div className="font-medium tnum text-text-primary">
        {formatMetricWithUnit(metricId, value, units)}
      </div>
      {meta && (
        <div className="text-[10px] text-text-secondary mt-0.5">{meta.displayName}</div>
      )}
    </div>
  );
}

function MetricTooltip({ active, payload, label, metricId, units }: any) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload as ChartDataPoint | undefined;
  const value = payload.find((p: any) => p.dataKey === 'value')?.value ?? point?.value;
  if (value == null || typeof value !== 'number') return null;
  return <TooltipBox metricId={metricId} units={units} label={String(label)} value={value} />;
}

export function MetricChart({
  metricId,
  data,
  baselineBand,
  showBaseline = false,
  height = 280,
  showBrush = false,
  units = 'metric',
  showDots = false,
  className = '',
}: MetricChartProps) {
  const meta = getMetric(metricId);
  const isCount = meta?.aggregationStrategy === 'sum';
  const unit = metricUnit(metricId, units);

  // The axis form is decided from the MEASURED width of the labels at the tick
  // font, so a multi-year range keeps its year on the chart and never relies on
  // the tooltip alone. `minTickGap` is unchanged.
  const { ref, plan } = useAxisDatePlan(
    data.map(point => point.date),
    { minTickGap: 40, reservedWidth: (unit ? 62 : 48) + 10 }
  );

  if (data.length === 0) return null;

  const axisCommon = {
    tick: { fontSize: 11, fill: 'var(--color-text-secondary)' },
    tickLine: false as const,
    axisLine: false as const,
  };

  const yAxisLabel = unit
    ? {
        value: unit,
        angle: -90 as const,
        position: 'insideLeft' as const,
        offset: 4,
        style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
      }
    : undefined;

  const yAxis = (
    <YAxis
      {...axisCommon}
      width={unit ? 62 : 48}
      domain={['auto', 'auto']}
      label={yAxisLabel}
      tickFormatter={(v: number) => formatMetricTick(metricId, v, units)}
    />
  );

  const xAxis = (
    <XAxis
      {...axisCommon}
      dataKey="date"
      minTickGap={40}
      tickFormatter={(v: string) => plan.label(v)}
    />
  );

  const brush = showBrush && data.length > 60 ? (
    <Brush
      dataKey="date"
      height={32}
      travellerWidth={12}
      gap={1}
      stroke="var(--color-accent)"
      fill="var(--color-surface-muted)"
      tickFormatter={(v: string) => plan.label(v)}
    />
  ) : null;

  const summary = meta
    ? `${meta.displayName} chart${unit ? ` in ${unit}` : ''}, ${data.length} observations from ${formatDayKeyLong(
        data[0].date
      )} to ${formatDayKeyLong(data[data.length - 1].date)}, ranging ${formatMetricValue(
        metricId,
        Math.min(...data.map(d => d.value)),
        units
      )} to ${formatMetricValue(metricId, Math.max(...data.map(d => d.value)), units)}.`
    : `Chart with ${data.length} observations.`;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1 px-1">
        <span className="text-xs font-medium text-text-secondary">{meta?.displayName ?? metricId}</span>
        {unit && <span className="text-[10px] text-text-secondary tnum">y-axis: {unit}</span>}
      </div>
      <div ref={ref} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={height}>
          {isCount ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              {xAxis}
              {yAxis}
              <Tooltip content={<MetricTooltip metricId={metricId} units={units} />} />
              <Bar dataKey="value" fill="var(--color-category-activity)" radius={[3, 3, 0, 0]} maxBarSize={10} />
            </BarChart>
          ) : (
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`grad-${metricId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              {xAxis}
              {yAxis}
              <Tooltip content={<MetricTooltip metricId={metricId} units={units} />} />
              {showBaseline && baselineBand && (
                <>
                  <ReferenceArea
                    y1={baselineBand.low}
                    y2={baselineBand.high}
                    fill="var(--color-accent)"
                    fillOpacity={0.07}
                    stroke="none"
                  />
                  <ReferenceLine
                    y={baselineBand.mean}
                    stroke="var(--color-text-secondary)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    opacity={0.7}
                    label={{
                      value: baselineBand.label,
                      position: 'insideTopRight',
                      style: { fontSize: 10, fill: 'var(--color-text-secondary)' },
                    }}
                  />
                </>
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-accent)"
                strokeWidth={2}
                fill={`url(#grad-${metricId})`}
                dot={showDots ? { r: 2.5, fill: 'var(--color-accent)', strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: 'var(--color-accent)' }}
                isAnimationActive={false}
              />
              {brush}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Accessible data table ─────────────────────────────

interface DataTableProps {
  metricId: string;
  data: { date: string; value: number }[];
  units?: UnitSystem;
}

export function AccessibleDataTable({ metricId, data, units = 'metric' }: DataTableProps) {
  const meta = getMetric(metricId);
  const unit = metricUnit(metricId, units);
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${meta?.displayName || metricId} data table`}>
      <table className="w-full text-sm text-left">
        <caption className="text-left text-xs text-text-secondary mb-2">
          {meta?.displayName ?? metricId} — {data.length} most recent observations
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium text-text-secondary">Date</th>
            <th scope="col" className="py-2 font-medium text-text-secondary">Value</th>
            <th scope="col" className="py-2 pl-4 font-medium text-text-secondary">Unit</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.date} className="border-b border-border/50">
              <td className="py-1.5 pr-4 text-text-primary">{formatDayKeyLong(d.date)}</td>
              <td className="py-1.5 tnum text-text-primary">
                {formatMetricValue(metricId, d.value, units)}
              </td>
              <td className="py-1.5 pl-4 text-text-secondary">{unit || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Labelled inline trend (defect 7) ──────────────────

interface TrendFigureProps {
  metricId: string;
  data: { key: string; value: number }[];
  /** Visible caption: metric name, window and first → last values. */
  caption: string;
  height?: number;
  units?: UnitSystem;
  color?: string;
}

export function TrendFigure({ metricId, data, caption, height = 64, units = 'metric', color }: TrendFigureProps) {
  const meta = getMetric(metricId);
  const first = data[0];
  const last = data[data.length - 1];
  const label =
    first && last
      ? `${caption}. From ${formatMetricValue(metricId, first.value, units)} to ${formatMetricValue(
          metricId,
          last.value,
          units
        )}${metricUnit(metricId, units) ? ` ${metricUnit(metricId, units)}` : ''} across ${data.length} observations.`
      : caption;

  return (
    <figure className="mt-1">
      <figcaption className="text-xs text-text-secondary mb-1">{caption}</figcaption>
      {data.length >= 2 ? (
        <div role="img" aria-label={label}>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <XAxis dataKey="key" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color || 'var(--color-accent)'}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-text-secondary">Not enough observations in this window to draw a trend.</p>
      )}
    </figure>
  );
}

// ── Scatter (relationships) ───────────────────────────

export interface ScatterPoint {
  x: number;
  y: number;
  key: string;
}

export function RelationshipScatter({
  points,
  xMetricId,
  yMetricId,
  xLabel,
  yLabel,
  units = 'metric',
  height = 320,
}: {
  points: ScatterPoint[];
  xMetricId: string;
  yMetricId: string;
  xLabel: string;
  yLabel: string;
  units?: UnitSystem;
  height?: number;
}) {
  if (points.length === 0) return null;
  const xUnit = metricUnit(xMetricId, units);
  const yUnit = metricUnit(yMetricId, units);
  return (
    <div
      role="img"
      aria-label={`Scatter plot of ${xLabel} against ${yLabel} with ${points.length} paired days.`}
    >
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatMetricTick(xMetricId, v, units)}
            label={{
              value: xUnit ? `${xLabel} (${xUnit})` : xLabel,
              position: 'insideBottom',
              offset: -16,
              style: { fontSize: 11, fill: 'var(--color-text-secondary)' },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatMetricTick(yMetricId, v, units)}
            label={{
              value: yUnit ? `${yLabel} (${yUnit})` : yLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 4,
              style: { fontSize: 11, fill: 'var(--color-text-secondary)' },
            }}
          />
          <ZAxis range={[36, 36]} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0].payload as ScatterPoint;
              return (
                <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
                  <div className="text-text-secondary mb-1">{tooltipDateLabel(p.key)}</div>
                  <div className="tnum text-text-primary">
                    {xLabel}: {formatMetricWithUnit(xMetricId, p.x, units)}
                  </div>
                  <div className="tnum text-text-primary">
                    {yLabel}: {formatMetricWithUnit(yMetricId, p.y, units)}
                  </div>
                </div>
              );
            }}
          />
          <Scatter data={points} fill="var(--color-accent)" fillOpacity={0.6} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
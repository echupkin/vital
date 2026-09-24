'use client';

// ── Sleep stage chart (SPEC §7: "Sleep stages when supported by source data") ──
//
// One stacked bar per night, split into deep / core / REM / awake, with the
// time-asleep and time-in-bed totals stated alongside in the tooltip.
//
// Two facts this chart must never blur:
//   * time asleep and time in bed are different figures (in bed is always longer:
//     it includes the time taken to fall asleep and any time awake), and
//   * a night whose record carries no stage split is drawn as its *total* in a
//     neutral tone — no split is invented for it.

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatDurationHm } from '@/lib/metrics/format';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import type { SleepDay } from '@/lib/adapters/dataset';
import { useAxisDatePlan } from './useAxisDatePlan';

/** Stage → category palette. The legend labels each colour, so nothing is conveyed by colour alone. */
export const SLEEP_STAGE_META = [
  { key: 'deep', label: 'Deep', color: 'var(--color-category-sleep)', className: 'bg-category-sleep' },
  { key: 'core', label: 'Core', color: 'var(--color-category-activity)', className: 'bg-category-activity' },
  { key: 'rem', label: 'REM', color: 'var(--color-category-recovery)', className: 'bg-category-recovery' },
  { key: 'awake', label: 'Awake in bed', color: 'var(--color-category-attention)', className: 'bg-category-attention' },
] as const;

export interface StageRow {
  key: string;
  deep: number;
  core: number;
  rem: number;
  awake: number;
  /**
   * A night whose record carries no stage split is drawn as its in-bed window in
   * a neutral tone — never split into sleep stages, because none were recorded.
   */
  unrecorded: number;
  asleep: number;
  inBed: number;
  hasStages: boolean;
}

/** The stacked-bar datum for one night. Exported so the no-split rule is testable. */
export function sleepStageRow(day: SleepDay): StageRow {
  const { deep, core, rem, awake } = day.stages;
  const hasStages = deep + core + rem > 0;
  return {
    key: day.key,
    deep: hasStages ? deep : 0,
    core: hasStages ? core : 0,
    rem: hasStages ? rem : 0,
    awake: hasStages ? awake : 0,
    unrecorded: hasStages ? 0 : day.inBedMinutes,
    asleep: day.asleepMinutes,
    inBed: day.inBedMinutes,
    hasStages,
  };
}

export function sleepStageRows(nights: SleepDay[]): StageRow[] {
  return nights.map(sleepStageRow);
}

function StageTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload as StageRow | undefined;
  if (!row) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs max-w-[240px]">
      <div className="text-text-secondary mb-1">{formatDayKeyLong(row.key)}</div>
      {row.hasStages ? (
        <ul className="list-none p-0 m-0 space-y-0.5">
          {SLEEP_STAGE_META.map(stage => (
            <li key={stage.key} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-text-secondary">
                <span className={`w-2 h-2 rounded-full ${stage.className}`} aria-hidden="true" />
                {stage.label}
              </span>
              <span className="tnum text-text-primary">{formatDurationHm(row[stage.key])}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-primary">
          No stage split recorded for this night — the bar is its in-bed window {formatDurationHm(row.inBed)}.
        </p>
      )}
      <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-secondary">Time asleep</span>
          <span className="tnum text-text-primary">
            {row.hasStages ? formatDurationHm(row.asleep) : `${formatDurationHm(row.asleep)} (not recorded)`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-secondary">Time in bed</span>
          <span className="tnum text-text-primary">{formatDurationHm(row.inBed)}</span>
        </div>
      </div>
      <p className="text-[10px] text-text-secondary mt-1.5">
        {row.hasStages
          ? 'Stages are recorded by the source device. Awake is time awake inside the in-bed window; the difference from time in bed is the time taken to fall asleep.'
          : 'The source recorded no sleep stages for this night, so none are inferred for it.'}
      </p>
    </div>
  );
}

export function SleepStageChart({
  nights,
  height = 300,
  showBrush = false,
}: {
  nights: SleepDay[];
  height?: number;
  showBrush?: boolean;
}) {
  void showBrush;
  // The x axis labels one bar per NIGHT, and a long window spans years: the
  // date form is decided from the measured label widths, exactly as on the lab
  // and metric charts, so the year is on the axis and not only on hover.
  const { ref, plan } = useAxisDatePlan(
    nights.map(day => day.key),
    { minTickGap: 40, reservedWidth: 52 + 0 + 8 }
  );
  if (nights.length === 0) return null;
  const rows = sleepStageRows(nights);
  const withStages = rows.filter(r => r.hasStages).length;
  const summary =
    `Sleep stages by night, ${rows.length} nights. ` +
    (withStages === rows.length
      ? 'Every night carries a deep, core, REM and awake split.'
      : `${withStages} of ${rows.length} nights carry a stage split; a night without one is drawn as its in-bed window with no split inferred.`) +
    ` Each night also states time asleep and time in bed.`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2 px-1">
        {SLEEP_STAGE_META.map(stage => (
          <span key={stage.key} className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className={`w-2.5 h-2.5 rounded-sm ${stage.className}`} aria-hidden="true" />
            {stage.label}
          </span>
        ))}
        {withStages < rows.length && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="w-2.5 h-2.5 rounded-sm bg-surface-muted border border-border" aria-hidden="true" />
            No stage split (in-bed window)
          </span>
        )}
      </div>

      <div ref={ref} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="key"
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(v: string) => plan.label(v)}
            />
            <YAxis
              width={52}
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatDurationHm(v)}
            />
            <Tooltip content={<StageTooltip />} cursor={{ fill: 'var(--color-surface-muted)', opacity: 0.4 }} />
            {/* Stack order, bottom → top: awake, core, REM, deep. */}
            <Bar dataKey="awake" name="Awake in bed" stackId="night" fill="var(--color-category-attention)" stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="unrecorded" name="No stage split" stackId="night" fill="var(--color-surface-muted)" stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="core" name="Core" stackId="night" fill="var(--color-category-activity)" stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="rem" name="REM" stackId="night" fill="var(--color-category-recovery)" stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="deep" name="Deep" stackId="night" fill="var(--color-category-sleep)" stroke="var(--color-surface)" strokeWidth={1} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * The accessible tabular alternative for the stage chart: one row per night with
 * every stage column plus the asleep and in-bed totals, so the chart carries no
 * information a screen-reader user cannot reach.
 */
export function SleepStageTable({ nights }: { nights: SleepDay[] }) {
  const rows = sleepStageRows(nights);
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sleep stages by night, data table">
      <table className="w-full text-sm text-left">
        <caption className="text-left text-xs text-text-secondary mb-2">
          Sleep stages by night — {nights.length} most recent nights, in minutes where a split was recorded
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-text-secondary">
            <th scope="col" className="py-2 pr-4 font-medium">Night</th>
            <th scope="col" className="py-2 pr-4 font-medium">Deep</th>
            <th scope="col" className="py-2 pr-4 font-medium">Core</th>
            <th scope="col" className="py-2 pr-4 font-medium">REM</th>
            <th scope="col" className="py-2 pr-4 font-medium">Awake in bed</th>
            <th scope="col" className="py-2 pr-4 font-medium">Asleep</th>
            <th scope="col" className="py-2 font-medium">In bed</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map(row => (
            <tr key={row.key} className="border-b border-border/50">
              <td className="py-1.5 pr-4 text-text-primary">{formatDayKeyLong(row.key)}</td>
              {row.hasStages ? (
                <>
                  <td className="py-1.5 pr-4 tnum text-text-primary">{formatDurationHm(row.deep)}</td>
                  <td className="py-1.5 pr-4 tnum text-text-primary">{formatDurationHm(row.core)}</td>
                  <td className="py-1.5 pr-4 tnum text-text-primary">{formatDurationHm(row.rem)}</td>
                  <td className="py-1.5 pr-4 tnum text-text-primary">{formatDurationHm(row.awake)}</td>
                </>
              ) : (
                <td className="py-1.5 pr-4 text-text-secondary" colSpan={4}>
                  No stage split recorded for this night
                </td>
              )}
              <td className="py-1.5 pr-4 tnum text-text-primary">
                {row.hasStages ? formatDurationHm(row.asleep) : `${formatDurationHm(row.asleep)} (not recorded)`}
              </td>
              <td className="py-1.5 tnum text-text-primary">{formatDurationHm(row.inBed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { formatMetricValue, formatMetricWithUnit } from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
  REFERENCE_TZ,
  sleepSeries,
  sleepCoverageSummary,
  seriesFor,
  coverageFor,
  hasSleepStages,
  type SleepDay,
} from '@/lib/adapters/dataset';
import {
  buildSeriesSummary,
  formatDayKeyLong,
  formatDayKeyShort,
  median,
  stddev,
  mean,
  trailingWindow,
  windowRangeLabel,
} from '@/lib/analytics';
import { useState } from 'react';
import { Card, Badge, DataStateNote, InsufficientDataState } from '@/components/ui/primitives';
import { MetricChart, TrendFigure, SleepStageChart, SleepStageTable, SLEEP_STAGE_META } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import {
  DomainHeader, SectionTitle, SeriesCard, CoverageNote, MetricGrid, metricsForCategories,
} from './DomainShared';

const DAYS = 30;
const LONG_DAYS = 90;

export function SleepPage() {
  const { units } = useUnits();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  // Every night, including a record that carries only an in-bed window: it is a
  // night, and the stage chart draws it as its in-bed bar with no split inferred.
  const all = sleepSeries();
  // The time-asleep population. A record with no stage split has no time-asleep
  // value at all, so it is excluded from every time-asleep figure below — never
  // averaged in as a zero.
  const stagedNights = all.filter(hasSleepStages);
  const latest: SleepDay | undefined = all[all.length - 1];
  const latestStagesRecorded = latest ? hasSleepStages(latest) : false;
  const coverage = sleepCoverageSummary(all);
  const last90 = all.filter(s => s.key >= trailingWindow(REFERENCE_KEY, LONG_DAYS).startKey);
  const last90Staged = stagedNights.filter(s => s.key >= trailingWindow(REFERENCE_KEY, LONG_DAYS).startKey);
  const last30 = stagedNights.filter(s => s.key >= trailingWindow(REFERENCE_KEY, DAYS).startKey);
  const last30All = all.filter(s => s.key >= trailingWindow(REFERENCE_KEY, DAYS).startKey);

  const asleepSummary = buildSeriesSummary('sleep_analysis', REFERENCE_KEY, DAYS, units);
  const inBedSummary = buildSeriesSummary('sleep_in_bed', REFERENCE_KEY, DAYS, units);
  const hasCompareWindow = asleepSummary.points.length > 0 || inBedSummary.points.length > 0;

  const bedtimeStats = bedtimeStatsFor(last30All);
  const durationValues = last30.map(s => s.asleepMinutes);
  // Awake-in-bed is only defined where a stage split was recorded; for an
  // in-bed-only record the whole window would otherwise read as awake time.
  const awakeInBedValues = last30.map(s => s.inBedMinutes - s.asleepMinutes);

  // Owner request 2: with no episodes at all, nothing is drawn — not even an
  // empty state box or a stranded heading.
  if (all.length === 0) {
    return (
      <div className="space-y-6">
        <DomainHeader title="Sleep" subtitle="No sleep episodes are present in this dataset." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Sleep"
        subtitle={`Latest episode, stages, duration, consistency and recovery across ${windowRangeLabel(trailingWindow(REFERENCE_KEY, LONG_DAYS))}. Nights are assigned to the waking date.`}
      />

      {/* ── Latest episode ─────────────────────────── */}
      <section>
        <SectionTitle hint={latest ? `${formatDayKeyLong(latest.key)}` : undefined}>
          Latest sleep episode
        </SectionTitle>
        {latest ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-text-secondary">
                  Night of {formatDayKeyLong(latest.key)}
                </span>
                <Badge variant="default" className="text-[10px]">{latest.source}</Badge>
              </div>
              <dl className="text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Bedtime</dt>
                  <dd className="tnum text-text-primary">{localTime(latest.bedtime)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Wake time</dt>
                  <dd className="tnum text-text-primary">{localTime(latest.wakeTime)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Time asleep</dt>
                  <dd className="tnum text-text-primary font-medium">
                    {latestStagesRecorded
                      ? formatMetricWithUnit('sleep_analysis', latest.asleepMinutes, units)
                      : 'No stage split recorded'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Time in bed</dt>
                  <dd className="tnum text-text-primary">
                    {formatMetricWithUnit('sleep_analysis', latest.inBedMinutes, units)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Awake in bed</dt>
                  <dd className="tnum text-text-primary">
                    {latestStagesRecorded
                      ? formatMetricWithUnit('sleep_analysis', latest.inBedMinutes - latest.asleepMinutes, units)
                      : 'Not recorded'}
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <Link href="/metric/sleep_analysis" className="text-sm text-primary hover:underline">
                  Open sleep detail
                </Link>
              </div>
            </Card>

            <Card className="p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-xs font-medium text-text-secondary">Stage breakdown, latest episode</p>
                <span className="text-[10px] text-text-secondary tnum">
                  in bed {formatMetricWithUnit('sleep_analysis', latest.inBedMinutes, units)}
                </span>
              </div>
              <StageBar stages={latest.stages} asleepMinutes={latest.asleepMinutes} />
              <ul className="list-none p-0 m-0 mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {SLEEP_STAGE_META.map(s => (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.className}`} aria-hidden="true" />
                    <span className="text-text-secondary">{s.label}</span>
                    <span className="tnum text-text-primary ml-auto">
                      {formatMetricValue('sleep_analysis', latest.stages[s.key], units)}
                    </span>
                  </li>
                ))}
              </ul>
              {!hasSleepStages(latest) && (
                <p className="mt-3 text-xs text-text-secondary">
                  This night has no recorded stage split, so it is shown as its total with no stages
                  inferred.
                </p>
              )}
              <div className="mt-3">
                <DataStateNote>
                  Stage totals are recorded by the source device; deep, REM and core sum to time
                  asleep.{' '}
                  {latestStagesRecorded
                    ? `Awake is the time awake inside the in-bed window, which is why time in bed (${formatMetricWithUnit(
                        'sleep_analysis',
                        latest.inBedMinutes,
                        units
                      )}) is longer than time asleep (${formatMetricWithUnit(
                        'sleep_analysis',
                        latest.asleepMinutes,
                        units
                      )}).`
                    : `This night's record carries an in-bed window of ${formatMetricWithUnit(
                        'sleep_analysis',
                        latest.inBedMinutes,
                        units
                      )} and no stage split, so no time-asleep figure is shown for it.`}
                </DataStateNote>
              </div>
            </Card>
          </div>
        ) : (
          <InsufficientDataState metricName="the latest sleep episode" />
        )}
      </section>

      {/* ── Sleep stages by night (the main sleep chart) ── */}
      {last90.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-[20px] md:text-[24px] font-semibold text-text-primary">Sleep stages by night</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {windowRangeLabel(trailingWindow(REFERENCE_KEY, LONG_DAYS))} · {last90.length} nights
              </p>
            </div>
            <div className="flex rounded-control overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => setView('chart')}
                aria-pressed={view === 'chart'}
                className={`px-3 py-1.5 text-xs font-medium min-h-[32px] ${
                  view === 'chart' ? 'bg-surface text-text-primary' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                Chart
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                aria-pressed={view === 'table'}
                className={`px-3 py-1.5 text-xs font-medium min-h-[32px] ${
                  view === 'table' ? 'bg-surface text-text-primary' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                Table
              </button>
            </div>
          </div>
          <Card className="p-4 md:p-6">
            {view === 'chart' ? (
              <SleepStageChart nights={last90} height={300} />
            ) : (
              <SleepStageTable nights={[...last90].slice(-60)} />
            )}
            <div className="mt-3 space-y-1">
              <DataStateNote>
                Each bar is one night, split into deep, core, REM and time awake inside the in-bed
                window (bottom to top). A night whose record carries no stage split is drawn as a
                single neutral bar equal to its in-bed window: the split is not inferred for it.
              </DataStateNote>
              <DataStateNote>
                Time asleep and time in bed are different figures and both are stated in the tooltip:
                time in bed is always longer, because it includes any time awake inside the window and
                the time taken to fall asleep, which is not recorded.
              </DataStateNote>
            </div>
          </Card>
        </section>
      )}

      {/* ── Duration timeline (time asleep) ───────── */}
      {last90Staged.length > 0 && (
        <section>
          <SectionTitle hint={`${windowRangeLabel(trailingWindow(REFERENCE_KEY, LONG_DAYS))} · ${last90Staged.length} nights with a stage split`}>
            Time asleep timeline
          </SectionTitle>
          <Card className="p-4 md:p-6">
            <MetricChart
              metricId="sleep_analysis"
              data={last90Staged.map(s => ({ date: s.key, value: s.asleepMinutes }))}
              units={units}
              height={300}
              showBrush={last90Staged.length > 60}
            />
            <div className="mt-3">
              <DataStateNote>
                This line is time asleep only — the same total the stage chart stacks. Gaps are nights
                without a recorded episode, and a night whose record carries only an in-bed window
                ({coverage.inBedOnlyNights} of {coverage.nights} records here); a missing night is not
                a night of zero sleep, and an in-bed-only night has no time-asleep value at all.
              </DataStateNote>
            </div>
          </Card>
        </section>
      )}

      {/* ── Asleep vs in bed ──────────────────────── */}
      {hasCompareWindow && (
        <section>
          <SectionTitle hint={`last ${DAYS} nights vs the ${DAYS} before`}>
            Time asleep and time in bed
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SeriesCard summary={asleepSummary} days={DAYS} />
            <SeriesCard summary={inBedSummary} days={DAYS} />
          </div>
          <div className="mt-4 space-y-1">
            <DataStateNote>
              Time asleep is the figure used everywhere else in the app. Time in bed is always longer:
              it includes the time taken to fall asleep and any time awake during the night. Over the
              last {DAYS} nights the difference averaged{' '}
              {formatMetricWithUnit('sleep_analysis', mean(awakeInBedValues), units)} across the{' '}
              {awakeInBedValues.length} nights that carry a stage split.
            </DataStateNote>
            <DataStateNote>
              Time in bed includes every night with a recorded in-bed window. Time asleep includes only
              the nights whose record carries a stage split: {coverage.nightsWithStages} of{' '}
              {coverage.nights} nights here, with {coverage.inBedOnlyNights}{' '}
              {coverage.inBedOnlyNights === 1 ? 'night carrying' : 'nights carrying'} only an in-bed
              window.
            </DataStateNote>
          </div>
        </section>
      )}

      {/* ── Consistency (only with recorded nights in the window) ── */}
      {last30.length > 0 && (
        <section>
        <SectionTitle hint={`across the last ${last30All.length} recorded nights`}>
          Consistency and bedtime variability
        </SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5">
            <p className="text-xs font-medium text-text-secondary mb-3">Bedtime</p>
            <div className="text-2xl font-semibold tnum text-text-primary mb-1">
              {bedtimeStats.medianLabel}
            </div>
            <p className="text-xs text-text-secondary">
              Typical bedtime (median). Earliest {bedtimeStats.earliestLabel}, latest{' '}
              {bedtimeStats.latestLabel}. Bedtimes come from the recorded in-bed window, so a night
              with no stage split still counts here.
            </p>
            <p className="text-xs text-text-secondary mt-2">
              Spread: {bedtimeStats.spreadMinutes.toFixed(0)} minutes between the 25th and 75th
              percentile; standard deviation {bedtimeStats.stdMinutes.toFixed(0)} minutes.
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs font-medium text-text-secondary mb-3">Duration variability</p>
            <div className="text-2xl font-semibold tnum text-text-primary mb-1">
              {formatMetricValue('sleep_analysis', stddev(durationValues), units)}
            </div>
            <p className="text-xs text-text-secondary">
              Standard deviation of time asleep over the {durationValues.length} nights in this window
              that carry a stage split. Median{' '}
              {formatMetricValue('sleep_analysis', median(durationValues), units)}, average{' '}
              {formatMetricValue('sleep_analysis', mean(durationValues), units)}. A night with no stage
              split is left out rather than counted as zero.
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs font-medium text-text-secondary mb-3">Coverage</p>
            <ul className="text-xs space-y-1 list-none p-0 m-0">
              {/* Every "night" figure on this page is a night, not a record and
                  not a calendar day: they are all taken from the one de-duplicated
                  night series, so they cannot disagree with each other. The
                  calendar-day coverage is stated as days, on its own row. */}
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">Nights recorded</span>
                <span className="tnum text-text-primary">{coverage.nights}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">With a stage split</span>
                <span className="tnum text-text-primary">
                  {coverage.nightsWithStages} of {coverage.nights} nights
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">In-bed window only</span>
                <span className="tnum text-text-primary">{coverage.inBedOnlyNights}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">Calendar days covered</span>
                <span className="tnum text-text-primary">
                  {coverageFor('sleep_analysis')?.observedDays ?? all.length} of{' '}
                  {coverageFor('sleep_analysis')?.expectedDays ?? '—'} days
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">Sampling</span>
                <span className="text-text-primary">{coverageFor('sleep_analysis')?.samplingFrequency ?? 'nightly'}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-text-secondary">Sources</span>
                <span className="text-text-primary text-right">
                  {coverageFor('sleep_analysis')?.sourceNames.join(', ') ?? '—'}
                </span>
              </li>
            </ul>
            <div className="mt-3 space-y-1">
              <DataStateNote>
                {coverage.nightsWithStages} of {coverage.nights} nights carry a stage split;
                {' '}{coverage.inBedOnlyNights}{' '}
                {coverage.inBedOnlyNights === 1 ? 'night carries' : 'nights carry'} only an in-bed
                window. Those nights count towards time in bed and towards coverage, and are excluded
                from every time-asleep figure — a night with no stage split is not a night of zero
                sleep.
              </DataStateNote>
              <DataStateNote>
                A repeated export of the same in-bed episode is one night, not two: an episode is
                identified by its in-bed window and its recorded totals.
              </DataStateNote>
              <DataStateNote>
                A consistent bedtime is a description of your recorded pattern, not a target and not
                a statement about your health.
              </DataStateNote>
            </div>
          </Card>
        </div>
        </section>
      )}

      {/* ── Sleep and recovery, aligned ───────────── */}
      {last90Staged.length > 0 && (
        <section>
          <SectionTitle hint="same date window, same x-axis">
            Sleep and recovery
          </SectionTitle>
          <Card className="p-4 md:p-6 space-y-6">
            <AlignedPair
              title="Time asleep"
              metricId="sleep_analysis"
              windowDays={LONG_DAYS}
              units={units}
            />
            <AlignedPair
              title="HRV"
              metricId="heart_rate_variability"
              windowDays={LONG_DAYS}
              units={units}
              showXAxis
            />
            <DataStateNote>
              These two charts cover exactly the same dates so the shapes can be compared. An apparent
              alignment between them is an observation about your recorded data, not evidence that one
              causes the other.
            </DataStateNote>
          </Card>
        </section>
      )}

      {/* ── Registry-derived extras ───────────────── */}
      <MetricGrid
        metrics={metricsForCategories(['sleep'], ['sleep_analysis', 'sleep_in_bed'])}
        title="Other sleep-related metrics"
        days={DAYS}
      />

      <CoverageNote metricIds={['sleep_analysis', 'sleep_in_bed', 'heart_rate_variability']} />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────

function StageBar({ stages, asleepMinutes }: { stages: SleepDay['stages']; asleepMinutes: number }) {
  const recorded = stages.deep + stages.rem + stages.core;
  if (recorded <= 0) {
    return <p className="text-xs text-text-secondary">No stage data recorded for this night.</p>;
  }
  const meta = (key: (typeof SLEEP_STAGE_META)[number]['key']) =>
    SLEEP_STAGE_META.find(s => s.key === key)!;
  const segments = [
    { key: 'awake' as const, minutes: stages.awake },
    { key: 'core' as const, minutes: stages.core },
    { key: 'rem' as const, minutes: stages.rem },
    { key: 'deep' as const, minutes: stages.deep },
  ].filter(s => s.minutes > 0);
  const total = segments.reduce((a, s) => a + s.minutes, 0) || asleepMinutes;
  return (
    <div
      className="flex h-4 w-full rounded-full overflow-hidden bg-surface-muted"
      role="img"
      aria-label={`${segments
        .map(s => `${meta(s.key).label} ${formatMetricValue('sleep_analysis', s.minutes, 'metric')}`)
        .join(', ')}. Time asleep ${formatMetricValue('sleep_analysis', asleepMinutes, 'metric')}.`}
    >
      {segments.map(s => (
        <span
          key={s.key}
          className={meta(s.key).className}
          style={{ width: `${(s.minutes / total) * 100}%` }}
          title={`${meta(s.key).label}: ${Math.round(s.minutes)} min`}
        />
      ))}
    </div>
  );
}

function AlignedPair({
  title, metricId, windowDays, units, showXAxis = false,
}: {
  title: string;
  metricId: string;
  windowDays: number;
  units: 'metric' | 'imperial';
  showXAxis?: boolean;
}) {
  const win = trailingWindow(REFERENCE_KEY, windowDays);
  const points = seriesFor(metricId).filter(p => p.key >= win.startKey && p.key <= win.endKey);
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1">
        {title} · {windowRangeLabel(win)} · {points.length} observations
      </p>
      <TrendFigure
        metricId={metricId}
        data={points}
        caption={`${title} in ${units === 'metric' ? 'canonical' : 'preferred'} units`}
        height={72}
      />
      {showXAxis && (
        <div className="flex justify-between text-[10px] text-text-secondary mt-1">
          <span>{formatDayKeyShort(win.startKey)}</span>
          <span>{formatDayKeyShort(win.endKey)}</span>
        </div>
      )}
    </div>
  );
}

interface BedtimeStats {
  medianLabel: string;
  earliestLabel: string;
  latestLabel: string;
  spreadMinutes: number;
  stdMinutes: number;
}

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: REFERENCE_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Local wall-clock time of an ISO instant in the dataset timezone. */
function localTime(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/**
 * Bedtimes are placed on a clock whose day starts at noon, so 11:30pm and 12:15am
 * stay close together instead of being 23 hours apart.
 */
function minutesSinceNoon(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REFERENCE_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  const shifted = hour < 12 ? hour + 24 : hour;
  return shifted * 60 + minute;
}

function labelFromMinutesSinceNoon(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function bedtimeStatsFor(nights: SleepDay[]): BedtimeStats {
  const minutes = nights.map(n => minutesSinceNoon(n.bedtime));
  if (minutes.length === 0) {
    return {
      medianLabel: 'No recorded bedtimes',
      earliestLabel: '—',
      latestLabel: '—',
      spreadMinutes: NaN,
      stdMinutes: NaN,
    };
  }
  const sorted = [...minutes].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const sd = stddev(minutes);
  return {
    medianLabel: labelFromMinutesSinceNoon(median(minutes)),
    earliestLabel: labelFromMinutesSinceNoon(sorted[0]),
    latestLabel: labelFromMinutesSinceNoon(sorted[sorted.length - 1]),
    spreadMinutes: (q3 ?? 0) - (q1 ?? 0),
    stdMinutes: Number.isFinite(sd) ? sd : NaN,
  };
}
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Info, ChevronDown } from 'lucide-react';
import { getMetric, getAllMetrics } from '@/lib/metrics';
import {
  formatMetricValue,
  formatMetricWithUnit,
  formatPercent,
  describeChange,
  metricUnit,
} from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
  WINDOW_START_KEY,
  canonicalDayKey,
  datasetProvenanceSentence,
  metricHasData,
  seriesFor,
  sleepSeries,
  hasSleepStages,
  bloodPressureSeries,
  coverageFor,
  isAccumulating,
  pointOn,
  unavailableReasonFor,
  type DayPoint,
} from '@/lib/adapters/dataset';
import {
  diffDays,
  formatDayKeyLong,
  previousWindow,
  trailingWindow,
  windowRangeLabel,
  windowDays,
  detectAnomalies,
  median,
  type DayWindow,
} from '@/lib/analytics';
import { compareValues, stddev, mean, percentChange } from '@/lib/analytics';
import {
  Card, Badge, InsufficientDataState, SegmentedControl, StaleBadge, ChangeCue, DataStateNote,
} from '@/components/ui/primitives';
import { MetricChart, AccessibleDataTable } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';

const RANGE_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const EVALUATED_DAYS = 7;
const BASELINE_DAYS = 30;

export function MetricDetailPage() {
  const params = useParams();
  const metricId = params.metricId as string;
  const meta = getMetric(metricId);

  if (!meta) {
    return (
      <div className="space-y-6">
        <BackLink />
        <InsufficientDataState
          metricName="this metric"
          message={`No metric is registered with the id "${metricId}". It may have been removed, or the link may be out of date.`}
        />
        <div>
          <Link href="/" className="text-sm text-primary hover:underline">
            Return to Overview
          </Link>
        </div>
      </div>
    );
  }

  return <MetricDetailContent metaId={metricId} />;
}

const RANGE_TOKENS = ['7d', '30d', '90d', '1y', 'all'];

function MetricDetailContent({ metaId }: { metaId: string }) {
  const units = useUnits().units;
  const dataMeta = useDatasetMeta();
  const meta = getMetric(metaId)!;
  const searchParams = useSearchParams();
  // An evidence link such as /metric/sleep_analysis?range=90d opens the metric
  // at the period the insight was computed over.
  const requestedRange = searchParams.get('range');
  const [range, setRange] = useState<string>(
    requestedRange && RANGE_TOKENS.includes(requestedRange) ? requestedRange : meta.defaultRange || '30d'
  );
  const [showBaseline, setShowBaseline] = useState(true);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const all: DayPoint[] = useMemo(() => seriesFor(metaId), [metaId]);
  const bpRecords = useMemo(
    () => (metaId === 'blood_pressure' ? bloodPressureSeries() : []),
    [metaId]
  );

  const yesterdayKey = useMemo(() => {
    const d = new Date(`${REFERENCE_KEY}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  // ── Windows ─────────────────────────────────────────
  const evaluatedWindow = useMemo(() => trailingWindow(REFERENCE_KEY, EVALUATED_DAYS), []);
  const baselineWindow = useMemo(
    () => previousWindow(evaluatedWindow, BASELINE_DAYS, `Previous ${BASELINE_DAYS}-day baseline`),
    [evaluatedWindow]
  );
  const chartWindow = useMemo(() => actualRangeWindow(range, all), [range, all]);

  const inWindow = (win: DayWindow) => all.filter(p => p.key >= win.startKey && p.key <= win.endKey);

  const evaluatedPoints = useMemo(() => inWindow(evaluatedWindow), [all, evaluatedWindow]); // eslint-disable-line react-hooks/exhaustive-deps
  const baselinePoints = useMemo(() => inWindow(baselineWindow), [all, baselineWindow]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartPoints = useMemo(() => inWindow(chartWindow), [all, chartWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = all.length ? all[all.length - 1] : undefined;
  const todayPoint = pointOn(all, REFERENCE_KEY);
  const yesterdayPoint = pointOn(all, yesterdayKey);

  // Partial / stale detection (SPEC §6 + §9)
  const latestPartial = latest?.partial === true;
  const accumulatingPendingToday = !!isAccumulating(meta) && latest?.key === REFERENCE_KEY;
  const staleDays = latest ? diffDays(latest.key, REFERENCE_KEY) : 0;

  // ── Comparison: 7-day average vs the previous 30-day baseline ──
  const comparison = useMemo(
    () =>
      compareValues(
        evaluatedPoints.map(p => p.value),
        baselinePoints.map(p => p.value),
        meta.aggregationStrategy,
        Math.min(meta.minObservations, 3)
      ),
    [evaluatedPoints, baselinePoints, meta]
  );

  const change = describeChange(metaId, comparison.delta, comparison.deltaPercent, {
    system: units,
    days: BASELINE_DAYS,
  });

  const baselineStats = useMemo(() => {
    const values = baselinePoints.map(p => p.value);
    if (values.length === 0) return null;
    const m = mean(values);
    const sd = stddev(values);
    return {
      mean: m,
      low: isFinite(sd) ? m - sd : m,
      high: isFinite(sd) ? m + sd : m,
      count: values.length,
    };
  }, [baselinePoints]);

  const chartData = useMemo(
    () => chartPoints.map(p => ({ date: p.key, value: p.value })),
    [chartPoints]
  );

  const anomalies = useMemo(
    () => detectAnomalies(chartPoints.map(p => ({ date: p.key, value: p.value })), 14, 2).filter(a => a.isAnomaly),
    [chartPoints]
  );

  const relatedMetrics = useMemo(
    () => getAllMetrics().filter(m => m.category === meta.category && m.id !== metaId && (m.demoAvailable || metricHasData(m.id))),
    [meta, metaId]
  );

  const coverage = coverageFor(metaId);

  // Honest insufficient-history state: the dataset holds fewer days than the
  // selected range asks for, so the range cannot be presented as a full period.
  const availableHistoryDays = diffDays(WINDOW_START_KEY, REFERENCE_KEY) + 1;
  const rangeNeedsMoreHistory =
    range !== 'all' && diffDays(chartWindow.startKey, WINDOW_START_KEY) > 0;

  const windowValues = chartPoints.map(p => p.value);
  const yDayDelta = todayPoint && latest && latest.key === REFERENCE_KEY && yesterdayPoint
    ? todayPoint.value - yesterdayPoint.value
    : null;
  const yDayPct = yDayDelta != null && yesterdayPoint ? percentChange(todayPoint!.value, yesterdayPoint.value) : null;

  // ── Sparse / unavailable metrics ────────────────────
  if (all.length === 0) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div>
          <Badge variant="default" className="text-[10px]">{meta.category}</Badge>
          <h1 className="text-2xl md:text-3xl font-semibold text-text-primary mt-2">{meta.displayName}</h1>
        </div>
        <InsufficientDataState
          metricName={meta.displayName}
          message={`${unavailableReasonFor(metaId)} Nothing is substituted for it — no value, no zero, and no chart are shown.`}
        />
        <RelatedMetricsList metrics={relatedMetrics} />
      </div>
    );
  }

  const insufficientHistory = all.length < meta.minObservations;

  return (
    <div className="space-y-6">
      <BackLink />

      {/* ── Header ──────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="default" className="text-[10px]">{meta.category}</Badge>
            {!dataMeta.live && meta.demoAvailable && <Badge variant="accent" className="text-[10px]">Demo</Badge>}
            <StaleBadge days={staleDays} />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-text-primary">{meta.displayName}</h1>
          <p className="text-xs text-text-secondary mt-1">
            {meta.aggregationStrategy === 'sum' ? 'Summed per day' : meta.aggregationStrategy === 'latest' ? 'Latest recorded value' : 'Daily average'} ·
            {metricUnit(metaId, units) ? `unit ${metricUnit(metaId, units)}` : 'no unit'}
          </p>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-3xl md:text-4xl font-semibold tnum text-text-primary leading-none">
            {displayLatest(metaId, latest, units, bpRecords)}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            Latest reading · {formatDayKeyLong(latest!.key)}
          </div>
        </div>
      </div>

      {/* ── Explicit data states (SPEC §6) ──────────── */}
      <div className="space-y-1.5">
        {!todayPoint && (
          <DataStateNote>
            No reading today — showing the latest available reading ({formatDayKeyLong(latest!.key)}).
          </DataStateNote>
        )}
        {latestPartial && (
          <DataStateNote>
            The latest reading is from a day that is still in progress ({latest!.key}), so the day
            total is partial.
          </DataStateNote>
        )}
        {accumulatingPendingToday && !latestPartial && (
          <DataStateNote>
            Today&rsquo;s total is still accumulating and is excluded from any comparison with a
            complete day.
          </DataStateNote>
        )}
        {staleDays >= 2 && (
          <DataStateNote tone="attention">
            The most recent observation is {staleDays} days before the reference date, so this metric
            is not current.
          </DataStateNote>
        )}
        {rangeNeedsMoreHistory && (
          <DataStateNote tone="attention">
            Insufficient history for a {windowDays(chartWindow)}-day view: the dataset begins{' '}
            {formatDayKeyLong(WINDOW_START_KEY)} and holds {availableHistoryDays} days. The window is
            shown at its real length and every statistic below is computed from the{' '}
            {chartPoints.length} recorded observation{chartPoints.length === 1 ? '' : 's'} only —
            nothing is extended or filled in.
          </DataStateNote>
        )}
      </div>

      {insufficientHistory ? (
        <InsufficientDataState
          metricName={meta.displayName}
          message={`Only ${all.length} observation(s) are available; at least ${meta.minObservations} are needed for a meaningful view.`}
        />
      ) : (
        <>
          {/* ── Labelled summary windows ─────────────── */}
          <section aria-label="Comparison windows">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <SummaryCard
                label="Latest reading"
                value={displayLatest(metaId, latest, units, bpRecords)}
                sub={`${formatDayKeyLong(latest!.key)} · ${coverage ? `${coverage.observedDays}/${coverage.expectedDays} days recorded` : 'coverage unavailable'}`}
              />
              <SummaryCard
                label="Today"
                value={todayPoint ? formatMetricWithUnit(metaId, todayPoint.value, units) : 'No reading'}
                sub={todayPoint ? formatDayKeyLong(todayPoint.key) : 'not recorded today'}
              />
              <SummaryCard
                label="Yesterday"
                value={yesterdayPoint ? formatMetricWithUnit(metaId, yesterdayPoint.value, units) : 'No reading'}
                sub={yesterdayPoint ? formatDayKeyLong(yesterdayPoint.key) : 'not recorded yesterday'}
              />
              <SummaryCard
                label={`${EVALUATED_DAYS}-day average`}
                value={comparison.valid ? formatMetricWithUnit(metaId, comparison.current, units) : 'Not enough data'}
                sub={`${windowRangeLabel(evaluatedWindow)} · ${comparison.currentCount} obs`}
              />
              <SummaryCard
                label={`Previous ${BASELINE_DAYS}-day baseline`}
                value={comparison.valid ? formatMetricWithUnit(metaId, comparison.baseline, units) : 'Not enough data'}
                sub={`${windowRangeLabel(baselineWindow)} · ${comparison.baselineCount} obs`}
              />
            </div>

            {/* Day-over-day, only when there is a reading today */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              {todayPoint && yesterdayPoint ? (
                <span className="inline-flex items-center gap-1">
                  vs yesterday:
                  <ChangeCue
                    direction={yDayDelta! > 0 ? 'above' : yDayDelta! < 0 ? 'below' : 'none'}
                    value={describeChange(metaId, yDayDelta!, yDayPct, { system: units, comparisonLabel: 'yesterday' }).value}
                    percent={yDayPct == null ? null : formatPercent(yDayPct)}
                  />
                </span>
              ) : (
                <span>Yesterday: {yesterdayPoint ? 'recorded' : 'no reading, so no day-over-day comparison is shown.'}</span>
              )}
              <span className="inline-flex items-center gap-1">
                Change ({EVALUATED_DAYS}-day average vs previous {BASELINE_DAYS}-day baseline):{' '}
                <strong className={`font-medium tnum ${change.tone === 'attention' ? 'text-category-attention' : 'text-text-primary'}`}>
                  {change.value}
                </strong>
                {change.percent && <span className="tnum text-text-secondary">{change.percent}</span>}
              </span>
            </div>
          </section>

          {/* ── Range stats ─────────────────────────── */}
          <section aria-label="Range statistics">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
              <span className="tnum">
                Average: {windowValues.length ? formatMetricWithUnit(metaId, mean(windowValues), units) : '—'}
              </span>
              <span className="tnum">
                Min: {windowValues.length ? formatMetricWithUnit(metaId, Math.min(...windowValues), units) : '—'}
              </span>
              <span className="tnum">
                Max: {windowValues.length ? formatMetricWithUnit(metaId, Math.max(...windowValues), units) : '—'}
              </span>
              <span className="tnum">
                Median: {windowValues.length ? formatMetricWithUnit(metaId, median(windowValues), units) : '—'}
              </span>
              <span className="tnum">Observations: {windowValues.length}</span>
              <span className="tnum">
                Window: {windowRangeLabel(chartWindow)} ({windowDays(chartWindow)} days)
              </span>
            </div>
          </section>

          {/* ── Controls ───────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              ariaLabel="Chart range"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBaseline(!showBaseline)}
                aria-pressed={showBaseline}
                className={`px-3 py-1.5 text-xs font-medium rounded-control transition-colors min-h-[32px] ${
                  showBaseline ? 'bg-accent-tint text-primary' : 'bg-surface-muted text-text-secondary'
                }`}
              >
                Baseline band
              </button>
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
          </div>

          {/* ── Chart / table ──────────────────────── */}
          <Card className="p-4 md:p-6">
            {view === 'chart' ? (
              chartData.length === 0 ? (
                <InsufficientDataState
                  message={`No observations fall inside ${windowRangeLabel(chartWindow)}. Widen the range to see recorded values.`}
                />
              ) : (
                <MetricChart
                  metricId={metaId}
                  data={chartData}
                  showBaseline={showBaseline}
                  baselineBand={
                    baselineStats
                      ? {
                          mean: baselineStats.mean,
                          low: baselineStats.low,
                          high: baselineStats.high,
                          label: `baseline ${formatMetricValue(metaId, baselineStats.mean, units)}`,
                        }
                      : null
                  }
                  height={320}
                  showBrush={chartData.length > 60}
                  units={units}
                />
              )
            ) : (
              <AccessibleDataTable metricId={metaId} data={[...chartData].reverse().slice(0, 120)} units={units} />
            )}
          </Card>

          {anomalies.length > 0 && (
            <Card className="p-5">
              <details>
                <summary className="text-sm font-medium text-text-primary cursor-pointer flex items-center gap-2">
                  <ChevronDown size={14} aria-hidden="true" />
                  {anomalies.length} observation{anomalies.length === 1 ? '' : 's'} outside the rolling baseline
                </summary>
                <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                  Method: a 14-day trailing mean and standard deviation are computed from the
                  preceding observations, and any value more than 2 standard deviations from that
                  mean is flagged. This is a plain statistical check on your own history; it is not
                  evidence of a health problem.
                </p>
                <ul className="mt-3 space-y-1 text-xs text-text-primary tnum list-none p-0">
                  {anomalies.slice(0, 8).map(a => (
                    <li key={a.date}>
                      {formatDayKeyLong(a.date)} · {formatMetricWithUnit(metaId, a.value, units)} · rolling mean{' '}
                      {formatMetricWithUnit(metaId, a.baseline, units)} · {a.stddevAbove.toFixed(1)} SD
                    </li>
                  ))}
                </ul>
                {anomalies.length > 8 && (
                  <p className="text-[11px] text-text-secondary mt-1">
                    Showing the first 8 of {anomalies.length} flagged observations.
                  </p>
                )}
              </details>
            </Card>
          )}

          {/* ── Trend summary ──────────────────────── */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-2">How this range compares</h3>
            <div className="flex items-start gap-2">
              {comparison.valid && comparison.delta > 0 ? (
                <TrendingUp size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
              ) : comparison.valid && comparison.delta < 0 ? (
                <TrendingDown size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <Minus size={16} className="text-text-secondary mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <div className="text-sm text-text-primary">
                {comparison.valid ? (
                  <>
                    The {EVALUATED_DAYS}-day average is{' '}
                    <strong className="font-medium">{formatMetricWithUnit(metaId, comparison.current, units)}</strong>,
                    and the previous {BASELINE_DAYS}-day baseline is{' '}
                    <strong className="font-medium">{formatMetricWithUnit(metaId, comparison.baseline, units)}</strong>.
                    <span className="block text-text-secondary text-xs mt-1">
                      Difference {change.value}
                      {change.percent ? ` (${change.percent})` : ''} · {comparison.currentCount} vs{' '}
                      {comparison.baselineCount} observations · windows {windowRangeLabel(evaluatedWindow)} and{' '}
                      {windowRangeLabel(baselineWindow)}.
                    </span>
                  </>
                ) : (
                  <>
                    Not enough paired observations to compare {windowRangeLabel(evaluatedWindow)} with{' '}
                    {windowRangeLabel(baselineWindow)}.
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* ── Sleep-specific distinction ─────────── */}
          {metaId === 'sleep_analysis' && <SleepTimingNote />}

          <RelatedMetricsList metrics={relatedMetrics} />

          {/* ── Provenance ─────────────────────────── */}
          {coverage && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Info size={14} className="text-text-secondary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-text-primary">Data provenance</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-text-secondary">First observed</span>
                  <p className="text-text-primary tnum font-medium">
                    {formatDayKeyLong(canonicalDayKey(coverage.firstObservation))}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Last observed</span>
                  <p className="text-text-primary tnum font-medium">
                    {formatDayKeyLong(canonicalDayKey(coverage.lastObservation))}
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Coverage</span>
                  <p className="text-text-primary tnum font-medium">
                    {coverage.observedDays}/{coverage.expectedDays} days ({coverage.samplingFrequency})
                  </p>
                </div>
                <div>
                  <span className="text-text-secondary">Sources</span>
                  <p className="text-text-primary font-medium">{coverage.sourceNames.join(', ')}</p>
                </div>
              </div>
              <div className="mt-3">
                <DataStateNote>
                  {datasetProvenanceSentence()} Missing days are excluded rather than treated as zero,
                  and the latest reading may differ from the day you are viewing.
                </DataStateNote>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      <span>Back</span>
    </Link>
  );
}

function RelatedMetricsList({ metrics }: { metrics: ReturnType<typeof getAllMetrics> }) {
  if (metrics.length === 0) return null;
  return (
    <section aria-label="Related metrics">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Related metrics</h3>
      <div className="flex flex-wrap gap-2">
        {metrics.map(m => (
          <Link
            key={m.id}
            href={`/metric/${m.id}`}
            className="px-3 py-1.5 text-xs font-medium bg-surface-muted text-text-secondary hover:text-text-primary hover:bg-surface border border-border rounded-control transition-colors"
          >
            {m.displayName}
          </Link>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({ label, value, sub, highlight }: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`p-4 ${highlight ? 'ring-1 ring-category-attention/30' : ''}`}>
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">{label}</div>
      <div className={`text-xl md:text-2xl font-semibold tnum ${highlight ? 'text-category-attention' : 'text-text-primary'} leading-none mb-1`}>
        {value}
      </div>
      <div className="text-[10px] text-text-secondary">{sub}</div>
    </Card>
  );
}

function SleepTimingNote() {
  const sleep = useMemo(() => sleepSeries(), []);
  const latest = sleep[sleep.length - 1];
  const stagesRecorded = latest ? hasSleepStages(latest) : false;
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-2">Time asleep and time in bed</h3>
      <p className="text-xs text-text-secondary">
        The chart above plots time asleep (the sleep metric). Time in bed is recorded separately and
        is always longer, because it includes the time taken to fall asleep and any time awake
        during the night. The Sleep page shows both side by side.
      </p>
      {latest && (
        <p className="text-xs text-text-primary mt-2 tnum">
          Latest night ({formatDayKeyLong(latest.key)}):{' '}
          {stagesRecorded
            ? `asleep ${formatMetricValue('sleep_analysis', latest.asleepMinutes, 'metric')}, in bed ${formatMetricValue('sleep_analysis', latest.inBedMinutes, 'metric')}, difference ${formatMetricValue('sleep_analysis', latest.inBedMinutes - latest.asleepMinutes, 'metric')}.`
            : `in bed ${formatMetricValue('sleep_analysis', latest.inBedMinutes, 'metric')} — the record carries no stage split, so no time-asleep figure is shown for it.`}
        </p>
      )}
    </Card>
  );
}

/** Blood pressure is a paired observation; every other metric is a single value. */
function displayLatest(
  metricId: string,
  latest: DayPoint | undefined,
  units: 'metric' | 'imperial',
  bpRecords: ReturnType<typeof bloodPressureSeries>
): string {
  if (metricId === 'blood_pressure') {
    const last = bpRecords[bpRecords.length - 1];
    if (last) return `${last.systolic}/${last.diastolic} mmHg`;
  }
  if (!latest) return '—';
  return formatMetricWithUnit(metricId, latest.value, units);
}

/** Resolve a range token to actual day-key bounds for the loaded series. */
function actualRangeWindow(range: string, all: DayPoint[]): DayWindow {
  if (range === 'all') {
    const first = all[0]?.key ?? REFERENCE_KEY;
    return { startKey: first, endKey: REFERENCE_KEY, label: 'All time' };
  }
  const match = /^(\d+)d$/.exec(range);
  if (match) return trailingWindow(REFERENCE_KEY, Number(match[1]));
  if (range === '1y') return trailingWindow(REFERENCE_KEY, 365);
  return trailingWindow(REFERENCE_KEY, 90);
}
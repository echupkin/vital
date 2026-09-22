'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, Info, UtensilsCrossed } from 'lucide-react';
import { getMetric, getMetricsByCategory } from '@/lib/metrics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import { REFERENCE_KEY, coverageFor, seriesFor, seriesInWindow } from '@/lib/adapters/dataset';
import {
  ASSOCIATION_NOTE,
  computeRelationship,
  describeCoefficient,
  formatDayKeyLong,
  loggedDayStats,
  trailingWindow,
  windowRangeLabel,
  MIN_PAIRED_OBSERVATIONS,
  type LoggedDayStats,
} from '@/lib/analytics';
import { Card, Badge, DataStateNote, InsufficientDataState, SegmentedControl } from '@/components/ui/primitives';
import { MetricChart, TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { DomainHeader, SectionTitle, MetricGrid } from './DomainShared';

const LOGGED_WINDOW_DAYS = 30;

/** The six headline intake metrics, in the order SPEC §7 lists them. */
const HEADLINE = [
  'dietary_energy',
  'dietary_protein',
  'dietary_carbs',
  'dietary_fat_total',
  'dietary_water',
  'dietary_caffeine',
] as const;

/** The two fixed association questions this page asks, rendered only when both sides have data. */
const ASSOCIATION_PAIRS: {
  xId: string;
  yId: string;
  alignment: 'same-day' | 'lagged';
  lagDays: number;
  title: string;
  description: string;
}[] = [
  {
    xId: 'dietary_caffeine',
    yId: 'sleep_analysis',
    alignment: 'lagged',
    lagDays: 1,
    title: "Logged caffeine and the following night's sleep",
    description:
      'Pairs caffeine logged on one day with time asleep on the following night, which is the usual shape of that question.',
  },
  {
    xId: 'dietary_energy',
    yId: 'active_energy',
    alignment: 'same-day',
    lagDays: 0,
    title: 'Logged calories and active calories',
    description:
      'Pairs the calories you logged with the active calories your devices recorded on the same day.',
  },
];

export function NutritionPage() {
  const { units } = useUnits();
  const [range, setRange] = useState(String(LOGGED_WINDOW_DAYS));

  const days = Number(range);
  const window = trailingWindow(REFERENCE_KEY, days);
  const stats = HEADLINE.map(id => loggedDayStats(id, REFERENCE_KEY, days));
  // Owner request 2: a nutrient with no logged day in this window is not
  // rendered as a card, and the section disappears with its last card.
  const loggedStats = stats.filter(s => s.loggedDays > 0);
  const energyStats = stats[0];

  // Owner request 2: a fixed association is shown only when both of its metrics
  // actually have observations in the window being compared.
  const associationPairs = useMemo(() => {
    const win = trailingWindow(REFERENCE_KEY, days);
    return ASSOCIATION_PAIRS.map(p => ({
      ...p,
      available: seriesInWindow(p.xId, win).length > 0 && seriesInWindow(p.yId, win).length > 0,
    }));
  }, [days]);

  // Additional nutrients, discovered from the registry rather than hard-coded.
  const extraNutrients = getMetricsByCategory('nutrition').filter(
    m => !HEADLINE.includes(m.id as (typeof HEADLINE)[number])
  );

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Nutrition"
        subtitle={`Logged dietary intake across ${windowRangeLabel(window)}. These are entries you recorded, not measurements of what you ate.`}
      />

      {/* ── The logged-intake statement ─────────────── */}
      <Card variant="accent" className="p-5" as="section">
        <div className="flex items-start gap-3">
          <UtensilsCrossed size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="text-sm text-text-primary space-y-1.5">
            <p className="font-medium">Logged intake only — a missing food log is not zero intake.</p>
            <p className="text-text-secondary leading-relaxed">
              Every figure on this page is computed over <strong className="font-medium text-text-primary">logged days only</strong>.
              A day with no entry is left missing: it is excluded from averages and totals, it appears as a gap in the
              chart rather than a zero bar, and no value is substituted for it. Days with a partial log are counted as
              they were recorded.
            </p>
          </div>
        </div>
      </Card>

      {/* ── Headline intake ─────────────────────────── */}
      {loggedStats.length > 0 && (
        <section>
          <SectionTitle hint={`${loggedStats[0].loggedDays}–${loggedStats[loggedStats.length - 1].loggedDays} logged days of ${days}`}>
            Logged intake
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {loggedStats.map((s, i) => (
              <LoggedIntakeCard key={s.metricId} stats={s} units={units} emphasis={i === 0} />
            ))}
          </div>
        </section>
      )}

      {/* ── Energy timeline ─────────────────────────── */}
      {energyStats.points.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-[20px] md:text-[24px] font-semibold text-text-primary">Logged calories timeline</h2>
            <SegmentedControl
              options={[
                { value: '30', label: '30D' },
                { value: '90', label: '90D' },
                { value: '180', label: '180D' },
              ]}
              value={range}
              onChange={setRange}
              ariaLabel="Logged intake date range"
            />
          </div>
          <Card className="p-4 md:p-6">
            <MetricChart
              metricId="dietary_energy"
              data={energyStats.points.map(p => ({ date: p.key, value: p.value }))}
              units={units}
              height={280}
            />
            <div className="mt-3 space-y-1">
              <DataStateNote>
                Each bar is one day on which calories were logged. Days without a log have no bar: the chart shows
                {` ${days - energyStats.loggedDays} `}
                missing days in this window rather than plotting them as zero.
              </DataStateNote>
              <DataStateNote>
                {energyStats.averageLabel} · {energyStats.coverageLabel}. Total logged:{' '}
                {formatMetricWithUnit('dietary_energy', energyStats.windowTotal, units)} across those logged days.
              </DataStateNote>
            </div>
          </Card>
        </section>
      )}

      {/* ── Logged-day coverage table ───────────────── */}
      <section>
        <SectionTitle hint="logged days, never calendar days">Coverage and averages</SectionTitle>
        <Card className="p-4 md:p-6">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Logged intake coverage table">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">
                Logged-day coverage, averages and totals for each intake metric over {windowRangeLabel(window)}
              </caption>
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-medium">Nutrient</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Latest logged</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Average of logged days</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Total over logged days</th>
                  <th scope="col" className="py-2 font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(s => (
                  <tr key={s.metricId} className="border-b border-border/50">
                    <td className="py-2.5 pr-4 text-text-primary">{s.metricName}</td>
                    <td className="py-2.5 pr-4 tnum text-text-primary">
                      {s.latestKey ? `${formatMetricWithUnit(s.metricId, s.latestValue, units)} · ${formatDayKeyLong(s.latestKey)}` : 'No log'}
                    </td>
                    <td className="py-2.5 pr-4 tnum text-text-primary">
                      {s.sufficient ? formatMetricWithUnit(s.metricId, s.dailyAverage, units) : 'Not enough logged days'}
                    </td>
                    <td className="py-2.5 pr-4 tnum text-text-primary">
                      {s.sufficient ? formatMetricWithUnit(s.metricId, s.windowTotal, units) : '—'}
                    </td>
                    <td className="py-2.5 text-[11px] text-text-secondary tnum">
                      {s.loggedDays} of {s.windowDays} days · {s.datasetLoggedDays} of {s.datasetExpectedDays} in the dataset
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <DataStateNote>
              Averages divide by the number of logged days, never by the number of calendar days. Treating an unlogged
              day as a day of zero intake would understate every average on this page.
            </DataStateNote>
          </div>
        </Card>
      </section>

      {/* ── Associations ────────────────────────────── */}
      {associationPairs.some(p => p.available) && (
        <section>
          <SectionTitle hint={`paired coverage stated for each · ${windowRangeLabel(window)}`}>
            Associations with recovery
          </SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {associationPairs
              .filter(p => p.available)
              .map(p => (
                <AssociationCard
                  key={p.title}
                  xId={p.xId}
                  yId={p.yId}
                  alignment={p.alignment}
                  lagDays={p.lagDays}
                  days={days}
                  units={units}
                  title={p.title}
                  description={p.description}
                />
              ))}
          </div>
        </section>
      )}

      {/* ── Registry-derived extras ─────────────────── */}
      {extraNutrients.length > 0 ? (
        <MetricGrid
          metrics={extraNutrients}
          title="Other registered nutrients"
          hint="Discovered from the metric registry, not hard-coded"
          days={days}
        />
      ) : (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Info size={14} className="text-text-secondary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-text-primary">Additional nutrients</h3>
          </div>
          <DataStateNote>
            The registry is read at render time: {getMetricsByCategory('nutrition').length} nutrition metrics are
            registered and {HEADLINE.length} of them are shown above. The dataset contains no other nutrient, so
            nothing further is listed — no nutrient is invented to fill the space.
          </DataStateNote>
        </Card>
      )}

      {/* ── Sources ─────────────────────────────────── */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Where these entries come from</h3>
        <ul className="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[...HEADLINE, ...extraNutrients.map(m => m.id)].map(id => {
            const cov = coverageFor(id);
            const meta = getMetric(id);
            if (!cov) return null;
            return (
              <li key={id} className="flex items-center justify-between gap-3">
                <span className="text-text-primary">{meta?.displayName ?? id}</span>
                <span className="text-text-secondary tnum text-right">
                  {cov.observedDays}/{cov.expectedDays} logged days · {cov.sourceNames.join(', ')}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3">
          <DataStateNote>
            Entries are manual logs or third-party food logs. They record what was entered, which may differ from what
            was eaten, and no intake figure is inferred for a day without an entry.
          </DataStateNote>
        </div>
      </Card>
    </div>
  );
}

// ── Logged intake card ─────────────────────────────────

function LoggedIntakeCard({
  stats, units, emphasis = false,
}: {
  stats: LoggedDayStats;
  units: 'metric' | 'imperial';
  emphasis?: boolean;
}) {
  const meta = getMetric(stats.metricId);
  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-text-secondary">{stats.metricName}</span>
        <Badge variant="default" className="text-[10px] shrink-0">
          {stats.loggedDays} of {stats.windowDays} days logged
        </Badge>
      </div>

      <div className={`${emphasis ? 'text-[32px] md:text-[36px]' : 'text-[26px] md:text-[30px]'} font-semibold tnum text-text-primary leading-none mb-1`}>
        {stats.latestKey ? formatMetricWithUnit(stats.metricId, stats.latestValue, units) : 'No log'}
      </div>
      <p className="text-[11px] text-text-secondary mb-3">
        {stats.latestKey ? `Latest logged entry · ${formatDayKeyLong(stats.latestKey)}` : 'Nothing logged in this window'}
      </p>

      <dl className="text-xs text-text-secondary space-y-1 mb-3">
        <div className="flex justify-between gap-3">
          <dt>Average of logged days</dt>
          <dd className="tnum text-text-primary">
            {stats.sufficient ? formatMetricWithUnit(stats.metricId, stats.dailyAverage, units) : 'Not enough logged days'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Total over logged days</dt>
          <dd className="tnum text-text-primary">
            {stats.sufficient ? formatMetricWithUnit(stats.metricId, stats.windowTotal, units) : '—'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Median logged day</dt>
          <dd className="tnum text-text-primary">
            {stats.sufficient ? formatMetricWithUnit(stats.metricId, stats.median, units) : '—'}
          </dd>
        </div>
      </dl>

      <TrendFigure
        metricId={stats.metricId}
        data={stats.points.map(p => ({ key: p.key, value: p.value }))}
        caption={`${meta?.displayName ?? stats.metricId} · ${stats.loggedDays} logged days of ${stats.windowDays}`}
        height={56}
        units={units}
      />

      <p className="text-[11px] text-text-secondary mt-2 mb-3">
        {stats.averageLabel} · {stats.coverageLabel}
      </p>

      <div className="mt-3">
        <Link
          href={`/metric/${stats.metricId}?range=30d`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open {stats.metricName} detail
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

// ── Association card ───────────────────────────────────

function AssociationCard({
  xId, yId, alignment, lagDays, days, units, title, description,
}: {
  xId: string;
  yId: string;
  alignment: 'same-day' | 'lagged';
  lagDays: number;
  days: number;
  units: 'metric' | 'imperial';
  title: string;
  description: string;
}) {
  const window = trailingWindow(REFERENCE_KEY, days);
  const result = computeRelationship(xId, yId, window, alignment, lagDays);
  const xMeta = getMetric(xId);
  const yMeta = getMetric(yId);
  const enough = result.pairedCount >= MIN_PAIRED_OBSERVATIONS && result.valid;

  return (
    <Card className="p-5 flex flex-col">
      <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-[11px] text-text-secondary mb-3">{description}</p>

      <dl className="text-xs text-text-secondary space-y-1 mb-3">
        <div className="flex justify-between gap-3">
          <dt>Paired logged days</dt>
          <dd className="tnum text-text-primary">
            {result.pairedCount} (minimum {MIN_PAIRED_OBSERVATIONS})
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{xMeta?.displayName ?? xId} entries in window</dt>
          <dd className="tnum text-text-primary">{result.xCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{yMeta?.displayName ?? yId} readings in window</dt>
          <dd className="tnum text-text-primary">{result.yCount}</dd>
        </div>
      </dl>

      {enough && result.coefficient != null ? (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-semibold tnum text-text-primary">{result.coefficient.toFixed(2)}</span>
            <span className="text-xs text-text-secondary">{describeCoefficient(result.coefficient)}</span>
          </div>
          <TrendFigure
            metricId={yId}
            data={seriesFor(yId)
              .filter(p => p.key >= window.startKey && p.key <= window.endKey)
              .map(p => ({ key: p.key, value: p.value }))}
            caption={`${yMeta?.displayName ?? yId} · ${windowRangeLabel(window)}`}
            height={56}
            units={units}
          />
          <p className="text-[11px] text-text-secondary mt-2">
            Coefficient r = {result.coefficient.toFixed(2)} across {result.pairedCount} paired days in{' '}
            {windowRangeLabel(window)} ({alignment === 'lagged' ? `lagged by ${lagDays} day` : 'same day'}).
            {result.coefficient > 0 ? ' Positive means the two tended to move together.' : ' Negative means the two tended to move in opposite directions.'}
          </p>
        </>
      ) : (
        <InsufficientDataState
          message={
            result.insufficientReason ??
            `Only ${result.pairedCount} days have an entry for both metrics in ${windowRangeLabel(window)}. At least ${MIN_PAIRED_OBSERVATIONS} paired days are needed before an association is shown.`
          }
        />
      )}

      <div className="mt-3">
        <DataStateNote>{ASSOCIATION_NOTE}</DataStateNote>
      </div>
    </Card>
  );
}

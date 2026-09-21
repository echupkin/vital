'use client';

import Link from 'next/link';
import { formatMetricValue, formatMetricWithUnit } from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
  seriesFor,
  coverageFor,
} from '@/lib/adapters/dataset';
import {
  buildSeriesSummary,
  diffDays,
  formatDayKeyLong,
  mean,
  trailingWindow,
  windowRangeLabel,
} from '@/lib/analytics';
import { Card, Badge, DataStateNote } from '@/components/ui/primitives';
import { MetricChart } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import {
  DomainHeader, SectionTitle, SeriesCard, MetricGrid, CoverageNote, metricsForCategories,
} from './DomainShared';

const DAYS = 90;
const WINDOW_DAYS = 30;

export function BodyPage() {
  const { units } = useUnits();
  const all = seriesFor('weight_body_mass');
  const win = trailingWindow(REFERENCE_KEY, DAYS);
  const inWindow = all.filter(p => p.key >= win.startKey && p.key <= win.endKey);
  const weightSummary = buildSeriesSummary('weight_body_mass', REFERENCE_KEY, WINDOW_DAYS, units);

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const gaps = inWindow.slice(1).map((p, i) => diffDays(inWindow[i].key, p.key));
  const avgGap = gaps.length ? mean(gaps) : NaN;
  const values = inWindow.map(p => p.value);
  const bodyComposition = metricsForCategories(['body'], ['weight_body_mass']);

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Body"
        subtitle={`Weight is the main series. Measurements are individual weigh-ins, not daily readings — the average gap is ${Number.isFinite(avgGap) ? avgGap.toFixed(1) : '—'} days.`}
      />

      {/* ── Weight trajectory (owner request 2: only when there is data) ── */}
      {inWindow.length > 0 && (
        <section>
          <SectionTitle hint={`${windowRangeLabel(win)} · ${inWindow.length} weigh-ins`}>
            Weight trajectory
          </SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-4 md:p-6 lg:col-span-2">
              <MetricChart
                metricId="weight_body_mass"
                data={inWindow.map(p => ({ date: p.key, value: p.value }))}
                units={units}
                height={320}
                showDots
              />
              <div className="mt-3 space-y-1">
                <DataStateNote>
                  Each marker is a single weigh-in. The line connects consecutive measurements and
                  does not imply that weight was measured on the days between them.
                </DataStateNote>
                <DataStateNote>
                  Weigh-ins are spaced roughly {Number.isFinite(avgGap) ? avgGap.toFixed(1) : '—'} days
                  apart; day-over-day change is therefore not calculated for this metric.
                </DataStateNote>
              </div>
            </Card>

            <Card className="p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-text-secondary">Recorded range</span>
                <Badge variant="default" className="text-[10px]">
                  {all.length} total
                </Badge>
              </div>
              <dl className="text-sm space-y-1.5 mb-3">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">First in window</dt>
                  <dd className="tnum text-text-primary">
                    {first ? `${formatMetricWithUnit('weight_body_mass', first.value, units)} · ${formatDayKeyLong(first.key)}` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Last in window</dt>
                  <dd className="tnum text-text-primary">
                    {last ? `${formatMetricWithUnit('weight_body_mass', last.value, units)} · ${formatDayKeyLong(last.key)}` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Change across window</dt>
                  <dd className="tnum text-text-primary">
                    {first && last
                      ? formatSigned('weight_body_mass', last.value - first.value, units)
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Lowest / highest</dt>
                  <dd className="tnum text-text-primary">
                    {values.length
                      ? `${formatMetricValue('weight_body_mass', Math.min(...values), units)} / ${formatMetricValue('weight_body_mass', Math.max(...values), units)}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Coverage</dt>
                  <dd className="tnum text-text-primary">
                    {coverageFor('weight_body_mass')
                      ? `${coverageFor('weight_body_mass')!.observedDays}/${coverageFor('weight_body_mass')!.expectedDays} days`
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="mt-auto">
                <Link href="/metric/weight_body_mass" className="text-sm text-primary hover:underline">
                  Open weight detail
                </Link>
              </div>
              <DataStateNote>
                The lowest and highest readings are the extremes of the measurements taken, not a
                range your weight stayed inside between them.
              </DataStateNote>
            </Card>
          </div>
        </section>
      )}

      {/* ── Recent comparison (only when the window has weigh-ins) ── */}
      {weightSummary.points.length > 0 && (
        <section>
          <SectionTitle hint={`last ${WINDOW_DAYS} days vs the ${WINDOW_DAYS} before`}>
            Recent change
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SeriesCard summary={weightSummary} days={WINDOW_DAYS} emphasis />
            <Card className="p-5">
              <p className="text-sm font-medium text-text-primary mb-2">How the comparison is built</p>
              <p className="text-xs text-text-secondary leading-relaxed">
                The recent figure is the average of the weigh-ins recorded in the last {WINDOW_DAYS}{' '}
                days; the baseline is the average of the weigh-ins in the {WINDOW_DAYS} days before
                that. Days without a weigh-in are excluded rather than carried forward, and no
                day-over-day change is shown for this metric.
              </p>
              <p className="text-xs text-text-secondary leading-relaxed mt-2">
                {weightSummary.valid
                  ? `Recent average ${formatMetricWithUnit('weight_body_mass', weightSummary.windowAverage, units)} from ${weightSummary.counts.evaluated} weigh-ins, baseline ${formatMetricWithUnit('weight_body_mass', weightSummary.baselineAverage, units)} from ${weightSummary.counts.baseline} weigh-ins.`
                  : 'There are not enough weigh-ins on both sides of the window to compare them.'}
              </p>
              <p className="text-[11px] text-text-secondary mt-3">
                Measurements are recorded on individual dates, so no value is shown for days without a
                weigh-in.
              </p>
            </Card>
          </div>
        </section>
      )}

      {/* ── Body composition ──────────────────────── */}
      {bodyComposition.length > 0 ? (
        <MetricGrid
          metrics={bodyComposition}
          title="Body composition"
          hint="Shown only when the dataset contains the measurement"
          days={DAYS}
        />
      ) : null}

      <CoverageNote metricIds={['weight_body_mass', 'body_fat_percentage', 'lean_body_mass', 'waist_circumference']} />
    </div>
  );
}

function formatSigned(metricId: string, delta: number, units: 'metric' | 'imperial'): string {
  if (!Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return `${sign}${formatMetricWithUnit(metricId, Math.abs(delta), units)}`;
}
'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { getMetric } from '@/lib/metrics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
  bloodPressureSeries,
  bloodOxygenSeries,
  seriesFor,
  coverageFor,
} from '@/lib/adapters/dataset';
import {
  BP_REFERENCE_THRESHOLD,
  bloodPressureInWindow,
  buildSeriesSummary,
  formatDayKeyLong,
  isAboveBloodPressureReference,
  trailingWindow,
  windowRangeLabel,
} from '@/lib/analytics';
import { Card, Badge, DataStateNote } from '@/components/ui/primitives';
import { MetricChart, TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import {
  DomainHeader, SectionTitle, SeriesCard, MetricGrid, CoverageNote, metricsForCategories,
} from './DomainShared';

const DAYS = 30;
const BP_RECENT_DAYS = 7;
const HEADLINE = ['resting_heart_rate', 'heart_rate_variability', 'walking_heart_rate', 'vo2max'];

export function HealthPage() {
  const { units } = useUnits();
  const headlineSummaries = HEADLINE.map(id => buildSeriesSummary(id, REFERENCE_KEY, DAYS, units));
  // Owner request 2: a metric with no observation in this window renders nothing,
  // and the section disappears with its last card.
  const summaries = headlineSummaries.filter(s => s.points.length > 0);
  const headlineIds = summaries.map(s => s.metricId);
  const bp = bloodPressureSeries();
  const spo2 = bloodOxygenSeries();
  const spo2Window = trailingWindow(REFERENCE_KEY, DAYS);
  const spo2Points = spo2.filter(p => p.key >= spo2Window.startKey && p.key <= spo2Window.endKey);

  // Blood pressure: only the last week, and only when it has readings. Readings
  // above the 120/80 reference threshold are called out individually.
  const bpWindow = trailingWindow(REFERENCE_KEY, BP_RECENT_DAYS);
  const bpRecent = bloodPressureInWindow(bp, bpWindow);
  const bpAbove = bpRecent.filter(isAboveBloodPressureReference);

  const respiratoryWindow = trailingWindow(REFERENCE_KEY, DAYS);
  const respiratoryPoints = seriesFor('respiratory_rate').filter(
    p => p.key >= respiratoryWindow.startKey && p.key <= respiratoryWindow.endKey
  );

  const otherCategories = metricsForCategories(
    ['respiratory', 'recovery', 'activity', 'sleep', 'body', 'nutrition'],
    HEADLINE
  );

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Health"
        subtitle={`Cardiovascular signals first, then every other category the dataset actually contains. Window: last ${DAYS} days ending ${formatDayKeyLong(REFERENCE_KEY)}.`}
      />

      {/* ── Cardiovascular headline ─────────────────── */}
      {summaries.length > 0 && (
        <section>
          <SectionTitle hint={`${windowRangeLabel(summaries[0].window)} vs ${windowRangeLabel(summaries[0].baselineWindow)}`}>
            Cardiovascular
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {summaries.map((s, i) => (
              <SeriesCard key={s.metricId} summary={s} days={DAYS} emphasis={i === 0} />
            ))}
          </div>
          <div className="mt-4">
            <DataStateNote>
              A personal baseline describes your own recent history. It is not a medical reference
              range, and a value inside it is not evidence about your health. Lower resting heart rate
              and higher HRV are not automatically treated as improvements by this app.
            </DataStateNote>
          </div>
        </section>
      )}

      {/* ── Blood pressure: last 7 days only, with dates ─── */}
      {bpRecent.length > 0 && (
        <section>
          <SectionTitle
            hint={`readings from the last ${BP_RECENT_DAYS} days · ${bpRecent.length} of ${bp.length} recorded`}
          >
            Blood pressure
          </SectionTitle>
          <Card className="p-5">
            <ul className="list-none p-0 m-0 divide-y divide-border">
              {[...bpRecent].reverse().map(r => {
                const above = isAboveBloodPressureReference(r);
                return (
                  <li key={r.date} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="text-text-secondary w-40 shrink-0">{formatDayKeyLong(r.date)}</span>
                    <span className="text-text-primary font-medium tnum">
                      {r.systolic}/{r.diastolic} mmHg
                    </span>
                    {above && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-category-attention">
                        <TriangleAlert size={12} aria-hidden="true" />
                        Above the {BP_REFERENCE_THRESHOLD.systolic}/{BP_REFERENCE_THRESHOLD.diastolic} reference threshold
                      </span>
                    )}
                    <span className="text-[11px] text-text-secondary ml-auto">{r.source}</span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 space-y-2">
              {bpAbove.length > 0 ? (
                <div className="flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
                  <div className="text-xs leading-relaxed">
                    <p className="text-text-primary font-medium">
                      {bpAbove.length} reading{bpAbove.length === 1 ? '' : 's'} above the{' '}
                      {BP_REFERENCE_THRESHOLD.systolic}/{BP_REFERENCE_THRESHOLD.diastolic} reference threshold
                    </p>
                    <ul className="list-none p-0 m-0 mt-1 space-y-0.5 tnum text-text-primary">
                      {[...bpAbove].reverse().map(r => (
                        <li key={r.date}>
                          {formatDayKeyLong(r.date)} — {r.systolic}/{r.diastolic} mmHg
                        </li>
                      ))}
                    </ul>
                    <p className="text-text-secondary mt-1.5">
                      {BP_REFERENCE_THRESHOLD.systolic}/{BP_REFERENCE_THRESHOLD.diastolic} mmHg is a commonly cited
                      reference point used to flag a reading for attention. It is not a diagnosis, it
                      is not specific to you, and a reading above it is not by itself a statement
                      about your health. Only a clinician can interpret a blood-pressure reading.
                    </p>
                  </div>
                </div>
              ) : (
                <DataStateNote>
                  No reading in the last {BP_RECENT_DAYS} days was above the{' '}
                  {BP_REFERENCE_THRESHOLD.systolic}/{BP_REFERENCE_THRESHOLD.diastolic} reference threshold. That threshold
                  is a commonly cited reference point, not a diagnosis or a target for you.
                </DataStateNote>
              )}
              <DataStateNote>
                Showing the last {BP_RECENT_DAYS} days only ({bpRecent.length} of {bp.length} recorded
                reading{bp.length === 1 ? '' : 's'} in the dataset). Readings are individual
                measurements taken when they were taken, so no trend, average or day-over-day change
                is computed from them.
              </DataStateNote>
            </div>

            <div className="mt-3">
              <Link href="/metric/blood_pressure" className="text-sm text-primary hover:underline">
                Open blood pressure detail
              </Link>
            </div>
          </Card>
        </section>
      )}

      {/* ── Blood oxygen (present in this dataset) ─── */}
      {spo2Points.length > 0 && (
        <section>
          <SectionTitle hint={coverageFor('blood_oxygen_saturation')?.samplingFrequency}>
            Blood oxygen
          </SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-text-secondary">Blood Oxygen</span>
                <Badge variant="default" className="text-[10px]">
                  {spo2.length} readings total
                </Badge>
              </div>
              <div className="text-[32px] font-semibold tnum text-text-primary leading-none mb-2">
                {formatMetricWithUnit(
                  'blood_oxygen_saturation',
                  spo2[spo2.length - 1].value,
                  units
                )}
              </div>
              <p className="text-xs text-text-secondary mb-2">
                Latest · {formatDayKeyLong(spo2[spo2.length - 1].key)} · {spo2Points.length} readings in the last{' '}
                {DAYS} days
              </p>
              <TrendFigure
                metricId="blood_oxygen_saturation"
                data={spo2}
                caption={`Blood Oxygen · ${spo2.length} readings across the dataset`}
                height={56}
              />
              <div className="mt-3">
                <Link href="/metric/blood_oxygen_saturation" className="text-sm text-primary hover:underline">
                  Open blood oxygen detail
                </Link>
              </div>
            </Card>
            <Card className="p-5 lg:col-span-2">
              <MetricChart
                metricId="blood_oxygen_saturation"
                data={spo2Points.map(p => ({ date: p.key, value: p.value }))}
                units={units}
                height={220}
              />
              <DataStateNote>
                A gap in the line means no reading was taken — it does not mean the value dropped
                to zero.
              </DataStateNote>
            </Card>
          </div>
        </section>
      )}

      {/* ── Respiratory and activity cross-reference ── */}
      {respiratoryPoints.length > 0 && (
        <section>
          <SectionTitle hint="Drawn from the registry, not hard-coded">Also in this dataset</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <MetricChart
                metricId="respiratory_rate"
                data={respiratoryPoints.map(p => ({ date: p.key, value: p.value }))}
                units={units}
                height={200}
              />
              <DataStateNote>
                Respiratory rate is a night-time measurement aggregated to its waking date.
              </DataStateNote>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-text-primary mb-2">How these numbers are compared</p>
              <p className="text-xs text-text-secondary leading-relaxed">
                Every comparison on this page uses the last {DAYS} days against the {DAYS} days
                immediately before them, with the evaluated period excluded from the baseline.
                Averages exclude missing days rather than treating them as zero, and days that are
                still in progress are removed from any total.
              </p>
              <ul className="mt-3 text-xs text-text-secondary space-y-1 list-none p-0">
                {headlineIds.map(id => {
                  const m = getMetric(id);
                  const cov = coverageFor(id);
                  return (
                    <li key={id} className="flex items-center justify-between gap-3">
                      <span className="text-text-primary">{m?.displayName ?? id}</span>
                      <span className="tnum">
                        {cov ? `${cov.observedDays}/${cov.expectedDays} days` : 'no coverage record'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </section>
      )}

      {/* ── Discover more ───────────────────────────── */}
      <MetricGrid
        metrics={otherCategories}
        title="Discover more metrics"
        hint="Every registered metric, with an honest state when the dataset has none"
        days={DAYS}
      />

      <CoverageNote metricIds={['resting_heart_rate', 'heart_rate_variability', 'vo2max', 'blood_oxygen_saturation', 'blood_pressure']} />
    </div>
  );
}
'use client';

import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import { getMetric, getAllMetrics, getMetricsByCategory } from '@/lib/metrics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
  datasetProvenanceSentence,
  seriesInWindow,
  seriesFor,
  coverageFor,
} from '@/lib/adapters/dataset';
import {
  buildSeriesSummary,
  trailingWindow,
  windowRangeLabel,
  formatDayKeyLong,
  type DayWindow,
  type SeriesSummary,
} from '@/lib/analytics';
import { Card, Badge, ChangeCue, DataStateNote } from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import type { MetricDefinition } from '@/lib/metrics/types';

// ── Page header ────────────────────────────────────────

export function DomainHeader({
  title, subtitle, children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] md:text-[32px] font-semibold tracking-tight text-text-primary leading-tight">
          {title}
        </h1>
        <p className="text-sm text-text-secondary mt-1 max-w-2xl">{subtitle}</p>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
      <h2 className="text-[20px] md:text-[24px] font-semibold text-text-primary">{children}</h2>
      {hint && <span className="text-xs text-text-secondary">{hint}</span>}
    </div>
  );
}

// ── Headline series card ───────────────────────────────

/**
 * THE shared rule for owner request 2 — implemented once, used everywhere:
 *
 *   A metric box is rendered only when the metric has at least one observation
 *   in the window that box is showing. Zero observations means the box is not
 *   rendered at all: no empty shell, no "0", no placeholder. Where the whole
 *   content of a panel disappears, its heading disappears with it (see the
 *   pages, which render a section only when it has at least one visible card).
 *
 * This is deliberately about *presence*, not sufficiency. When data does exist
 * but is too thin for a statistic, the honest coverage text ("needs 3 complete
 * days", "not enough history for a 30-day baseline") is kept — that is data
 * about coverage, not an empty box.
 */
export function hasObservationsInWindow(metricId: string, win: DayWindow): boolean {
  return seriesInWindow(metricId, win).length > 0;
}

/** Apply the shared rule to a set of built summaries: only those with a point in the window survive. */
export function visibleSummaries(summaries: SeriesSummary[]): SeriesSummary[] {
  return summaries.filter(s => s.points.length > 0);
}

export function SeriesCard({
  summary, days, emphasis = false,
}: {
  summary: SeriesSummary;
  days: number;
  emphasis?: boolean;
}) {
  const { units } = useUnits();

  // No observation in this window ⇒ no card (owner request 2).
  if (summary.points.length === 0) return null;

  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-text-secondary">{summary.metricName}</span>
        {summary.latest && (
          <span className="text-[10px] text-text-secondary">Latest · {formatDayKeyLong(summary.latest.key)}</span>
        )}
      </div>

      <div className={`${emphasis ? 'text-[34px] md:text-[40px]' : 'text-[28px] md:text-[32px]'} font-semibold tnum text-text-primary leading-none mb-2`}>
        {summary.latestValue}
      </div>

      <div className="text-xs text-text-secondary space-y-1 mb-3">
        {summary.valid ? (
          <div className="inline-flex items-center gap-1">
            <ChangeCue
              direction={summary.direction}
              value={summary.changeValue}
              percent={summary.changePercent}
            />
            <span>vs prior {days} days</span>
          </div>
        ) : (
          <div>Not enough paired observations for a {days}-day comparison.</div>
        )}
        <div className="tnum">
          {windowRangeLabel(summary.evaluatedWindow)} {summary.accumulating ? 'total' : 'avg'}{' '}
          {formatMetricWithUnit(summary.metricId, summary.windowAverage, units)}
        </div>
        <div className="tnum">
          {windowRangeLabel(summary.baselineWindow)} {summary.accumulating ? 'total' : 'avg'}{' '}
          {formatMetricWithUnit(summary.metricId, summary.baselineAverage, units)}
        </div>
        <div>
          {summary.lengthLabel} · {summary.counts.evaluated} vs {summary.counts.baseline} observations
        </div>
        {summary.excludedDays.length > 0 && (
          <div>Today excluded (still in progress), so a partial day is never compared with a complete one.</div>
        )}
      </div>

      <TrendFigure
        metricId={summary.metricId}
        data={summary.points}
        caption={`${summary.metricName} · ${windowRangeLabel(summary.window)} · ${
          summary.points.length
        } observations`}
        height={64}
      />

      <div className="mt-3">
        <Link
          href={`/metric/${summary.metricId}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open {summary.metricName} detail
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

// ── Summary builder helpers for pages ──────────────────

export function useSeriesSummaries(metricIds: string[], days: number): SeriesSummary[] {
  const { units } = useUnits();
  return metricIds.map(id => buildSeriesSummary(id, REFERENCE_KEY, days, units));
}

// ── Metric grid ────────────────────────────────────────

export function MetricGrid({
  metrics, title, hint, days,
}: {
  metrics: MetricDefinition[];
  title: string;
  hint?: string;
  days: number;
}) {
  // Only metrics with an observation in this window are rendered; when none
  // qualifies, the section (and its heading) disappears entirely.
  const win = trailingWindow(REFERENCE_KEY, days);
  const visible = metrics.filter(m => hasObservationsInWindow(m.id, win));
  if (visible.length === 0) return null;
  return (
    <section>
      <SectionTitle hint={hint}>{title}</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map(m => (
          <MetricTile key={m.id} metric={m} days={days} />
        ))}
      </div>
    </section>
  );
}

export function MetricTile({ metric, days }: { metric: MetricDefinition; days: number }) {
  const { units } = useUnits();
  const all = seriesFor(metric.id);
  const win = trailingWindow(REFERENCE_KEY, days);
  const points = seriesInWindow(metric.id, win);
  const latest = all.length ? all[all.length - 1] : undefined;

  // No observation in this window ⇒ no tile (owner request 2).
  if (points.length === 0) return null;

  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-text-primary">{metric.displayName}</span>
        <Badge variant="default" className="text-[10px] shrink-0">
          {all.length} obs
        </Badge>
      </div>

      <div className="text-xl font-semibold tnum text-text-primary leading-none mb-1">
        {latest ? formatMetricWithUnit(metric.id, latest.value, units) : '—'}
      </div>
      <p className="text-[11px] text-text-secondary">
        Latest · {latest ? formatDayKeyLong(latest.key) : 'no reading'} · {points.length} readings in{' '}
        {windowRangeLabel(win)}
      </p>

      <div className="mt-3">
        <Link href={`/metric/${metric.id}`} className="text-xs text-primary hover:underline">
          View detail
        </Link>
      </div>
    </Card>
  );
}

// ── Coverage footer ────────────────────────────────────

export function CoverageNote({ metricIds }: { metricIds: string[] }) {
  const dataMeta = useDatasetMeta();
  const rows = metricIds
    .map(id => ({ id, meta: getMetric(id), cov: coverageFor(id) }))
    .filter(r => r.cov);
  if (rows.length === 0) return null;
  const provenance = dataMeta.live
    ? `${datasetProvenanceSentence()} Newest observation ${dataMeta.dataAsOfKey || '—'}; one device per metric per day after splitting composite sources.`
    : datasetProvenanceSentence();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Info size={14} className="text-text-secondary" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-text-primary">Coverage for this page</h3>
      </div>
      <ul className="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {rows.map(({ id, meta, cov }) => (
          <li key={id} className="flex items-center justify-between gap-3">
            <span className="text-text-primary">{meta?.displayName ?? id}</span>
            <span className="text-text-secondary tnum">
              {cov!.observedDays}/{cov!.expectedDays} days · {cov!.samplingFrequency}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <DataStateNote>
          {provenance}
          Missing days are excluded rather than counted as zero.
        </DataStateNote>
      </div>
    </Card>
  );
}

// ── Registry-derived extras ────────────────────────────

export function metricsForCategories(categories: string[], exclude: string[] = []): MetricDefinition[] {
  const all = getAllMetrics();
  return all.filter(
    m => categories.includes(m.category) && !exclude.includes(m.id)
  );
}

export function categoryMetrics(category: string): MetricDefinition[] {
  return getMetricsByCategory(category as never);
}
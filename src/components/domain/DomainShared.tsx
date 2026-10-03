'use client';

import Link from 'next/link';
import { ChevronRight, Info } from 'lucide-react';
import { getMetric, getAllMetrics, getMetricsByCategory } from '@/lib/metrics';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import {
  REFERENCE_KEY,
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
import { useUnits } from '@/components/ui/UnitsProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import type { MetricDefinition } from '@/lib/metrics/types';
import { PageHero } from '@/components/art/PageHero';
import { Spark } from '@/components/art/Spark';
import { CATEGORY_VAR } from '@/components/art/categories';
import type { ArtCategory } from '@/components/art/categories';

// ── Page header ────────────────────────────────────────

const CATEGORY_BY_TITLE: Record<string, ArtCategory> = {
  Health: 'cardiovascular', Sleep: 'sleep', Activity: 'activity', Body: 'body',
  Nutrition: 'nutrition', Workouts: 'activity', Insights: 'insight', Trends: 'overview',
  Lab: 'lab', Medications: 'medication',
};

export function DomainHeader({
  title, subtitle, children, category, eyebrow, aside,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
  category?: ArtCategory;
  eyebrow?: string;
  aside?: React.ReactNode;
}) {
  return (
    <PageHero
      title={title}
      subtitle={subtitle}
      eyebrow={eyebrow ?? title}
      category={category ?? CATEGORY_BY_TITLE[title] ?? 'neutral'}
      aside={aside}
    >
      {children}
    </PageHero>
  );
}

export function SectionTitle({
  children, hint, action,
}: {
  children: React.ReactNode;
  hint?: string;
  /** A control for the section (a menu, say), after the hint. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
      <h2 className="text-[19px] md:text-[22px] font-semibold tracking-[-0.025em] text-text-primary">{children}</h2>
      {(hint || action) && (
        <span className="flex items-center gap-2">
          {hint && <span className="text-xs text-text-secondary">{hint}</span>}
          {action}
        </span>
      )}
    </div>
  );
}

// ── Total card ─────────────────────────────────────────

/** One figure in a connected band of totals (a Card split with dividers). */
export function TotalCard({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="p-5">
      <div className="mb-2 text-[12px] font-medium text-text-secondary">{label}</div>
      <div className="mb-1.5 text-[26px] font-semibold leading-none tnum tracking-[-0.03em] text-text-primary" title={title}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-secondary">{sub}</div>}
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

const CATEGORY_TO_ART: Record<string, ArtCategory> = {
  cardiovascular: 'cardiovascular', activity: 'activity', sleep: 'sleep', body: 'body',
  nutrition: 'nutrition', respiratory: 'respiratory', recovery: 'recovery',
};
export function artCategoryOf(metricId: string): ArtCategory {
  const c = getMetric(metricId)?.category as string | undefined;
  return (c && CATEGORY_TO_ART[c]) || 'neutral';
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

  const color = CATEGORY_VAR[artCategoryOf(summary.metricId)];
  const values = summary.points.map(p => p.value);
  const first = summary.points[0];
  const last = summary.points[summary.points.length - 1];
  const sparkLabel = `${summary.metricName} · ${windowRangeLabel(summary.window)} · ${summary.points.length} observations. From ${formatMetricWithUnit(summary.metricId, first.value, units)} to ${formatMetricWithUnit(summary.metricId, last.value, units)}.`;

  return (
    <Card className="group relative flex flex-col overflow-hidden p-5">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} aria-hidden="true" />
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
          {summary.metricName}
        </span>
        {summary.latest && (
          <span className="text-[11px] text-text-secondary">{formatDayKeyLong(summary.latest.key)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className={`${emphasis ? 'text-[40px] md:text-[46px]' : 'text-[32px] md:text-[36px]'} font-semibold tnum leading-none tracking-[-0.035em] text-text-primary`}>
          {summary.latestValue}
        </div>
        {summary.valid ? (
          <span className="mb-0.5 inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs text-text-primary ring-1 ring-inset ring-border">
            <ChangeCue direction={summary.direction} value={summary.changeValue} percent={summary.changePercent} />
            <span className="text-text-secondary">vs prior {days}d</span>
          </span>
        ) : (
          <span className="mb-0.5 text-xs text-text-secondary">Not enough paired observations for a {days}-day comparison.</span>
        )}
      </div>

      <div role="img" aria-label={sparkLabel} className="my-4">
        <Spark values={values} color={color} height={56} />
      </div>

      <dl className="space-y-1.5 border-t border-border pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-3 tnum">
          <dt className="text-text-secondary">{windowRangeLabel(summary.evaluatedWindow)} {summary.accumulating ? 'total' : 'avg'}</dt>
          <dd className="text-text-primary">{formatMetricWithUnit(summary.metricId, summary.windowAverage, units)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 tnum">
          <dt className="text-text-secondary">{windowRangeLabel(summary.baselineWindow)} {summary.accumulating ? 'total' : 'avg'}</dt>
          <dd className="text-text-primary">{formatMetricWithUnit(summary.metricId, summary.baselineAverage, units)}</dd>
        </div>
        <div className="text-text-secondary">
          {summary.lengthLabel} · {summary.counts.evaluated} vs {summary.counts.baseline} observations
        </div>
        {summary.excludedDays.length > 0 && (
          <div className="text-text-secondary">Today excluded (still in progress), so a partial day is never compared with a complete one.</div>
        )}
      </dl>

      <Link
        href={`/metric/${summary.metricId}`}
        className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
      >
        Open {summary.metricName} detail
        <ChevronRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
      </Link>
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
  const color = CATEGORY_VAR[artCategoryOf(metric.id)];

  return (
    <Card className="group relative flex flex-col overflow-hidden p-4">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden="true" />
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-text-primary">{metric.displayName}</span>
        <Badge variant="default" className="shrink-0 text-[10px]">{all.length} obs</Badge>
      </div>
      <div className="text-[24px] font-semibold leading-tight tnum tracking-[-0.025em] text-text-primary">
        {latest ? formatMetricWithUnit(metric.id, latest.value, units) : '—'}
      </div>
      <div className="my-2" aria-hidden="true"><Spark values={points.map(p => p.value)} color={color} height={32} /></div>
      <p className="text-[11px] text-text-secondary">
        Latest · {latest ? formatDayKeyLong(latest.key) : 'no reading'} · {points.length} readings in {windowRangeLabel(win)}
      </p>
      <Link href={`/metric/${metric.id}`} className="mt-2 text-xs font-medium text-primary hover:underline">
        View detail
      </Link>
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
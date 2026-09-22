'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, CalendarDays, ChevronRight, Info, Lightbulb } from 'lucide-react';
import { REFERENCE_KEY, WINDOW_START_KEY, seriesInWindow } from '@/lib/adapters/dataset';
import { formatMetricWithUnit, formatPercent } from '@/lib/metrics/format';
import { getMetric } from '@/lib/metrics';
import { formatDayKeyLong, formatDayKeyShort, windowRangeLabel } from '@/lib/analytics/windows';
import {
  buildBriefing,
  buildReportArchive,
  buildStorySummary,
  buildTrendFigure,
  buildWatchItem,
  filterInsights,
  generateInsights,
  insightCounts,
  isWithinWord,
  type Insight,
  type InsightKind,
  type PeriodReport,
} from '@/lib/analytics';
import {
  Card, Badge, ChangeCue, DataStateNote, EmptyState, SegmentedControl, Tabs,
} from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { DomainHeader, SectionTitle } from './DomainShared';
import { useUnits } from '@/components/ui/UnitsProvider';

type FilterValue = 'all' | InsightKind;

const FILTER_LABELS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'change', label: 'Changes' },
  { value: 'trend', label: 'Trends' },
  { value: 'association', label: 'Associations' },
  { value: 'report', label: 'Reports' },
];

export function InsightsPage({
  initialFilter = 'all',
  initialTab = 'insights',
}: {
  initialFilter?: FilterValue;
  initialTab?: string;
}) {
  const { units } = useUnits();
  const [filter, setFilter] = useState<FilterValue>(initialFilter);
  const [tab, setTab] = useState(initialTab);

  const insights = useMemo(() => generateInsights(REFERENCE_KEY, units), [units]);
  const counts = useMemo(() => insightCounts(insights), [insights]);
  const shown = useMemo(() => filterInsights(insights, filter), [insights, filter]);

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Insights"
        subtitle={`Evidence-linked observations generated from the shared dataset on every render. Coverage and window are stated on each card, and an observation is omitted entirely when the evidence is too thin to support it.`}
      />

      <Tabs
        tabs={[
          { id: 'insights', label: 'Insights' },
          { id: 'reports', label: 'Report archive' },
          { id: 'story', label: 'Health story' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'insights' && (
        <div className="space-y-6">
          <DailyBriefingCard units={units} />

          <section>
            <SectionTitle hint="minimum coverage applied before an observation is emitted">
              Observations
            </SectionTitle>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <SegmentedControl
                options={FILTER_LABELS.map(f => ({
                  value: f.value,
                  label: `${f.label} (${f.value === 'all' ? counts.all : counts[f.value]})`,
                }))}
                value={filter}
                onChange={v => setFilter(v as FilterValue)}
                ariaLabel="Insight filter"
              />
            </div>

            {shown.length === 0 ? (
              <Card className="p-4">
                <EmptyState
                  icon={<Lightbulb size={28} aria-hidden="true" />}
                  title={`No ${filter === 'all' ? '' : `${filter} `}observations meet the coverage rule`}
                  description={
                    filter === 'all'
                      ? 'No tracked metric moved by 5% or more with at least five observations on both sides, and no paired series reached the association threshold. Nothing is shown rather than showing a weak observation.'
                      : `Nothing of this kind currently clears the coverage and magnitude thresholds (at least five observations on each side, a 5% move, and at least ten paired days for an association). Switch to All to see what did.`
                  }
                  action={
                    <button
                      type="button"
                      onClick={() => setFilter('all')}
                      className="px-3 py-2 text-sm text-primary hover:underline min-h-[44px]"
                    >
                      Show all filters
                    </button>
                  }
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {shown.map(insight => (
                  <InsightCard key={insight.id} insight={insight} units={units} />
                ))}
              </div>
            )}
          </section>

          <Card className="p-5">
            <div className="flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
              <div className="text-xs text-text-secondary leading-relaxed space-y-1">
                <p>
                  <span className="text-text-primary font-medium">How these are generated.</span> Every observation on
                  this page is computed from the committed fixture dataset at render time using the same analytics as the
                  rest of the app. Nothing is written by hand: an observation is emitted only when both sides carry at
                  least five observations, the change is at least 5%, or a paired series clears ten paired days — and none
                  of them implies a cause.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'reports' && <ReportArchive units={units} />}

      {tab === 'story' && <HealthStory units={units} />}
    </div>
  );
}

// ── Daily briefing ─────────────────────────────────────

function DailyBriefingCard({ units }: { units: 'metric' | 'imperial' }) {
  const briefing = useMemo(() => buildBriefing(REFERENCE_KEY), []);
  const watch = useMemo(() => buildWatchItem(briefing, units), [briefing, units]);

  return (
    <section>
      <SectionTitle hint={formatDayKeyLong(REFERENCE_KEY)}>Daily briefing</SectionTitle>
      <Card variant="hero" className="p-6 md:p-8" as="section">
        <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-hero-muted mb-3">
          TODAY&rsquo;S BRIEFING
        </p>
        <h2 className="text-[24px] md:text-[30px] font-semibold leading-[1.15] tracking-tight mb-3 text-hero-foreground">
          {briefing.headline}
        </h2>
        <p className="text-sm text-hero-secondary max-w-2xl mb-5 leading-relaxed">{briefing.body}</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-3 list-none p-0 mb-5">
          {briefing.categories.map(c => (
            <li key={c.key} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-hero-muted shrink-0" aria-hidden="true" />
              <span className="text-xs text-hero-secondary">{c.label}</span>
              <span className="text-xs font-medium text-hero-foreground">{c.status}</span>
              <span className="text-[10px] text-hero-muted tnum">
                {c.result.counts.evaluated} vs {c.result.counts.baseline} obs
              </span>
            </li>
          ))}
        </ul>
        {watch && (
          <p className="text-xs text-hero-secondary leading-relaxed">
            One thing to watch — {watch.metricName}: {watch.changeLabel} {watch.changePercent ?? ''} vs your prior
            baseline. {watch.evaluatedLabel}, {watch.baselineLabel}.
          </p>
        )}
      </Card>
    </section>
  );
}

// ── Insight card ───────────────────────────────────────

const KIND_LABEL: Record<InsightKind, string> = {
  change: 'Change',
  trend: 'Trend',
  association: 'Association',
  report: 'Report',
};

function InsightCard({ insight, units }: { insight: Insight; units: 'metric' | 'imperial' }) {
  return (
    <Card className="p-5 flex flex-col" as="article">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Badge variant="accent" className="text-[10px]">{KIND_LABEL[insight.kind]}</Badge>
        <span className="text-[11px] text-text-secondary tnum">{insight.windowLabel}</span>
      </div>

      <h3 className="text-sm font-semibold text-text-primary mb-1 leading-snug">{insight.title}</h3>
      <p className="text-xs text-text-secondary mb-3 leading-relaxed">{insight.summary}</p>

      <dl className="text-xs text-text-secondary space-y-1 mb-3">
        {insight.computed.map((line, i) => (
          <div key={i} className="flex gap-2">
            <dd className="tnum text-text-primary leading-relaxed">{line}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] text-text-secondary mb-3">{insight.coverage}</p>

      <div className="space-y-2 mb-3">
        {insight.evidence.slice(0, 2).map((ev, i) => (
          <div key={`${ev.metricId}-${i}`} className="border border-border rounded-control p-2.5">
            <div className="text-[11px] font-medium text-text-primary mb-0.5">{ev.metricName}</div>
            <div className="text-[10px] text-text-secondary tnum leading-relaxed">
              {ev.windowLabel} · {ev.aggregation} · {ev.coverage}
            </div>
          </div>
        ))}
      </div>

      {insight.points.length >= 2 && (
        <TrendFigure
          metricId={insight.metricId}
          data={insight.points}
          caption={`${getMetric(insight.metricId)?.displayName ?? insight.metricId} · ${insight.windowLabel} · ${insight.points.length} points`}
          height={56}
          units={units}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={insight.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Open the metric at this period <ChevronRight size={12} aria-hidden="true" />
        </Link>
      </div>

      <p className="text-[11px] text-text-secondary mt-2 leading-relaxed">{insight.caveat}</p>
    </Card>
  );
}

// ── Report archive ─────────────────────────────────────

function ReportArchive({ units }: { units: 'metric' | 'imperial' }) {
  const archive = useMemo(() => buildReportArchive(REFERENCE_KEY, { weeks: 12, months: 7, system: units }), [units]);

  return (
    <div className="space-y-6">
      <Card variant="accent" className="p-5">
        <div className="flex items-start gap-3">
          <BookOpen size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div className="text-sm text-text-primary space-y-1.5">
            <p className="font-medium">Reports generated from the dataset</p>
            <p className="text-text-secondary leading-relaxed">
              Each report below is composed at render time from the same aggregations the rest of the app uses: the
              period, the coverage and every figure come from the dataset. A period that is clipped by the dataset
              window (the data begins {formatDayKeyShort(WINDOW_START_KEY)} and ends {formatDayKeyLong(REFERENCE_KEY)}) says
              so and states how many days it covers.
            </p>
          </div>
        </div>
      </Card>

      <section>
        <SectionTitle hint={`${archive.weekly.length} complete weeks · 7 complete days each`}>Weekly reports</SectionTitle>
        <div className="space-y-3">
          {archive.weekly.map(r => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle hint={`${archive.monthly.length} calendar months, clipped to the dataset`}>Monthly reports</SectionTitle>
        <div className="space-y-3">
          {archive.monthly.map(r => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportCard({ report }: { report: PeriodReport }) {
  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[44px]">
          <CalendarDays size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-text-primary">{report.title}</span>
          <span className="text-[11px] text-text-secondary tnum">{report.periodLabel}</span>
          {report.partial && (
            <Badge variant="warning" className="text-[10px]">
              {report.coveredDays} of {report.days} days
            </Badge>
          )}
          {report.highlights.length > 0 && (
            <span className="text-[11px] text-text-secondary">
              {report.highlights.length} metric{report.highlights.length === 1 ? '' : 's'} moved 5%+
            </span>
          )}
        </summary>

        <div className="mt-4 space-y-3">
          {report.paragraphs.map((p, i) => (
            <p key={i} className="text-sm text-text-secondary leading-relaxed">{p}</p>
          ))}

          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${report.title} figures`}>
            <table className="w-full text-sm text-left">
              <caption className="sr-only">Computed values for {report.periodLabel}</caption>
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Value</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Aggregation</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Observations</th>
                  <th scope="col" className="py-2 font-medium">Change vs preceding period</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map(l => (
                  <tr key={l.metricId} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-text-primary">{l.metricName}</td>
                    <td className="py-2 pr-4 tnum text-text-primary">{l.value}</td>
                    <td className="py-2 pr-4 text-[11px] text-text-secondary">{l.aggregation}</td>
                    <td className="py-2 pr-4 tnum text-[11px] text-text-secondary">{l.coverage}</td>
                    <td className="py-2 tnum text-text-primary">
                      {l.deltaPercent == null ? 'not comparable' : `${formatPercent(l.deltaPercent)} (${l.deltaValue})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.highlights.length > 0 && (
            <ul className="list-none p-0 m-0 space-y-1">
              {report.highlights.map((h, i) => (
                <li key={i} className="text-xs text-category-attention">{h}</li>
              ))}
            </ul>
          )}

          <DataStateNote>{report.coverageNote} Figures are computed over the days the dataset covers; missing days are excluded and never counted as zero.</DataStateNote>
        </div>
      </details>
    </Card>
  );
}

// ── Health story ───────────────────────────────────────

function HealthStory({ units }: { units: 'metric' | 'imperial' }) {
  const [days, setDays] = useState('30');
  const story = useMemo(() => buildStorySummary(REFERENCE_KEY, Number(days), units), [days, units]);
  const figure = useMemo(() => buildTrendFigure('resting_heart_rate', REFERENCE_KEY, Number(days), units), [days, units]);
  // Owner request 2: an observation for a metric with no reading in this window
  // is not rendered at all.
  const observations = useMemo(
    () => story.observations.filter(o => seriesInWindow(o.metricId, story.window).length > 0),
    [story]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[20px] md:text-[24px] font-semibold text-text-primary">Your health story</h2>
        <SegmentedControl
          options={[
            { value: '30', label: '30D' },
            { value: '90', label: '90D' },
            { value: '180', label: '180D' },
          ]}
          value={days}
          onChange={setDays}
          ariaLabel="Health story period"
        />
      </div>

      <Card className="p-5 md:p-6">
        <h3 className="text-base font-semibold text-text-primary mb-1">{story.windowDays}-day summary</h3>
        <p className="text-[11px] text-text-secondary mb-3">{windowRangeLabel(story.window)}</p>
        <p className="text-sm text-text-secondary leading-relaxed mb-4">{story.paragraph}</p>

        <ul className="list-none p-0 m-0 space-y-3 mb-4">
          {observations.map(o => (
            <li key={o.metricId} className="flex items-start gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                  o.status !== 'Not enough data' && !isWithinWord(o.status) ? 'bg-category-attention' : 'bg-primary'
                }`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <Link href={`/metric/${o.metricId}?range=${days}d`} className="text-sm font-medium text-text-primary hover:underline">
                  {o.title}
                </Link>
                <p className="text-xs text-text-secondary mt-0.5">{o.detail}</p>
                <p className="text-[11px] text-text-secondary mt-0.5">{o.evidence}</p>
              </div>
            </li>
          ))}
        </ul>

        {figure.points.length > 0 && (
          <TrendFigure
            metricId={figure.metricId}
            data={figure.points}
            caption={`${figure.metricName} · ${figure.windowLabel} · ${figure.firstValue} → ${figure.lastValue}${figure.unit ? ` ${figure.unit}` : ''}`}
            height={80}
            units={units}
          />
        )}
      </Card>

      <Card className="p-5">
        <p className="text-sm text-text-primary mb-2">{observations.length} tracked signals in this period</p>
        <DataStateNote>
          A health story describes your own recorded history over the selected period. It is not a clinical summary, the
          baseline it compares against is your own recent history rather than a medical reference range, and no
          observation here implies a diagnosis or a cause.
        </DataStateNote>
      </Card>
    </div>
  );
}

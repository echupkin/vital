'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, RotateCcw, Sparkles, Brain, History, Info } from 'lucide-react';
import { getMetric } from '@/lib/metrics';
import {
  REFERENCE_KEY,
  seriesInWindow,
  seriesFor,
  pointOn,
  latestPoint,
  coverageFor,
  type DayPoint,
} from '@/lib/adapters/dataset';
import {
  buildBriefing,
  buildStorySummary,
  buildTrendFigure,
  buildWatchItem,
  changeRowSummary,
  compareWindows,
  exclusionFootnote,
  formatDayKeyLong,
  weekdayName,
  percentChange,
  previousWindow,
  trailingWindow,
  windowRangeLabel,
  isWithinWord,
  BRIEFING_EVALUATED_DAYS,
  BRIEFING_BASELINE_DAYS,
  type ChangeRow,
  type DayWindow,
  type WindowComparison,
} from '@/lib/analytics';
import {
  DURATION_AGGREGATE_METRIC_IDS,
  describeChange,
  durationAggregateExact,
  formatDurationAggregate,
  formatMetricWithUnit,
  formatPercent,
  metricUnit,
} from '@/lib/metrics/format';
import {
  Card, Badge, ChangeCue, SegmentedControl, DataStateNote, Sparkline,
} from '@/components/ui/primitives';
import { TrendFigure } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useAnalystConfig } from '@/components/analyst/useAnalystConfig';
import { useBriefing } from '@/components/analyst/useBriefing';
import { COMPUTED_ATTRIBUTION, BRIEFING_BOUNDARY_NOTE } from '@/lib/briefing/attribution';
import { briefingSchedule, briefingTimeLabel, briefingWrittenLate } from '@/lib/briefing/schedule';
import { useProfile } from '@/components/profile/ProfileProvider';
import { greetingLine } from '@/lib/profile/types';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { datasetProvenanceSentence } from '@/lib/adapters/dataset';

const STORY_RANGE_OPTIONS = [
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
];

const USED_BRIEFING_METRICS = ['resting_heart_rate', 'heart_rate_variability', 'sleep_analysis', 'step_count'] as const;

export function OverviewPage({ initialGreeting }: { initialGreeting: string }) {
  const { units } = useUnits();
  const dataMeta = useDatasetMeta();
  const { profile } = useProfile();
  const [storyDays, setStoryDays] = useState('30');
  const { state: analystState } = useAnalystConfig();

  // Today's briefing: the computed one is built here (and rendered on the server
  // and on first paint, so the hero never waits on a model); the server-side
  // written briefing replaces it as soon as it arrives, and it carries its own
  // attribution line. `written` is null until the endpoint answers.
  const { briefing: written, pending: briefingPending, error: briefingError, regenerating, regenerate } =
    useBriefing(units);

  // The greeting is computed on the server for this request (so the first paint
  // is right and hydration is clean) and re-derived here as the clock moves and
  // whenever the profile changes — never frozen from the first render.
  const [greeting, setGreeting] = useState(initialGreeting);
  useEffect(() => {
    const update = () => setGreeting(greetingLine(profile.name, new Date(), profile.timezone));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [profile.name, profile.timezone, initialGreeting]);

  // Which day the hero is showing, in the profile's timezone. The server's
  // schedule decides the cache key; this is the same rule, so the label cannot
  // disagree with what the server actually wrote.
  const schedule = useMemo(() => briefingSchedule(profile), [profile]);
  const coversDay = written?.coversDay ?? schedule.coversDay;
  const writtenAt = written ? briefingTimeLabel(written.generatedAt, profile.timezone) : null;
  const scheduledLabel = `${String(schedule.hour).padStart(2, '0')}:00`;
  // A briefing is written AT the configured hour by the server's scheduler. If it
  // was written later than that — the process was down at the hour, or this is the
  // first run after the setting changed — the label says so rather than implying
  // the schedule ran on time.
  const writtenLate = written
    ? briefingWrittenLate(written.generatedAt, schedule.hour, profile.timezone)
    : false;

  const briefing = useMemo(() => buildBriefing(REFERENCE_KEY), []);
  const watch = useMemo(() => buildWatchItem(briefing, units), [briefing, units]);
  const story = useMemo(() => buildStorySummary(REFERENCE_KEY, Number(storyDays), units), [storyDays, units]);

  // Yesterday's values for the core-signal cards.
  const yesterdayKey = useMemo(() => {
    const d = new Date(`${REFERENCE_KEY}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const coreSignals = useMemo(
    () =>
      [
        { metricId: 'resting_heart_rate', label: 'Resting Heart Rate' },
        { metricId: 'heart_rate_variability', label: 'HRV' },
        { metricId: 'sleep_analysis', label: 'Sleep Duration' },
      ].map(({ metricId, label }) => {
        const all = seriesFor(metricId);
        const latest = latestPoint(all);
        const yesterday = pointOn(all, yesterdayKey);
        const win30 = trailingWindow(REFERENCE_KEY, 30);
        const base30 = previousWindow(win30, 30);
        const raw = seriesInWindow(metricId, win30);
        const baselineValues = seriesInWindow(metricId, base30).map(p => p.value);
        const baseline =
          baselineValues.length > 0
            ? baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length
            : NaN;
        const delta = latest && yesterday ? latest.value - yesterday.value : null;
        const deltaPct = delta != null && yesterday ? percentChange(latest!.value, yesterday.value) : null;
        return {
          metricId,
          label,
          latest,
          yesterday,
          delta,
          deltaPct,
          baseline,
          baselineWindow: base30,
          sparkline: raw.map(p => p.value),
          counts: { window: raw.length, baseline: baselineValues.length },
        };
      }),
    [yesterdayKey]
  );

  // "What changed this week?" — the last 7 days against the preceding 7.
  // Accumulating metrics drop the in-progress day from BOTH sides and compare
  // the same number of complete days, so a partial day is never compared with a
  // complete one and a 6-day total is never compared with a 7-day total.
  const weekRows = useMemo(() => {
    const defs = [
      { label: 'Sleep', metricId: 'sleep_analysis' },
      { label: 'Resting HR', metricId: 'resting_heart_rate' },
      { label: 'HRV', metricId: 'heart_rate_variability' },
      { label: 'Exercise', metricId: 'apple_exercise_time' },
    ];
    const comparisons = defs.map(d => ({
      ...d,
      cmp: compareWindows(d.metricId, REFERENCE_KEY, 7, { meta: getMetric(d.metricId) }),
    }));
    const rows: ChangeRow[] = comparisons.map(c => ({
      metricId: c.metricId,
      label: c.label,
      comparison: c.cmp.comparison,
      excludedDays: c.cmp.excludedDays,
      counts: c.cmp.counts,
    }));
    return {
      comparisons,
      rows,
      summary: changeRowSummary(rows),
      footnote: exclusionFootnote(comparisons.map(c => c.cmp)),
    };
  }, []);

  const storyFigure = useMemo(
    () => buildTrendFigure('resting_heart_rate', REFERENCE_KEY, Number(storyDays), units),
    [storyDays, units]
  );

  // Evidence behind the "one thing to watch" card.
  const watchSeries = useMemo(
    () => (watch ? seriesInWindow(watch.metricId, watch.evaluatedWindow) : []),
    [watch]
  );
  const watchCoverage = useMemo(() => {
    if (!watch) return '—';
    const cov = coverageFor(watch.metricId);
    return cov ? `${cov.observedDays}/${cov.expectedDays} days` : 'no coverage record';
  }, [watch]);

  const sideInsights = useMemo(() => {
    return story.observations
      .filter(o => o.metricId !== 'resting_heart_rate')
      // Owner request 2: an observation for a metric with no reading in this
      // window is not a box with data in it, so it is not rendered.
      .filter(o => seriesInWindow(o.metricId, story.window).length > 0)
      .slice(0, 2)
      .map(o => {
        const cov = coverageFor(o.metricId);
        return {
          ...o,
          coverage: cov ? `${cov.observedDays}/${cov.expectedDays} days recorded · ${cov.samplingFrequency}` : 'Coverage unavailable',
        };
      });
  }, [story]);

  const storyObservations = useMemo(
    () => story.observations.filter(o => seriesInWindow(o.metricId, story.window).length > 0),
    [story]
  );

  const changeSummary = weekRows.summary;

  // The panel header names both kinds of window explicitly: metrics that are
  // complete for the final day keep the full 7 days, accumulating metrics use
  // the same number of complete days on both sides.
  const panelWindows = useMemo(() => {
    const complete = weekRows.comparisons.filter(c => c.cmp.excludedDays.length > 0);
    const whole = weekRows.comparisons.filter(c => c.cmp.excludedDays.length === 0);
    const parts: string[] = [];
    if (whole.length > 0) {
      parts.push(
        `${whole.map(c => c.label).join(', ')}: ${windowRangeLabel(whole[0].cmp.evaluatedWindow)} vs ${windowRangeLabel(whole[0].cmp.baselineWindow)}`
      );
    }
    if (complete.length > 0) {
      parts.push(
        `${complete.map(c => c.label).join(', ')}: ${complete[0].cmp.lengthLabel} (${windowRangeLabel(complete[0].cmp.evaluatedWindow)} vs ${windowRangeLabel(complete[0].cmp.baselineWindow)})`
      );
    }
    return parts.join(' · ');
  }, [weekRows]);

  return (
    <div className="space-y-8">
      {/* ── A. Greeting ─────────────────────────────── */}
      <div className="min-w-0">
        <h1 className="text-[32px] sm:text-[40px] md:text-[44px] font-semibold tracking-tight text-text-primary leading-[1.1]">
          {greeting}
        </h1>
        <p className="text-sm sm:text-base text-text-secondary mt-1">
          Your health snapshot for {weekdayName(REFERENCE_KEY)}, {formatDayKeyLong(REFERENCE_KEY)}
        </p>
      </div>

      {/* ── B. Main briefing hero + companion ───────── */}
      {/* items-start: each card sizes to its own content, so neither stretches
          to the other's height and leaves an empty band inside it. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
        <Card variant="hero" className="md:col-span-2 p-6 md:p-8 flex flex-col h-fit" as="section">
          <p className="text-[10px] uppercase tracking-[0.15em] font-medium text-hero-muted mb-3">
            TODAY&rsquo;S BRIEFING
          </p>
          <h2 className="text-[26px] md:text-[34px] font-semibold leading-[1.15] tracking-tight mb-3 text-hero-foreground">
            {written?.headline ?? briefing.headline}
          </h2>
          <p className="text-sm text-hero-secondary max-w-xl mb-4 leading-relaxed">
            {written?.body ?? briefing.body}
          </p>

          {/* Recommendations are model-authored copy. The computed briefing names
              no model, so it carries none rather than a deterministic stand-in. */}
          {written && written.recommendations.length > 0 && (
            <ul className="list-none p-0 m-0 space-y-2 mb-5 max-w-xl">
              {written.recommendations.map((rec, i) => (
                <li key={`${i}-${rec.slice(0, 12)}`} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-hero-muted shrink-0 mt-1.5" aria-hidden="true" />
                  <span className="text-sm text-hero-secondary leading-relaxed">{rec}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Which day this briefing covers, who wrote it, and when it was
              written. The day and the generation time are stated, not implied:
              before the profile's briefing hour the hero shows the PREVIOUS
              day's briefing and says so rather than going blank or claiming to
              be "today's". */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-5">
            <p className="text-[11px] text-hero-muted">
              <span data-briefing-day>Briefing for {formatDayKeyLong(coversDay)}</span>
              {writtenAt ? ` · written ${writtenAt}` : ' · not written yet'}
              {writtenAt && writtenLate ? `, after the ${scheduledLabel} briefing hour` : ''}
              {!written && !schedule.allowed ? ` · today's is written at ${scheduledLabel}` : ''}
              {schedule.allowed && writtenLate ? ` · scheduled for ${scheduledLabel}` : ''}
              {' · '}
              <span data-briefing-attribution>{written?.attribution ?? COMPUTED_ATTRIBUTION}</span>
              {written?.model && written.provider ? ` · ${written.provider}` : ''}
              {briefingPending ? ' · refreshing…' : ''}
            </p>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={regenerating}
              title={`Replaces the briefing for ${formatDayKeyLong(coversDay)} with a newly written one`}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-hero-muted hover:underline disabled:opacity-60 disabled:no-underline"
            >
              <RotateCcw size={11} aria-hidden="true" />
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
          {briefingError && (
            <p role="status" className="text-[11px] text-hero-muted mb-5">
              Regeneration did not change the briefing: {briefingError} The text above is unchanged and no
              further attempts are made automatically.
            </p>
          )}

          {/* Category summaries — the same computation as the headline, each one
              carrying the observation counts it was derived from. */}
          <ul className="flex flex-wrap gap-x-5 gap-y-3 mb-5 list-none p-0">
            {briefing.categories.map(cat => (
              <li key={cat.key} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-hero-muted shrink-0" aria-hidden="true" />
                <span className="text-xs text-hero-secondary">{cat.label}</span>
                <span className="text-xs font-medium text-hero-foreground">{cat.status}</span>
                <span className="text-[10px] text-hero-muted tnum">
                  {cat.result.counts.evaluated} vs {cat.result.counts.baseline} obs
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3">
            <Link
              href="#health-story"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-hero-muted hover:underline"
            >
              View your health story
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <p className="text-[11px] text-hero-muted">
              Last {BRIEFING_EVALUATED_DAYS} days compared with the prior {BRIEFING_BASELINE_DAYS} days
              ({windowRangeLabel(briefing.categories[0].evaluatedWindow)} vs{' '}
              {windowRangeLabel(briefing.categories[0].baselineWindow)}). Totals that are still
              accumulating exclude today.
            </p>
            <p className="text-[11px] text-hero-muted">{BRIEFING_BOUNDARY_NOTE}</p>
          </div>
        </Card>

        {/* Companion card — filled with the evidence it claims */}
        <Card className="p-6 flex flex-col" as="section">
          <p
            className={`text-[10px] uppercase tracking-[0.15em] font-medium mb-3 ${
              watch?.tone === 'attention' ? 'text-category-attention' : 'text-text-secondary'
            }`}
          >
            ONE THING TO WATCH
          </p>

          {watch ? (
            <>
              <p className="text-lg font-semibold text-text-primary leading-snug mb-1">
                {watch.metricName} {watch.status === 'Above recent average' ? 'above' : 'below'} your recent baseline
              </p>
              <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                <span className="text-2xl font-semibold tnum text-text-primary">
                  {watch.changeLabel}
                </span>
                {watch.changePercent && (
                  <span className="text-sm tnum text-text-secondary">{watch.changePercent}</span>
                )}
                <span className="text-xs text-text-secondary">vs your prior baseline</span>
              </div>
              <dl className="text-xs text-text-secondary space-y-1 mb-3">
                <div className="flex flex-col gap-0.5 pb-1 border-b border-border">
                  <dt>{watch.evaluatedLabel}</dt>
                  <dd className="tnum text-text-primary">{watch.evaluatedValue}</dd>
                </div>
                <div className="flex flex-col gap-0.5 pb-1 border-b border-border">
                  <dt>{watch.baselineLabel}</dt>
                  <dd className="tnum text-text-primary">{watch.baselineValue}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Observations</dt>
                  <dd className="tnum text-text-primary">
                    {watch.counts.evaluated} vs {watch.counts.baseline}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Coverage</dt>
                  <dd className="tnum text-text-primary text-right">
                    {watchCoverage}
                  </dd>
                </div>
              </dl>

              {/* The evidence behind the headline figure */}
              <TrendFigure
                metricId={watch.metricId}
                data={watchSeries}
                caption={`${watch.metricName} · ${windowRangeLabel(watch.evaluatedWindow)} · ${watchSeries.length} observations`}
                height={72}
                units={units}
              />

              <p className="text-xs text-text-secondary leading-relaxed mt-3 mb-3">{watch.reason}</p>
              {watch.exclusionNote && (
                <DataStateNote>{watch.exclusionNote}</DataStateNote>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-text-primary mb-1">
                No change outside your recent baselines
              </p>
              <p className="text-xs text-text-secondary mb-4 leading-relaxed">
                Every tracked signal in this week&rsquo;s comparison sits within its recent baseline.
                There is nothing here that warrants attention.
              </p>
            </>
          )}

          <div className="mt-4">
            <Link
              href={`/metric/${watch ? watch.metricId : 'heart_rate_variability'}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View evidence <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </Card>
      </div>

      {/* ── C. Core health signals ─────────────────── */}
      {/* Owner request 2: a signal with no observation in the 30-day window is
          not rendered, and the section disappears with its last card. */}
      {coreSignals.some(s => s.counts.window > 0) && (
        <section>
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <h2 className="text-[22px] md:text-[24px] font-semibold text-text-primary">
              Core health signals
            </h2>
            <span className="text-xs text-text-secondary">Latest available reading, with yesterday for comparison</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {coreSignals
              .filter(sig => sig.counts.window > 0)
              .map(sig => (
                <SignalCard key={sig.metricId} {...sig} units={units} />
              ))}
          </div>
        </section>
      )}

      {/* ── D. What changed this week ──────────────── */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-4">
          <h2 className="text-[22px] md:text-[24px] font-semibold text-text-primary">
            What changed this week?
          </h2>
          <span className="text-xs text-text-secondary tnum">{panelWindows}</span>
        </div>
        <Card className="p-5 md:p-6" as="section">
          <ul className="list-none p-0 m-0 divide-y divide-border">
            {weekRows.comparisons.map(row => (
              <ComparisonRow key={row.metricId} label={row.label} cmp={row.cmp} units={units} />
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-border space-y-2">
            <p className="text-xs text-text-secondary">{changeSummary}</p>
            {weekRows.footnote && <DataStateNote>{weekRows.footnote}</DataStateNote>}
            <Link
              href="/trends"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Explore changes <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </Card>
      </section>

      {/* ── E. Your health story ───────────────────── */}
      <section id="health-story" className="scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-[22px] md:text-[24px] font-semibold text-text-primary">
            Your health story
          </h2>
          <SegmentedControl
            options={STORY_RANGE_OPTIONS}
            value={storyDays}
            onChange={setStoryDays}
            ariaLabel="Health story period"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Card className="md:col-span-2 p-5 md:p-6" as="section">
            <h3 className="text-base font-semibold text-text-primary mb-1">
              {story.windowDays}-day summary
            </h3>
            <p className="text-[11px] text-text-secondary mb-3">
              {windowRangeLabel(story.window)}
            </p>
            <p className="text-sm text-text-secondary leading-relaxed mb-4">{story.paragraph}</p>

            <ul className="list-none p-0 m-0 space-y-3 mb-4">
              {storyObservations.map(o => (
                <ObservationItem
                  key={o.metricId}
                  title={o.title}
                  detail={o.detail}
                  evidence={o.evidence}
                  link={`/metric/${o.metricId}`}
                  attention={o.status !== 'Not enough data' && !isWithinWord(o.status)}
                />
              ))}
            </ul>

            {/* Labelled trend figure — metric, window, first → last values */}
            {storyFigure.points.length > 0 && (
              <TrendFigure
                metricId={storyFigure.metricId}
                data={storyFigure.points}
                caption={`${storyFigure.metricName} · ${storyFigure.windowLabel} · ${storyFigure.firstValue} → ${storyFigure.lastValue}${
                  storyFigure.unit ? ` ${storyFigure.unit}` : ''
                }`}
                height={72}
                units={units}
              />
            )}
          </Card>

          <div className="space-y-4">
            {sideInsights.map(insight => (
              <Card key={insight.metricId} className="p-5 flex flex-col" as="article">
                <p className="text-[10px] uppercase tracking-[0.1em] font-medium text-text-secondary mb-2">
                  OBSERVATION
                </p>
                <h4 className="text-sm font-semibold text-text-primary mb-1">{insight.title}</h4>
                <p className="text-xs text-text-secondary mb-2 leading-relaxed">{insight.detail}</p>
                <p className="text-[11px] text-text-secondary mb-1">{insight.windowLabel}</p>
                <p className="text-[11px] text-text-secondary mb-3">{insight.coverage}</p>
                <div className="mt-auto">
                  <Link
                    href={`/metric/${insight.metricId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View evidence
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── F. Ask your health data ────────────────── */}
      <section>
        <Card variant="accent" className="p-6 md:p-8" as="section">
          <div className="flex items-start gap-4">
            <div className="hidden md:block p-2.5 rounded-full bg-primary/10 text-primary">
              <Brain size={24} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl md:text-2xl font-semibold text-text-primary mb-2">
                Make sense of the bigger picture.
              </h2>
              <p className="text-sm text-text-secondary mb-5">
                Ask about your sleep, recovery, activity&hellip;
              </p>

              <div className="space-y-2.5">
                {[
                  'Why was my resting heart rate higher this week?',
                  'How has my sleep changed over the last 3 months?',
                  'Are my workouts associated with better sleep?',
                ].map(q => (
                  <Link
                    key={q}
                    href={`/analyst?q=${encodeURIComponent(q)}`}
                    className="flex items-center gap-2 px-4 py-3 bg-surface border border-border rounded-control text-sm text-text-primary hover:bg-surface-muted transition-colors"
                  >
                    <Sparkles size={14} className="text-primary shrink-0" aria-hidden="true" />
                    <span>{q}</span>
                    <ChevronRight size={14} className="ml-auto text-text-secondary shrink-0" aria-hidden="true" />
                  </Link>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-text-secondary">
                <History size={12} aria-hidden="true" />
                <span>
                  {analystState?.configured
                    ? `Answers come from ${analystState.providerDisplayName}${analystState.model ? ` (${analystState.model})` : ''}, from the same dataset.`
                    : 'Demo analyst responses are computed from your dataset.'}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Screen-reader-only statement of what this page is */}
      <p className="sr-only">
        This page summarizes {USED_BRIEFING_METRICS.length} tracked metrics. {datasetProvenanceSentence()}{' '}
        Comparisons use the last 7 days against the prior 30 days unless a window is stated.
        {dataMeta.live ? ` Newest observation ${dataMeta.dataAsOf.slice(0, 10)}.` : ''}
      </p>
    </div>
  );
}

// ── Signal card ───────────────────────────────────────

function SignalCard({
  metricId, label, latest, yesterday, delta, deltaPct, baseline, baselineWindow, sparkline, counts, units,
}: {
  metricId: string;
  label: string;
  latest?: DayPoint;
  yesterday?: DayPoint;
  delta: number | null;
  deltaPct: number | null;
  baseline: number;
  baselineWindow: DayWindow;
  sparkline: number[];
  counts: { window: number; baseline: number };
  units: 'metric' | 'imperial';
}) {
  const meta = getMetric(metricId);
  const formatted = latest ? formatMetricWithUnit(metricId, latest.value, units) : '—';
  const baselineText = isFinite(baseline) ? formatMetricWithUnit(metricId, baseline, units) : '—';
  const change =
    delta != null
      ? describeChange(metricId, delta, deltaPct, { system: units, comparisonLabel: 'yesterday' })
      : null;

  return (
    <Link href={`/metric/${metricId}`} className="block">
      <Card className="p-5 h-full hover:shadow-sm transition-shadow">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-xs font-medium text-text-secondary">{label}</span>
          {latest?.key === REFERENCE_KEY ? (
            <Badge variant="info" className="text-[10px]">Today</Badge>
          ) : latest ? (
            <span className="text-[10px] text-text-secondary">
              Latest · {formatDayKeyLong(latest.key)}
            </span>
          ) : null}
        </div>

        <div className="text-[32px] md:text-[36px] font-semibold tnum text-text-primary leading-none mb-1">
          {formatted}
        </div>

        <div className="space-y-1 mb-3">
          {change ? (
            <div className="text-xs text-text-secondary">
              <ChangeCue direction={change.direction} value={change.value} percent={change.percent} />
              <span className="ml-1">vs yesterday</span>
            </div>
          ) : (
            <div className="text-xs text-text-secondary">
              No reading yesterday, so no day-over-day comparison is shown.
            </div>
          )}
          <div className="text-xs text-text-secondary tnum">
            {baselineText} · previous 30-day baseline ({windowRangeLabel(baselineWindow)})
          </div>
        </div>

        <div className="h-7">
          <Sparkline data={sparkline} width={160} height={28} />
        </div>
        <span className="sr-only">
          {label}, last 30 days: {counts.window} observations. Baseline window {counts.baseline} observations.
          {meta ? ` Unit ${metricUnit(metricId, units) || 'none'}.` : ''}
        </span>
      </Card>
    </Link>
  );
}

// ── Comparison row ─────────────────────────────────────
//
// Each row carries its own window, so a row that had to drop the in-progress
// day says so where the number is, not only in a footnote.

function ComparisonRow({
  label, cmp, units,
}: {
  label: string;
  cmp: WindowComparison;
  units: 'metric' | 'imperial';
}) {
  const { comparison: c, metricId } = cmp;
  const change = describeChange(metricId, c.delta, c.deltaPercent, { system: units, comparisonLabel: cmp.lengthLabel });
  const percent = c.deltaPercent == null ? null : formatPercent(c.deltaPercent);
  // A duration aggregate (the exercise row) reads in h:mm; the exact minute
  // values stay in the tooltip.
  const isDuration = DURATION_AGGREGATE_METRIC_IDS.has(metricId);
  const exactTitle = isDuration
    ? `${durationAggregateExact(c.current)} vs ${durationAggregateExact(c.baseline)} in the prior window`
    : undefined;

  if (!c.valid) {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
        <span className="text-sm font-medium text-text-primary w-24 shrink-0">{label}</span>
        <span className="text-xs text-text-secondary">
          Not enough data in one of the two windows to compare ({c.currentCount} and {c.baselineCount} observations).
        </span>
      </li>
    );
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" title={exactTitle}>
        <span className="text-sm font-medium text-text-primary w-24 shrink-0">{label}</span>
        <span className="text-sm tnum text-text-primary">{formatDurationAggregate(metricId, c.current, units)}</span>
        <span className="text-[11px] text-text-secondary">
          prior {formatDurationAggregate(metricId, c.baseline, units)}
        </span>
        <span className="flex-1" />
        <span className={`text-xs tnum ${change.tone === 'attention' ? 'text-category-attention' : 'text-text-secondary'}`}>
          <ChangeCue direction={change.direction} value={change.value} percent={percent} />
        </span>
      </div>
      <p className="text-[11px] text-text-secondary tnum mt-0.5">
        {cmp.lengthLabel} · {cmp.rangeLabel} · {cmp.counts.evaluated} vs {cmp.counts.baseline} observations
        {cmp.excludedDays.length > 0 ? ' · today excluded, still in progress' : ''}
        {isDuration
          ? ` · ${durationAggregateExact(c.current)} vs ${durationAggregateExact(c.baseline)} in the prior window`
          : ''}
      </p>
    </li>
  );
}

// ── Observation item ───────────────────────────────────

function ObservationItem({
  title, detail, evidence, link, attention,
}: {
  title: string;
  detail: string;
  evidence: string;
  link: string;
  attention: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
          attention ? 'bg-category-attention' : 'bg-primary'
        }`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <Link href={link} className="text-sm font-medium text-text-primary hover:underline">
          {title}
        </Link>
        <p className="text-xs text-text-secondary mt-0.5">{detail}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 inline-flex items-center gap-1">
          <Info size={11} aria-hidden="true" />
          {evidence}
        </p>
      </div>
    </li>
  );
}
'use client';

import { useMemo, useState } from 'react';
import { Search, X, Info } from 'lucide-react';
import { getAllMetrics, getMetric, searchMetrics } from '@/lib/metrics';
import { describeChange, formatMetricWithUnit, formatPercent } from '@/lib/metrics/format';
import { seriesFor, metricHasData, REFERENCE_KEY, WINDOW_START_KEY } from '@/lib/adapters/dataset';
import {
  addDays,
  compareWindows,
  computeRelationship,
  describeCoefficient,
  formatDayKeyShort,
  previousWindow,
  trailingWindow,
  windowRangeLabel,
  ASSOCIATION_NOTE,
  MIN_PAIRED_OBSERVATIONS,
  type Alignment,
  type DayWindow,
} from '@/lib/analytics';
import {
  Card, Badge, ChangeCue, DataStateNote, SegmentedControl, Tabs, InsufficientDataState,
} from '@/components/ui/primitives';
import { MetricChart, RelationshipScatter } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import { DomainHeader, SectionTitle } from './DomainShared';
import type { MetricDefinition } from '@/lib/metrics/types';

const RANGE_OPTIONS = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '180D' },
];

const DEFAULT_SELECTION = ['resting_heart_rate', 'heart_rate_variability', 'sleep_analysis'];
const MAX_SELECTION = 4;

type ComparisonMode = 'previous' | 'last-year';

export function TrendsPage() {
  const [tab, setTab] = useState('compare');
  return (
    <div className="space-y-8">
      <DomainHeader
        title="Trends"
        subtitle="Compare metrics over the same dates, or look for relationships between two metrics. Every figure comes from the shared dataset."
      />
      <Tabs
        tabs={[
          { id: 'compare', label: 'Compare' },
          { id: 'relationships', label: 'Relationships' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'compare' ? <CompareTab /> : <RelationshipsTab />}
    </div>
  );
}

// ── Compare tab ────────────────────────────────────────

function CompareTab() {
  const { units } = useUnits();
  const [days, setDays] = useState('30');
  const [mode, setMode] = useState<ComparisonMode>('previous');
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTION);

  const window = trailingWindow(REFERENCE_KEY, Number(days));
  const previous = previousWindow(window, Number(days), `Previous ${days} days`);
  const lastYear: DayWindow = {
    startKey: addDays(window.startKey, -365),
    endKey: addDays(window.endKey, -365),
    label: 'Same period last year',
  };
  const lastYearAvailable = lastYear.startKey >= WINDOW_START_KEY;
  const comparator = mode === 'last-year' ? lastYear : previous;
  // Owner request 2: a metric with no observation in this window is neither
  // charted nor listed as a comparison row; the sections disappear with their
  // last entry.
  const plottable = selected.filter(id =>
    seriesFor(id).some(p => p.key >= window.startKey && p.key <= window.endKey)
  );

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Date range</span>
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={days}
              onChange={setDays}
              ariaLabel="Comparison date range"
            />
          </div>
          <span className="text-xs text-text-secondary tnum">
            {windowRangeLabel(window)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-text-secondary">Compare with</span>
          <SegmentedControl
            options={[
              { value: 'previous', label: `Previous ${days} days` },
              { value: 'last-year', label: 'Same period last year' },
            ]}
            value={mode}
            onChange={v => setMode(v as ComparisonMode)}
            ariaLabel="Comparison type"
          />
          {!lastYearAvailable && (
            <span className="text-[11px] text-text-secondary">
              Same period last year is unavailable: the dataset begins{' '}
              {formatDayKeyShort(WINDOW_START_KEY)}, so those dates have no coverage.
            </span>
          )}
        </div>

        <MetricPicker selected={selected} onChange={setSelected} />
      </Card>

      {/* Comparison table — accumulating metrics use complete days on both sides */}
      <ComparisonTable
        metricIds={plottable}
        days={Number(days)}
        mode={mode}
        comparatorAvailable={mode === 'previous' || lastYearAvailable}
      />

      {/* Aligned charts */}
      {plottable.length > 0 && (
        <section>
          <SectionTitle hint={`one x-axis domain: ${windowRangeLabel(window)}`}>
            Aligned charts
          </SectionTitle>
          <Card className="p-4 md:p-6 space-y-6">
            {plottable.map((metricId, i) => (
              <AlignedChart
                key={metricId}
                metricId={metricId}
                window={window}
                units={units}
                showXAxis={i === plottable.length - 1}
              />
            ))}
            <DataStateNote>
              Charts share exactly the same date window and axis domain so their shapes line up. Each
              metric keeps its own unit and y-axis, so the vertical scales are not comparable. A
              selected metric with no observation in this window is not charted.
            </DataStateNote>
          </Card>
        </section>
      )}
    </div>
  );
}

function AlignedChart({
  metricId, window, units, showXAxis,
}: {
  metricId: string;
  window: DayWindow;
  units: 'metric' | 'imperial';
  showXAxis: boolean;
}) {
  const points = seriesFor(metricId).filter(p => p.key >= window.startKey && p.key <= window.endKey);
  const meta = getMetric(metricId);
  // Owner request 2: no observation in the window ⇒ no chart at all.
  if (points.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary mb-1">
        {meta?.displayName ?? metricId} · {points.length} observations
      </p>
      <MetricChart
        metricId={metricId}
        data={points.map(p => ({ date: p.key, value: p.value }))}
        units={units}
        height={showXAxis ? 200 : 150}
        showBrush={showXAxis && points.length > 60}
      />
      {!showXAxis && (
        <p className="text-[10px] text-text-secondary mt-1">
          x-axis labels are shown once, on the final chart
        </p>
      )}
    </div>
  );
}

function ComparisonTable({
  metricIds, days, mode, comparatorAvailable,
}: {
  metricIds: string[];
  days: number;
  mode: ComparisonMode;
  comparatorAvailable: boolean;
}) {
  const { units } = useUnits();
  const rows = metricIds.map(metricId => {
    const meta = getMetric(metricId);
    // The same complete-day rule as every other comparison in the app: an
    // in-progress day is dropped from both sides and the comparison window is
    // shortened to the same number of complete days.
    const cmp = compareWindows(metricId, REFERENCE_KEY, days, {
      meta,
      baseline: (evaluated, n) =>
        mode === 'last-year'
          ? {
              startKey: addDays(evaluated.startKey, -365),
              endKey: addDays(evaluated.endKey, -365),
              label: 'Same period last year',
            }
          : previousWindow(evaluated, n, `Previous ${n} days`),
    });
    return { metricId, label: meta?.displayName ?? metricId, cmp };
  });

  const first = rows[0];
  const hint = first ? `${first.cmp.rangeLabel} · ${first.cmp.lengthLabel}` : '';

  // A "same period last year" comparator that reaches before the dataset begins
  const unavailable = !comparatorAvailable;

  // Owner request 2: no metric with data in this window ⇒ no table, no heading.
  if (rows.length === 0) return null;

  return (
    <section>
      <SectionTitle hint={hint}>Comparison</SectionTitle>
      <Card className="p-4 md:p-6">
        {unavailable ? (
          <InsufficientDataState
            message={`The dataset starts on ${WINDOW_START_KEY}, so the same period last year has no coverage. Switch to "Previous period" to compare.`}
          />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Metric comparison table">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">
                Comparison of selected metrics between {windowRangeLabel(first.cmp.evaluatedWindow)} and{' '}
                {windowRangeLabel(first.cmp.baselineWindow)}
              </caption>
              <thead>
                <tr className="border-b border-border text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                  <th scope="col" className="py-2 pr-4 font-medium">This period</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Comparator</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Change</th>
                  <th scope="col" className="py-2 font-medium">Observations</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const c = r.cmp.comparison;
                  const change = describeChange(r.metricId, c.delta, c.deltaPercent, {
                    system: units,
                    comparisonLabel: r.cmp.lengthLabel,
                  });
                  return (
                    <tr key={r.metricId} className="border-b border-border/50">
                      <td className="py-2.5 pr-4 text-text-primary">{r.label}</td>
                      <td className="py-2.5 pr-4 tnum text-text-primary">
                        {c.valid ? formatMetricWithUnit(r.metricId, c.current, units) : 'Not enough data'}
                      </td>
                      <td className="py-2.5 pr-4 tnum text-text-primary">
                        {c.valid ? formatMetricWithUnit(r.metricId, c.baseline, units) : 'Not enough data'}
                      </td>
                      <td className="py-2.5 pr-4 text-xs">
                        {c.valid ? (
                          <ChangeCue
                            direction={change.direction}
                            value={change.value}
                            percent={
                              c.deltaPercent == null
                                ? null
                                : formatPercent(c.deltaPercent)
                            }
                          />
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-[11px] text-text-secondary tnum">
                        {r.cmp.counts.evaluated} vs {r.cmp.counts.baseline}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 space-y-1">
          <DataStateNote>
            Baseline windows exclude the period being evaluated, missing days are left missing, and
            the current day is excluded from any total that is still accumulating — accumulating
            metrics are compared over the same number of complete days on both sides. Change is
            reported as a difference and a percentage; no judgement about direction is implied.
          </DataStateNote>
          {first?.cmp.exclusionNote && <DataStateNote tone="attention">{first.cmp.exclusionNote}</DataStateNote>}
        </div>
      </Card>
    </section>
  );
}

// ── Relationships tab ─────────────────────────────────

function RelationshipsTab() {
  const { units } = useUnits();
  const [xId, setXId] = useState('sleep_analysis');
  const [yId, setYId] = useState('heart_rate_variability');
  const [days, setDays] = useState('30');
  const [alignment, setAlignment] = useState<Alignment>('same-day');
  const [lagDays, setLagDays] = useState('1');

  const window = trailingWindow(REFERENCE_KEY, Number(days));
  const result = computeRelationship(xId, yId, window, alignment, Number(lagDays));
  const xMeta = getMetric(xId);
  const yMeta = getMetric(yId);
  const sameMetric = xId === yId;

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricSelect label="Metric X" value={xId} onChange={setXId} />
          <MetricSelect label="Metric Y" value={yId} onChange={setYId} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Date range</span>
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={days}
              onChange={setDays}
              ariaLabel="Relationship date range"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Alignment</span>
            <SegmentedControl
              options={[
                { value: 'same-day', label: 'Same day' },
                { value: 'lagged', label: 'Lagged' },
              ]}
              value={alignment}
              onChange={v => setAlignment(v as Alignment)}
              ariaLabel="Alignment"
            />
          </div>
          {alignment === 'lagged' && (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              X leads Y by
              <select
                value={lagDays}
                onChange={e => setLagDays(e.target.value)}
                aria-label="Lag in days"
                className="bg-surface border border-border rounded-control px-2 py-1.5 text-xs text-text-primary min-h-[36px]"
              >
                {['1', '2', '3'].map(d => (
                  <option key={d} value={d}>{d} day{d === '1' ? '' : 's'}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="text-[11px] text-text-secondary">
          {alignment === 'same-day'
            ? 'Same-day alignment pairs a reading of X with a reading of Y on the same calendar date.'
            : `Lagged alignment pairs a reading of X on one date with a reading of Y ${lagDays} day${lagDays === '1' ? '' : 's'} later, which is the usual shape for a night-to-next-day question.`}
        </p>
      </Card>

      <Card className="p-4 md:p-6">
        {sameMetric ? (
          <InsufficientDataState message="Choose two different metrics. A metric paired with itself always has a coefficient of 1 and says nothing." />
        ) : !result.valid ? (
          <InsufficientDataState
            message={
              result.insufficientReason ??
              `Not enough paired days in ${windowRangeLabel(window)} to show an association.`
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-secondary">
                  Pearson correlation
                </div>
                <div className="text-3xl font-semibold tnum text-text-primary">
                  {result.coefficient != null ? result.coefficient.toFixed(2) : '—'}
                </div>
              </div>
              <Badge variant="default" className="text-xs">
                {describeCoefficient(result.coefficient)}
              </Badge>
              <div className="text-xs text-text-secondary">
                <div className="tnum">{result.pairedCount} paired days</div>
                <div className="tnum">
                  {result.xCount} {xMeta?.displayName ?? xId} and {result.yCount} {yMeta?.displayName ?? yId} readings in the window
                </div>
              </div>
              <div className="text-xs text-text-secondary ml-auto tnum">
                {windowRangeLabel(window)} ·{' '}
                {alignment === 'same-day' ? 'same-day' : `lagged ${lagDays}d`}
              </div>
            </div>

            <RelationshipScatter
              points={result.points.map(p => ({ key: p.key, x: p.x, y: p.y }))}
              xMetricId={xId}
              yMetricId={yId}
              xLabel={xMeta?.displayName ?? xId}
              yLabel={yMeta?.displayName ?? yId}
              units={units}
            />

            <div className="mt-4 space-y-2">
              <div className="flex items-start gap-2 text-[11px] text-text-secondary">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>
                  A coefficient near 1 means the two metrics moved together in this window, near -1
                  means they moved in opposite directions, and near 0 means little linear
                  relationship was visible. It is not a probability and no significance test is
                  performed.
                </p>
              </div>
              <DataStateNote>{ASSOCIATION_NOTE}</DataStateNote>
              {result.pairedCount < MIN_PAIRED_OBSERVATIONS * 2 && (
                <DataStateNote tone="attention">
                  Only {result.pairedCount} paired days are available, which is a small sample for a
                  correlation coefficient.
                </DataStateNote>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ── Selectors ─────────────────────────────────────────

function MetricPicker({
  selected, onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = query.trim() ? searchMetrics(query.trim()).slice(0, 8) : getAllMetrics().slice(0, 8);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else if (selected.length < MAX_SELECTION) {
      onChange([...selected, id]);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-medium text-text-secondary">
          Metrics ({selected.length}/{MAX_SELECTION})
        </span>
        {selected.map(id => (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-accent-tint text-primary"
          >
            {getMetric(id)?.displayName ?? id}
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-label={`Remove ${getMetric(id)?.displayName ?? id}`}
              className="hover:opacity-70"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search metrics by name or alias</span>
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search metrics, e.g. HRV or sleep"
          className="w-full pl-9 pr-3 py-2 bg-surface-muted border border-border rounded-control text-sm text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent min-h-[44px]"
        />
      </label>

      <div className="flex flex-wrap gap-2 mt-2">
        {matches.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => toggle(m.id)}
            aria-pressed={selected.includes(m.id)}
            className={`px-3 py-1.5 text-xs rounded-control border transition-colors min-h-[36px] ${
              selected.includes(m.id)
                ? 'bg-primary text-primary-text border-primary'
                : 'bg-surface text-text-secondary border-border hover:text-text-primary'
            }`}
          >
            {m.displayName}
            {!metricHasData(m.id) && <span className="ml-1 opacity-70">(no data)</span>}
          </button>
        ))}
        {matches.length === 0 && (
          <span className="text-xs text-text-secondary">
            No registered metric matches &ldquo;{query}&rdquo;.
          </span>
        )}
      </div>
    </div>
  );
}

function MetricSelect({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const metrics: MetricDefinition[] = useMemo(() => {
    const q = query.trim();
    return q ? searchMetrics(q).slice(0, 6) : getAllMetrics().slice(0, 6);
  }, [query]);

  return (
    <div>
      <span className="text-xs font-medium text-text-secondary block mb-1">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
        className="w-full bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px]"
      >
        {getAllMetrics().map(m => (
          <option key={m.id} value={m.id}>
            {m.displayName}{metricHasData(m.id) ? '' : ' — no data in dataset'}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Filter ${label.toLowerCase()}…`}
        className="w-full mt-2 px-3 py-1.5 bg-surface-muted border border-border rounded-control text-xs text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-accent min-h-[36px]"
        aria-label={`Filter options for ${label}`}
      />
      <div className="flex flex-wrap gap-1.5 mt-1">
        {metrics.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`px-2 py-1 text-[11px] rounded-control border ${
              value === m.id ? 'bg-primary text-primary-text border-primary' : 'bg-surface text-text-secondary border-border'
            }`}
          >
            {m.displayName}
          </button>
        ))}
        {metrics.length === 0 && (
          <span className="text-[11px] text-text-secondary">No metric matches that filter.</span>
        )}
      </div>
    </div>
  );
}
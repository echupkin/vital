'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Dumbbell, Info, ArrowUpDown } from 'lucide-react';
import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { formatDurationHm, formatMetricWithUnit } from '@/lib/metrics/format';
import {
  filterWorkouts,
  formatDayKeyLong,
  workoutGroupComparison,
  workoutTypes,
  workoutWhenLabel,
  weeklyWorkoutCounts,
  workoutViews,
  MIN_COMPARABLE_WORKOUTS,
  WORKOUT_COMPARISON_RULE,
  type WorkoutSort,
  type WorkoutView,
} from '@/lib/analytics';
import {
  Card, Badge, Button, DataStateNote, Dialog, EmptyState, InsufficientDataState, Select,
} from '@/components/ui/primitives';
import { MetricChart } from '@/components/charts';
import { DomainHeader, SectionTitle } from './DomainShared';
import { useUnits } from '@/components/ui/UnitsProvider';

const RANGE_OPTIONS = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
  { value: '365', label: 'All recorded (365 days)' },
];

const SORT_OPTIONS: { value: WorkoutSort; label: string }[] = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'duration', label: 'Longest duration' },
  { value: 'calories', label: 'Most calories' },
  { value: 'distance', label: 'Longest distance' },
];

export function WorkoutsPage() {
  const { units } = useUnits();
  const [type, setType] = useState('all');
  const [days, setDays] = useState('30');
  const [sort, setSort] = useState<WorkoutSort>('date-desc');
  const [selected, setSelected] = useState<WorkoutView | null>(null);

  const views = useMemo(() => workoutViews(), []);
  const types = useMemo(() => workoutTypes(views), [views]);
  const filtered = useMemo(
    () => filterWorkouts({ type, days: Number(days), sort }, views),
    [type, days, sort, views]
  );
  const weekly = useMemo(() => weeklyWorkoutCounts(views, 12), [views]);
  const maxWeekly = Math.max(1, ...weekly.map(w => w.count));

  // Comparisons exist only for types with enough comparable sessions.
  const comparableTypes = types.filter(
    t => workoutGroupComparison(filtered.views, t.type).comparable
  );

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Workouts"
        subtitle={`Recorded sessions across ${filtered.window.label.toLowerCase()} (${filtered.views.length} shown of ${filtered.inWindowCount} in the window). Only the fields the dataset actually contains are shown.`}
      />

      {/* ── Filters ─────────────────────────────────── */}
      <Card className="p-5 space-y-4" as="section">
        <h2 className="text-sm font-semibold text-text-primary">Filter and sort</h2>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-text-secondary w-20">Activity</span>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={type === 'all'} onClick={() => setType('all')} label={`All (${filtered.inWindowCount})`} />
            {types.map(t => (
              <FilterChip
                key={t.type}
                active={type === t.type}
                onClick={() => setType(t.type)}
                label={`${t.type} (${t.count})`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Date range</span>
            <Select
              value={days}
              onChange={setDays}
              options={RANGE_OPTIONS}
              aria-label="Workout date range"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-text-secondary">Sort</span>
            <Select
              value={sort}
              onChange={v => setSort(v as WorkoutSort)}
              options={SORT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              aria-label="Sort workouts"
            />
          </div>
        </div>
      </Card>

      {/* ── Totals ──────────────────────────────────── */}
      {filtered.totals.sessions > 0 && (
        <section>
          <SectionTitle hint={`${filtered.views.length} sessions in view`}>Recorded totals</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <TotalCard label="Sessions" value={String(filtered.totals.sessions)} sub={`${filtered.window.label.toLowerCase()}`} />
            <TotalCard
              label="Time recorded"
              value={formatDurationHm(filtered.totals.minutes)}
              sub={`${filtered.totals.sessions ? formatDurationHm(filtered.totals.minutesPerSession) : '0:00'} per session`}
              title={`${Math.round(filtered.totals.minutes)} min recorded in total`}
            />
            <TotalCard label="Active calories" value={String(Math.round(filtered.totals.calories))} sub="recorded by the source" />
            <TotalCard
              label="Distance"
              value={
                filtered.totals.distanceSessions === 0
                  ? 'Not recorded'
                  : formatMetricWithUnit('distance_walking_running', filtered.totals.distanceKm, units)
              }
              sub={
                filtered.totals.distanceSessions === 0
                  ? 'no session in view recorded a distance'
                  : `${filtered.totals.distanceSessions} of ${filtered.totals.sessions} sessions recorded a distance`
              }
            />
            <TotalCard
              label="Heart rate"
              value={String(filtered.views.filter(v => v.hasHeartRate).length)}
              sub={`of ${filtered.views.length} sessions recorded heart rate`}
            />
          </div>
          <div className="mt-3">
            <DataStateNote>
              Aggregate workout time is shown in hours:minutes; the exact minute totals are in each
              card&rsquo;s tooltip.
            </DataStateNote>
          </div>
        </section>
      )}

      {/* ── List ────────────────────────────────────── */}
      <section>
        <SectionTitle hint="select a session for its detail view">Workout history</SectionTitle>
        {filtered.views.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              icon={<Dumbbell size={28} aria-hidden="true" />}
              title="No workouts match these filters"
              description={
                filtered.inWindowCount === 0
                  ? `${filtered.window.label} contains no recorded workout. A window with no session means nothing was logged, which is not the same as no activity.`
                  : `${filtered.inWindowCount} sessions are recorded in ${filtered.window.label.toLowerCase()}, but none of type ${type}. Widen the activity filter or the date range.`
              }
              action={<Button variant="secondary" onClick={() => { setType('all'); setDays('180'); }}>Reset filters</Button>}
            />
          </Card>
        ) : (
          <Card className="p-2 md:p-4">
            <ul className="list-none p-0 m-0 divide-y divide-border">
              {filtered.views.map(w => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(w)}
                    className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 py-3 px-2 rounded-control hover:bg-surface-muted transition-colors min-h-[44px]"
                    aria-label={`Open detail for ${w.workout_type} on ${formatDayKeyLong(w.key)}`}
                  >
                    <span className="text-sm font-medium text-text-primary w-24 shrink-0">{w.workout_type}</span>
                    <span className="text-xs text-text-secondary tnum w-32 shrink-0">{formatDayKeyLong(w.key)}</span>
                    <span className="text-xs text-text-primary tnum">{w.duration_minutes} min</span>
                    <span className="text-xs text-text-primary tnum">{w.calories_burned} kcal</span>
                    {w.hasDistance ? (
                      <span className="text-xs text-text-secondary tnum">{w.distance_km!.toFixed(1)} km</span>
                    ) : (
                      <span className="text-[11px] text-text-secondary">no distance</span>
                    )}
                    {w.hasHeartRate ? (
                      <span className="text-xs text-text-secondary tnum">{w.avg_heart_rate} bpm avg</span>
                    ) : (
                      <span className="text-[11px] text-text-secondary">no heart rate</span>
                    )}
                    <span className="flex-1" />
                    <span className="text-[11px] text-text-secondary">{w.source}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 px-2">
              <DataStateNote>
                {filtered.views.length} of {filtered.inWindowCount} sessions in the window are listed. A session missing a
                distance or heart rate is shown as &ldquo;not recorded&rdquo; rather than filled in.
              </DataStateNote>
            </div>
          </Card>
        )}
      </section>

      {/* ── Comparison ──────────────────────────────── */}
      <section>
        <SectionTitle hint="only when enough comparable records exist">Compare similar workouts</SectionTitle>
        <Card className="p-4 md:p-6 space-y-4">
          <p className="text-xs text-text-secondary leading-relaxed">
            <Info size={12} className="inline mr-1" aria-hidden="true" />
            {WORKOUT_COMPARISON_RULE}
          </p>

          {comparableTypes.length === 0 ? (
            <InsufficientDataState
              message={`No activity type in ${filtered.window.label.toLowerCase()} has ${MIN_COMPARABLE_WORKOUTS} or more comparable sessions, so no average is shown. Averages over one or two sessions would describe those sessions rather than the activity.`}
            />
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Workout comparison table">
              <table className="w-full text-sm text-left">
                <caption className="sr-only">
                  Recorded averages by activity type over {filtered.window.label}
                </caption>
                <thead>
                  <tr className="border-b border-border text-xs text-text-secondary">
                    <th scope="col" className="py-2 pr-4 font-medium">Activity</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Sessions</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Duration (avg)</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Distance (avg)</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Avg HR</th>
                    <th scope="col" className="py-2 font-medium">Calories (avg)</th>
                  </tr>
                </thead>
                <tbody>
                  {comparableTypes.map(t => {
                    const c = workoutGroupComparison(filtered.views, t.type);
                    return (
                      <tr key={t.type} className="border-b border-border/50">
                        <td className="py-2.5 pr-4 text-text-primary">{t.type}</td>
                        <td className="py-2.5 pr-4 tnum text-text-primary">
                          {c.comparedSessions} compared
                          {c.distance ? ` · ${c.distance.count} with distance` : ''}
                          {c.avgHeartRate ? ` · ${c.avgHeartRate.count} with heart rate` : ''}
                        </td>
                        <td className="py-2.5 pr-4 tnum text-text-primary">
                          {c.comparable
                            ? `${formatDurationHm(c.duration.average)} (${formatDurationHm(c.duration.min)}–${formatDurationHm(c.duration.max)})`
                            : 'Not enough records'}
                        </td>
                        <td className="py-2.5 pr-4 tnum text-text-primary">
                          {c.distance && c.distance.comparable
                            ? `${c.distance.average.toFixed(1)} km (${c.distance.min.toFixed(1)}–${c.distance.max.toFixed(1)})`
                            : 'Not enough records'}
                        </td>
                        <td className="py-2.5 pr-4 tnum text-text-primary">
                          {c.avgHeartRate && c.avgHeartRate.comparable
                            ? `${c.avgHeartRate.average.toFixed(0)} bpm`
                            : 'Not enough records'}
                        </td>
                        <td className="py-2.5 tnum text-text-primary">
                          {c.calories.comparable ? c.calories.average.toFixed(0) : 'Not enough records'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DataStateNote>
            These are averages of the sessions recorded in {filtered.window.label.toLowerCase()}. They describe the
            recorded sessions, not your capability, and no route, map or pace is shown because the dataset contains none.
          </DataStateNote>
        </Card>
      </section>

      {/* ── Frequency ───────────────────────────────── */}
      {views.length > 0 && (
        <section>
          <SectionTitle hint="7-day blocks ending on the reference day">Workout frequency</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <p className="text-sm text-text-primary mb-3">Recorded sessions per week</p>
              <ul className="list-none p-0 m-0 space-y-2">
                {weekly.map(w => (
                  <li key={w.startKey} className="flex items-center gap-3">
                    <span className="text-[11px] text-text-secondary w-24 shrink-0 tnum">
                      {formatDayKeyLong(w.startKey)}
                    </span>
                    <span className="flex-1 h-2 bg-surface-muted rounded-full overflow-hidden">
                      <span
                        className="block h-full bg-category-activity rounded-full"
                        style={{ width: `${(w.count / maxWeekly) * 100}%` }}
                      />
                    </span>
                    <span className="text-xs text-text-primary tnum w-6 text-right">{w.count}</span>
                    <span
                      className="text-[11px] text-text-secondary tnum w-20 text-right"
                      title={w.count === 0 ? undefined : `${w.minutes} min recorded`}
                    >
                      {w.count === 0 ? '—' : formatDurationHm(w.minutes)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <DataStateNote>
                  Weekly duration is hours:minutes (the exact minutes are in each row&rsquo;s tooltip). A blank
                  week means nothing was logged, which is not the same as no activity. Weeks are 7-day blocks
                  ending {formatDayKeyLong(REFERENCE_KEY)}.
                </DataStateNote>
              </div>
            </Card>

            <Card className="p-5">
              <p className="text-sm text-text-primary mb-3">Session duration over the last 90 days</p>
              <MetricChart
                metricId="apple_exercise_time"
                data={filtered.views
                  .filter(w => w.key >= filtered.window.startKey)
                  .slice(-60)
                  .map(w => ({ date: w.key, value: w.duration_minutes }))}
                units={units}
                height={220}
              />
              <div className="mt-3">
                <DataStateNote>
                  Session duration in minutes, taken from the recorded workout records — the exercise-minutes metric is a
                  different series and is shown on the Activity page.
                </DataStateNote>
              </div>
            </Card>
          </div>
        </section>
      )}

      <Card className="p-5">
        <div className="flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="text-xs text-text-secondary leading-relaxed space-y-1">
            <p>
              <span className="text-text-primary font-medium">What is not here.</span> The dataset contains no GPS
              traces, routes, maps, elevation, cadence or heart-rate series within a session, so none is drawn or
              invented. Heart rate is a per-session average and maximum only, and {views.length - views.filter(v => v.hasHeartRate).length} of {views.length} recorded sessions have no heart rate at all.
            </p>
            <Link href="/activity" className="inline-flex items-center gap-1 text-primary hover:underline min-h-[24px]">
              See workout frequency alongside daily activity <ArrowUpDown size={12} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </Card>

      {/* ── Detail dialog ───────────────────────────── */}
      <Dialog open={selected !== null} onClose={() => setSelected(null)} title={selected ? `${selected.workout_type} detail` : 'Workout detail'}>
        {selected && <WorkoutDetail view={selected} units={units} allViews={views} />}
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-2 text-xs rounded-control border transition-colors min-h-[44px] ${
        active
          ? 'bg-primary text-primary-text border-primary'
          : 'bg-surface text-text-secondary border-border hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

function TotalCard({ label, value, sub, title }: { label: string; value: string; sub: string; title?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">{label}</div>
      <div className="text-xl md:text-2xl font-semibold tnum text-text-primary leading-none mb-1" title={title}>
        {value}
      </div>
      <div className="text-[10px] text-text-secondary">{sub}</div>
    </Card>
  );
}

function WorkoutDetail({
  view, units, allViews,
}: {
  view: WorkoutView;
  units: 'metric' | 'imperial';
  allViews: WorkoutView[];
}) {
  const comparison = workoutGroupComparison(allViews, view.workout_type, view.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default" className="text-[10px]">{view.source}</Badge>
        <span className="text-xs text-text-secondary">{workoutWhenLabel(view)}</span>
      </div>

      <dl className="text-sm space-y-1.5">
        <DetailRow label="Duration" value={`${view.duration_minutes} min`} />
        <DetailRow
          label="Distance"
          value={view.hasDistance ? `${view.distance_km!.toFixed(2)} km` : 'Not recorded for this session'}
        />
        <DetailRow label="Average heart rate" value={view.hasHeartRate ? `${view.avg_heart_rate} bpm` : 'Not recorded for this session'} />
        <DetailRow label="Maximum heart rate" value={view.hasHeartRate ? `${view.max_heart_rate} bpm` : 'Not recorded for this session'} />
        <DetailRow label="Active calories" value={`${view.calories_burned} kcal`} />
        <DetailRow label="Source" value={view.source} />
        <DetailRow label="Record id" value={view.id} />
      </dl>

      <div className="pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-text-primary mb-1">How this session compares</h3>
        {!comparison.comparable ? (
          <DataStateNote>{comparison.unavailableReason}</DataStateNote>
        ) : (
          <ul className="list-none p-0 m-0 text-xs text-text-secondary space-y-1 tnum">
            <li>
              Duration: {view.duration_minutes} min against an average of {formatDurationHm(comparison.duration.average)} over{' '}
              {comparison.comparedSessions} other {view.workout_type.toLowerCase()} sessions ({formatDurationHm(comparison.duration.min)}–
              {formatDurationHm(comparison.duration.max)}).
            </li>
            {view.hasDistance && comparison.distance?.comparable && (
              <li>
                Distance: {view.distance_km!.toFixed(1)} km against an average of {comparison.distance.average.toFixed(1)} km
                over {comparison.distance.count} sessions that recorded a distance.
              </li>
            )}
            {view.hasHeartRate && comparison.avgHeartRate?.comparable && comparison.maxHeartRate?.comparable && (
              <li>
                Heart rate: {view.avg_heart_rate} bpm average and {view.max_heart_rate} bpm maximum, against averages of{' '}
                {comparison.avgHeartRate.average.toFixed(0)} and {comparison.maxHeartRate.average.toFixed(0)} bpm over{' '}
                {comparison.avgHeartRate.count} sessions that recorded it.
              </li>
            )}
            <li>Calories: {view.calories_burned} kcal against an average of {comparison.calories.average.toFixed(0)} kcal.</li>
          </ul>
        )}
        <div className="mt-2">
          <DataStateNote>{comparison.rule}</DataStateNote>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <DataStateNote>
          One session is a single observation. Nothing here compares it against a target, a training plan or another
          person, and no route or map is shown because the dataset contains none.
        </DataStateNote>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="tnum text-text-primary text-right">{value}</dd>
    </div>
  );
}

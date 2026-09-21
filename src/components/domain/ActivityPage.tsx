'use client';

import Link from 'next/link';
import {
  REFERENCE_KEY,
  seriesFor,
  type DayPoint,
} from '@/lib/adapters/dataset';
import {
  addDays,
  buildSeriesSummary,
  formatDayKeyLong,
  formatDayKeyShort,
  trailingWindow,
  windowRangeLabel,
  workoutDayKey,
  workoutViews,
  type WorkoutView,
} from '@/lib/analytics';
import { formatDurationHm } from '@/lib/metrics/format';
import { Card, DataStateNote } from '@/components/ui/primitives';
import { MetricChart } from '@/components/charts';
import { useUnits } from '@/components/ui/UnitsProvider';
import {
  DomainHeader, SectionTitle, SeriesCard, MetricGrid, CoverageNote, metricsForCategories,
} from './DomainShared';

const DAYS = 30;
const HISTORY_DAYS = 90;
const HEADLINE = ['step_count', 'apple_exercise_time', 'distance_walking_running', 'active_energy', 'apple_stand_hours'];

export function ActivityPage() {
  const { units } = useUnits();
  // Owner request 2: only signals with an observation in the window are rendered.
  const summaries = HEADLINE
    .map(id => buildSeriesSummary(id, REFERENCE_KEY, DAYS, units))
    .filter(s => s.points.length > 0);

  const historyWindow = trailingWindow(REFERENCE_KEY, HISTORY_DAYS);
  const history = seriesFor('step_count').filter(p => p.key >= historyWindow.startKey && p.key <= historyWindow.endKey);
  const todayPoint: DayPoint | undefined = history.find(p => p.key === REFERENCE_KEY);
  const todayPartial = todayPoint?.partial === true;

  const workouts = workoutViews();
  const last30 = trailingWindow(REFERENCE_KEY, 30);
  const recentWorkouts = workouts
    .filter(w => {
      const key = workoutDayKey(w);
      return key >= last30.startKey && key <= last30.endKey;
    })
    .slice(-8)
    .reverse();

  const workouts30 = workouts.filter(w => {
    const key = workoutDayKey(w);
    return key >= last30.startKey && key <= last30.endKey;
  });
  const weeklyFrequency = weeklyWorkoutCounts(workouts, 8);

  const maxWeekly = Math.max(1, ...weeklyFrequency.map(w => w.count));

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Activity"
        subtitle={`Movement, exercise and energy across the last ${DAYS} days ending ${formatDayKeyLong(REFERENCE_KEY)}. Today is still in progress, so it is never compared with a complete day.`}
      />

      {/* ── Headline activity signals ──────────────── */}
      {summaries.length > 0 && (
        <section>
          <SectionTitle hint={`${windowRangeLabel(summaries[0].window)} vs ${windowRangeLabel(summaries[0].baselineWindow)}`}>
            Movement and energy
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {summaries.map(s => (
              <SeriesCard key={s.metricId} summary={s} days={DAYS} />
            ))}
          </div>
          {summaries.some(s => s.excludedDays.length > 0) && (
            <div className="mt-4">
              <DataStateNote>
                Today is excluded from the step and exercise totals above because the day is not
                complete. Comparing a partial day with a complete one would overstate the change.
              </DataStateNote>
            </div>
          )}
        </section>
      )}

      {/* ── Activity history ───────────────────────── */}
      {history.length > 0 && (
        <section>
          <SectionTitle hint={`${windowRangeLabel(historyWindow)} · ${history.length} recorded days`}>
            Activity history
          </SectionTitle>
          <Card className="p-4 md:p-6">
            <MetricChart
              metricId="step_count"
              data={history.map(p => ({ date: p.key, value: p.value }))}
              units={units}
              height={280}
              showBrush={history.length > 60}
            />
            <div className="mt-3 space-y-1">
              <DataStateNote>
                Bars are complete-day step totals. Missing days have no bar rather than a zero bar.
              </DataStateNote>
              {todayPartial && (
                <DataStateNote tone="attention">
                  Today ({todayPoint ? formatDayKeyLong(todayPoint.key) : 'the reference day'}) has only part of its
                  hours recorded, so its bar is shorter
                  than a full day and is not comparable with the bars around it.
                </DataStateNote>
              )}
            </div>
          </Card>
        </section>
      )}

      {/* ── Workout frequency ──────────────────────── */}
      {workouts30.length > 0 && (
        <section>
          <SectionTitle hint={`${workouts30.length} workouts in the last ${DAYS} days`}>
            Workout frequency
          </SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <p className="text-sm text-text-primary mb-3">Workouts recorded per week</p>
              <ul className="list-none p-0 m-0 space-y-2">
                {weeklyFrequency.map(w => (
                  <li key={w.startKey} className="flex items-center gap-3">
                    <span className="text-[11px] text-text-secondary w-20 shrink-0 tnum">
                      {formatDayKeyShort(w.startKey)}
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
                  Week duration is hours:minutes (the exact minutes are in each row&rsquo;s tooltip). Weeks
                  with no recorded workout show an empty bar. A blank week means nothing was logged,
                  which is not the same as no activity.
                </DataStateNote>
              </div>
            </Card>

            <Card className="p-5">
              <p className="text-sm text-text-primary mb-3">Recent workouts</p>
              <ul className="list-none p-0 m-0 divide-y divide-border">
                {recentWorkouts.map(w => (
                  <li key={w.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-text-primary font-medium w-24 shrink-0">{w.workout_type}</span>
                    <span className="text-text-secondary tnum">{formatDayKeyLong(workoutDayKey(w))}</span>
                    <span className="text-text-primary tnum">{w.duration_minutes} min</span>
                    <span className="text-text-primary tnum">{w.calories_burned} kcal</span>
                    {w.distance_km != null && (
                      <span className="text-text-secondary tnum">{w.distance_km.toFixed(1)} km</span>
                    )}
                    {w.avg_heart_rate != null && (
                      <span className="text-text-secondary tnum">{w.avg_heart_rate} bpm avg</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Link href="/workouts" className="text-sm text-primary hover:underline">
                  All workouts
                </Link>
              </div>
            </Card>
          </div>
        </section>
      )}

      {/* ── Registry-derived extras ────────────────── */}
      <MetricGrid
        metrics={metricsForCategories(['activity'], HEADLINE)}
        title="Other activity metrics"
        hint="Shown only when the dataset contains the metric"
        days={DAYS}
      />

      <CoverageNote metricIds={HEADLINE} />
    </div>
  );
}

interface WeeklyCount {
  startKey: string;
  count: number;
  minutes: number;
}

/** Counts workouts per 7-day block ending on the reference date.
 *  A workout's calendar day comes from the dataset timezone, not from slicing
 *  the UTC timestamp. */
function weeklyWorkoutCounts(workouts: WorkoutView[], weeks: number): WeeklyCount[] {
  const out: WeeklyCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const endKey = addDays(REFERENCE_KEY, -i * 7);
    const startKey = addDays(endKey, -6);
    const inWeek = workouts.filter(w => {
      const key = workoutDayKey(w);
      return key >= startKey && key <= endKey;
    });
    out.push({
      startKey,
      count: inWeek.length,
      minutes: inWeek.reduce((a, w) => a + w.duration_minutes, 0),
    });
  }
  return out;
}
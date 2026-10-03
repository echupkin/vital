'use client';

// ── /workouts (SPEC §7) ─────────────────────────────────
//
// The dashboard for the current routine and its progress areas, with a short
// summary of recent recorded sessions. The full history, filters, comparisons
// and frequency live on /workouts/all.

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { formatDurationHm } from '@/lib/metrics/format';
import { filterWorkouts, formatDayKeyLong, workoutViews } from '@/lib/analytics';
import { Card, DataStateNote } from '@/components/ui/primitives';
import { DomainHeader, SectionTitle, TotalCard } from './DomainShared';
import { RoutineSection } from '@/components/routine/RoutineSection';

const SUMMARY_DAYS = 30;

export function WorkoutsPage() {
  return (
    <div className="space-y-8">
      <DomainHeader
        title="Workouts"
        subtitle="Your current routine and how each progression is going, with a short summary of recently recorded sessions."
      />

      <RoutineSection />

      <WorkoutsSummary />
    </div>
  );
}

function WorkoutsSummary() {
  const recent = useMemo(
    () => filterWorkouts({ type: 'all', days: SUMMARY_DAYS, sort: 'date-desc' }, workoutViews()),
    []
  );
  const { totals, views, window } = recent;
  const last = views[0];

  return (
    <section aria-labelledby="recent-workouts-title">
      <SectionTitle hint={window.label.toLowerCase()}>
        <span id="recent-workouts-title">Recent workouts</span>
      </SectionTitle>
      {totals.sessions > 0 ? (
        <Card className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <TotalCard label="Sessions" value={String(totals.sessions)} sub={window.label.toLowerCase()} />
          <TotalCard
            label="Time recorded"
            value={formatDurationHm(totals.minutes)}
            sub={`${formatDurationHm(totals.minutesPerSession)} per session`}
            title={`${Math.round(totals.minutes)} min recorded in total`}
          />
          <TotalCard label="Last session" value={last.workout_type} sub={formatDayKeyLong(last.key)} />
        </Card>
      ) : (
        <Card className="p-4">
          <DataStateNote>
            No workout was recorded in the {window.label.toLowerCase()}. A window with no session means nothing was
            logged, which is not the same as no activity.
          </DataStateNote>
        </Card>
      )}
      <div className="mt-3">
        <Link href="/workouts/all" className="inline-flex items-center gap-1 text-sm text-primary hover:underline min-h-[24px]">
          View all workouts <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

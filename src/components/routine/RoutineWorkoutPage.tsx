'use client';

// ── /workouts/routine/workouts/[templateId] ─────────────
//
// One session template ("Workout A: Upper body", "Long run") as a day of
// training: the domains it covers, where each slot's path stands and its light,
// and — once a path is at yellow-green or green — the next step or stage on it.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, ChevronRight, PauseCircle } from 'lucide-react';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { WorkoutSlotView, WorkoutView } from '@/lib/routine/workout-view';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { Badge, Card, ErrorState } from '@/components/ui/primitives';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { useUnits } from '@/components/ui/UnitsProvider';
import { PageHero } from '@/components/art/PageHero';
import { HeroStat } from '@/components/art/HeroStat';
import { SectionTitle } from '@/components/domain/DomainShared';
import { ExerciseDataNotice, LightLabel, MICRO_LABEL, ReadinessBar, RoutinePageSkeleton, pathHref, useRoutineFetch } from './shared';
import { workoutSuggestions } from './discuss-suggestions';
import { useBreadcrumbLabel } from '@/components/shell/Breadcrumbs';
import { formatDayKeyShort } from '@/lib/analytics/windows';

interface WorkoutDetailResponse {
  routine: RoutineOverview;
  workout: WorkoutView;
  sources: WorkoutSourceStatus[];
  origin: 'live' | 'demo';
}

export function RoutineWorkoutPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<WorkoutDetailResponse>(`/api/routine/workouts/${encodeURIComponent(templateId)}`, units);
  useBreadcrumbLabel(state.status === 'ok' ? state.data.workout.name : undefined);

  if (state.status === 'loading') return <RoutinePageSkeleton label="Loading the workout" />;
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <ErrorState title="This workout could not be loaded" message={state.message} onRetry={reload} />
      </div>
    );
  }
  const { workout, routine } = state.data;
  const slots = workout.domains.flatMap(d => d.slots);
  const ready = slots.filter(s => s.suggestion?.status === 'ready').length;
  const nearly = slots.filter(s => s.suggestion?.status === 'nearly').length;
  const untracked = slots.some(s => !s.tracked);

  return (
    <div className="space-y-8">
      <PageHero
        title={workout.name}
        eyebrow={routine.title}
        category="activity"
        subtitle={
          workout.lastDone
            ? `Last done ${formatDayKeyShort(workout.lastDone)} · ${workout.timesDone} time${workout.timesDone === 1 ? '' : 's'} since the plan began`
            : untracked
              ? 'Sessions of this workout can’t be seen without a workout source'
              : 'Not logged yet in this plan'
        }
        aside={
          slots.length > 0 ? (
            <HeroStat
              label="Ready to progress"
              value={
                <>
                  {ready}
                  <span className="text-base font-normal text-text-secondary"> of {slots.length}</span>
                </>
              }
              sub={nearly > 0 ? `${nearly} nearly there` : undefined}
            />
          ) : undefined
        }
      >
        {workout.when && <Badge variant="accent">{workout.when}</Badge>}
        {workout.minutes ? <Badge>~{workout.minutes} min</Badge> : null}
        <Badge>
          {workout.domains.length} domain{workout.domains.length === 1 ? '' : 's'}
        </Badge>
        {ready > 0 && <Badge variant="success">{ready} ready to progress</Badge>}
        {nearly > 0 && <Badge variant="info">{nearly} nearly there</Badge>}
        <DiscussButton
          context={{ kind: 'routine-workout', templateId: workout.id }}
          subject={workout.name}
          suggestions={workoutSuggestions(workout)}
          onPlanChange={reload}
        />
      </PageHero>

      {untracked && <ExerciseDataNotice routine={routine} />}

      {workout.warmup.length > 0 && (
        <section aria-label="Warm-up">
          <h2 className={`${MICRO_LABEL} mb-2`}>Warm-up</h2>
          <ul className="flex flex-wrap gap-1.5">
            {workout.warmup.map(w => (
              <li key={w}>
                <Badge>{w}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="slots-title">
        <SectionTitle hint="each slot opens its path">
          <span id="slots-title">What to train</span>
        </SectionTitle>
        {workout.domains.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-text-secondary">This workout has no slots that point at a path in the plan. Ask the analyst to fill it in.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {workout.domains.map(d => (
              <Card key={d.areaId} className="relative overflow-hidden p-5 md:p-6" as="section" aria-label={d.areaName}>
                <span className="absolute inset-x-0 top-0 h-[3px] bg-category-activity" aria-hidden="true" />
                <h3 className="text-[15px] font-semibold text-text-primary mb-4">{d.areaName}</h3>
                <ul className="space-y-4">
                  {d.slots.map(s => (
                    <SlotRow key={s.pathId} slot={s} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SlotRow({ slot }: { slot: WorkoutSlotView }) {
  return (
    <li className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <Link href={pathHref(slot.pathId)} className="group flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-text-secondary">
            {slot.pathName}
            {slot.optional ? ' · optional' : ''}
          </p>
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary group-hover:underline underline-offset-2">
            {slot.stageName}
            {slot.stepName ? <span className="font-normal text-text-secondary"> · {slot.stepName}</span> : null}
          </p>
          {slot.dose && <p className="text-xs text-text-secondary mt-0.5 tnum">{slot.dose}</p>}
        </div>
        <ChevronRight size={16} className="text-text-secondary shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <LightLabel light={slot.light} tracked={slot.tracked} />
        {slot.onHold && (
          <Badge variant="warning">
            <PauseCircle size={11} className="mr-1" aria-hidden="true" />
            On hold
          </Badge>
        )}
      </div>

      {slot.readiness && <ReadinessBar readiness={slot.readiness} from={slot.stepName ?? slot.stageName} to={slot.nextName} className="mt-3" />}

      {slot.suggestion && (
        <p
          className={`mt-3 rounded-control px-3 py-2 text-xs flex items-start gap-1.5 ${
            slot.suggestion.status === 'ready' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-surface-muted text-text-primary'
          }`}
        >
          <ArrowRight size={13} className="shrink-0 mt-px" aria-hidden="true" />
          <span>{slot.suggestion.text}</span>
        </p>
      )}
      {slot.topOfPath && (
        <p className="mt-3 rounded-control px-3 py-2 text-xs bg-surface-muted text-text-primary">
          Top of this path: hold here, or ask the analyst to add the next stage.
        </p>
      )}

      <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
        {slot.lastSession && (
          <p>
            Last: <span className="text-text-primary">{slot.lastSession.work}</span> ({formatDayKeyShort(slot.lastSession.date)})
          </p>
        )}
        {slot.rotatesWith.length > 0 && <p>Rotates with {slot.rotatesWith.join(', ')}.</p>}
        {slot.note && <p>{slot.note}</p>}
        {slot.cues.length > 0 && <p>Cues: {slot.cues.slice(0, 3).join(' · ')}</p>}
      </div>
    </li>
  );
}

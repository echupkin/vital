'use client';

// ── Routine section (top of /workouts) ──────────────────
//
// The active training plan at a glance: where the reader is in it, what session
// is next, each progression path's light and how close it is to its next stage,
// and whether recovery supports pushing. Every card opens the path's detail page.
//
// Works for any discipline and any schedule shape; nothing here assumes
// calisthenics, a lifting split or an A/B/rest cadence.

import Link from 'next/link';
import { useState } from 'react';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import { Archive, CalendarDays, CalendarRange, ChevronRight, PauseCircle, Sparkles } from 'lucide-react';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { ScheduledDayView } from '@/lib/routine/schedule';
import { Badge, Button, Card, DataStateNote, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { SectionTitle } from '@/components/domain/DomainShared';
import { CATEGORY_VAR } from '@/components/art/categories';
import {
  BadgeLink,
  BlockChips,
  DeloadChip,
  ExerciseDataNotice,
  LightLabel,
  MICRO_LABEL,
  PlanChangeCard,
  PlanWeek,
  ReadinessBar,
  RecoveryChip,
  pathHref,
  planHref,
  useRoutineFetch,
  workoutHref,
  type RoutineApiResponse,
} from './shared';
import type { PlanChange } from '@/lib/routine/types';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { CREATE_PROMPT, routineSuggestions, untrackedSuggestions } from './discuss-suggestions';

const ACTIVITY = CATEGORY_VAR.activity;

export function analystHref(question: string): string {
  return `/analyst?q=${encodeURIComponent(question)}`;
}

export function RoutineSection() {
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<RoutineApiResponse>('/api/routine', units);
  const [change, setChange] = useState<PlanChange | null>(null);
  // A change made here or in the analyst dialog (null: the dialog's change was undone).
  const planChanged = (c: PlanChange | null) => {
    setChange(c);
    reload();
  };

  return (
    <section id="routine" aria-labelledby="routine-title">
      <SectionTitle hint="Your training plan, judged against your logged sessions">
        <span id="routine-title">Routine</span>
      </SectionTitle>

      {state.status === 'loading' && (
        <Card className="p-5 space-y-3" aria-label="Loading the routine">
          <Skeleton height={18} width="40%" />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </Card>
      )}
      {state.status === 'error' && <ErrorState title="The routine could not be loaded" message={state.message} onRetry={reload} />}
      {state.status === 'ok' && (
        <>
          {change && (
            <div className="mb-4">
              <PlanChangeCard change={change} onUndone={() => { setChange(null); reload(); }} />
            </div>
          )}
          {state.data.routine ? (
            <RoutineBody data={state.data} routine={state.data.routine} onChange={planChanged} />
          ) : (
            <NoPlan data={state.data} onCreated={planChanged} />
          )}
        </>
      )}
    </section>
  );
}

/** Where training sessions come from. `noticeShown`: ExerciseDataNotice already explains a missing source. */
function SourceNote({ data, noticeShown = false }: { data: RoutineApiResponse; noticeShown?: boolean }) {
  const configured = data.sources.filter(s => s.configured || s.origin === 'demo');
  if (data.origin === 'demo') {
    return <DataStateNote>Demo mode: sessions come from committed demo training data shaped like a Hevy export.</DataStateNote>;
  }
  if (configured.length === 0) {
    if (noticeShown) return null;
    return (
      <DataStateNote tone="attention">
        No workout source is connected, so sets, reps, load and effort are unknown. Recorded workouts still count for
        plans matched by workout type (e.g. running). Connect Hevy with <code>HEVY_API_KEY</code> — see Settings → Connections.
      </DataStateNote>
    );
  }
  const failing = configured.filter(s => s.lastError);
  if (failing.length) {
    return <DataStateNote tone="attention">{failing.map(s => `${s.displayName}: ${s.lastError}`).join(' ')}</DataStateNote>;
  }
  return null;
}

function NoPlan({ data, onCreated }: { data: RoutineApiResponse; onCreated: (c: PlanChange | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-5 space-y-4">
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No training plan yet"
        description="Describe your goal to the analyst — any discipline, any schedule — and it will build a multi-month plan, then track each progression here against your logged sessions."
        action={
          <DiscussButton
            label="Create a plan with the analyst"
            variant="primary"
            context={{ kind: 'routine' }}
            subject="a new training plan"
            suggestions={[CREATE_PROMPT, ...data.references.map(r => `Create a ${r.label.toLowerCase()} plan`)].slice(0, 4)}
            onPlanChange={onCreated}
          />
        }
      />
      <div className="border-t border-border pt-4">
        <p className="text-xs text-text-secondary mb-2">
          Or start from an example and adjust it later. Paths are placed on the stage your recent sessions show.
        </p>
        <div className="flex flex-wrap gap-2">
          {data.references.map(ref => (
            <Button
              key={ref.id}
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(ref.id);
                setError(null);
                const res = await fetch('/api/routine', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'start-reference', reference: ref.id }),
                });
                const body = (await res.json().catch(() => ({}))) as { change?: PlanChange; error?: string };
                setBusy(null);
                if (!res.ok || !body.change) setError(body.error ?? `HTTP ${res.status}`);
                else onCreated(body.change);
              }}
            >
              {busy === ref.id ? 'Starting…' : ref.label}
            </Button>
          ))}
        </div>
        {error && <p className="text-xs text-category-attention mt-2">{error}</p>}
      </div>
      <SourceNote data={data} />
    </Card>
  );
}

function RoutineBody({ data, routine, onChange }: { data: RoutineApiResponse; routine: RoutineOverview; onChange: (c: PlanChange | null) => void }) {
  const areas = [...new Set(routine.paths.map(p => p.areaId))].map(id => ({
    id,
    name: routine.paths.find(p => p.areaId === id)!.areaName,
    paths: routine.paths.filter(p => p.areaId === id),
  }));
  return (
    <div className="space-y-4">
      <ExerciseDataNotice routine={routine} />
      <Card className="relative overflow-hidden p-5 md:p-6">
        <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: ACTIVITY }} aria-hidden="true" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[19px] font-semibold tracking-[-0.025em] text-text-primary">
              <Link href={planHref} className="hover:underline underline-offset-2">
                {routine.title}
              </Link>
            </h3>
            <p className="text-sm text-text-secondary mt-1 max-w-2xl">{routine.goal}</p>
            <PlanWeek routine={routine} className="mt-1" />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {routine.currentPhase ? (
                <BadgeLink
                  href={`${planHref}#phases`}
                  variant="accent"
                  title={`${routine.currentPhase.progress.met} of ${routine.currentPhase.progress.total} required milestones reached — worked out from your sessions`}
                >
                  Phase {routine.currentPhase.index + 1} of {routine.currentPhase.count}: {routine.currentPhase.name}
                </BadgeLink>
              ) : routine.phases.length > 0 ? (
                <BadgeLink href={`${planHref}#phases`} variant="success">
                  All phases complete
                </BadgeLink>
              ) : null}
              <BlockChips routine={routine} />
              <RecoveryChip routine={routine} />
              <DeloadChip routine={routine} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={planHref}>
              <Button size="sm">
                <CalendarRange size={14} className="mr-1.5" aria-hidden="true" />
                Plan details
              </Button>
            </Link>
            <DiscussButton
              context={{ kind: 'routine' }}
              subject={`the plan "${routine.title}"`}
              suggestions={routineSuggestions(routine)}
              onPlanChange={onChange}
            />
            <ArchiveButton onChange={onChange} />
          </div>
        </div>
        <NextSession routine={routine} />
      </Card>

      {areas.length > 0 && (
        <section className="space-y-4 pt-2">
          <h3 className="text-[15px] font-semibold text-text-primary">Paths</h3>
          {areas.map(area => (
            <div key={area.id}>
              <h4 className={`${MICRO_LABEL} mb-2`}>{area.name}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {area.paths.map(p => (
                  <PathCard key={p.pathId} path={p} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <UntrackedNote routine={routine} onChange={onChange} />
      <SourceNote data={data} noticeShown={!routine.exerciseData && routine.paths.some(p => !p.tracked)} />
    </div>
  );
}

/** Exercises the reader logs that no stage recognises: they count toward nothing until added. */
function UntrackedNote({ routine, onChange }: { routine: RoutineOverview; onChange: (c: PlanChange | null) => void }) {
  const [all, setAll] = useState(false);
  const list = routine.untracked;
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, 3);
  // Its own heading, level with "Paths", so it doesn't read as part of the last area above it.
  return (
    <section className="space-y-4 pt-2" aria-labelledby="untracked-title">
      <h3 id="untracked-title" className="text-[15px] font-semibold text-text-primary">
        {list.length === 1 ? 'One exercise you log is' : `${list.length} exercises you log are`} not in the plan
      </h3>
      <Card className="p-4">
        <p className="text-xs text-text-secondary">
          No path recognises {list.length === 1 ? 'it' : 'them'}, so {list.length === 1 ? 'it counts' : 'they count'} toward no progress or phase. Last 90 days.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {shown.map(u => (
            <li key={u.templateId ?? u.name} className="py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-sm text-text-primary min-w-0">
                {u.name}
                <span className="text-xs text-text-secondary">
                  {' '}
                  · {u.sessions} session{u.sessions === 1 ? '' : 's'}, last {formatDayKeyShort(u.lastDate)}
                </span>
              </span>
              <DiscussButton
                appearance="link"
                label="Add to plan with analyst"
                context={{ kind: 'routine-untracked', name: u.name }}
                subject={u.name}
                suggestions={untrackedSuggestions(u)}
                onPlanChange={onChange}
              />
            </li>
          ))}
        </ul>
        {list.length > 3 && (
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll(a => !a)}>
            {all ? 'Show fewer' : `Show all ${list.length}`}
          </Button>
        )}
      </Card>
    </section>
  );
}

function ArchiveButton({ onChange }: { onChange: (c: PlanChange | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label="Archive this plan">
        <Archive size={14} aria-hidden="true" />
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          const res = await fetch('/api/routine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }) });
          const body = (await res.json().catch(() => ({}))) as { change?: PlanChange };
          setConfirming(false);
          if (body.change) onChange(body.change);
        }}
      >
        Archive plan
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

function DayTemplates({ day }: { day: ScheduledDayView }) {
  if (day.kind === 'rest') return <p className="text-sm text-text-secondary">Rest{day.note ? ` — ${day.note}` : ''}.</p>;
  return (
    <div className="space-y-2">
      {day.templates.map(t => (
        <div key={t.id}>
          <p className="text-sm font-medium text-text-primary">
            <Link href={workoutHref(t.id)} className="hover:underline underline-offset-2">
              {t.name}
            </Link>
            {t.minutes ? <span className="text-text-secondary font-normal"> · ~{t.minutes} min</span> : null}
          </p>
          <ul className="mt-1 space-y-0.5">
            {t.slots.map(s => (
              <li key={`${t.id}-${s.pathId}`} className="text-xs text-text-secondary">
                <span className="text-text-primary">{s.stageName}</span>
                {s.dose ? ` — ${s.dose}` : ''}
                {s.optional ? ' (optional)' : ''}
                {s.rotatesWith.length > 0 && s.optional ? ' · rotates' : ''}
              </li>
            ))}
          </ul>
          {t.warmup.length > 0 && <p className="text-[11px] text-text-secondary mt-1">Warm-up: {t.warmup.join(', ')}</p>}
        </div>
      ))}
    </div>
  );
}

function NextSession({ routine }: { routine: RoutineOverview }) {
  const next = routine.next;
  // Once today is logged the card keeps showing it, and what is due moves into "Then".
  // A frequency plan's due after a logged session is only today's rest, so it is left out.
  const then = next.today
    ? [...(next.scheduleKind === 'frequency' && next.due.kind === 'rest' ? [] : [next.due]), ...next.upcoming].slice(0, 3)
    : next.upcoming;
  return (
    <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 rounded-control bg-surface-muted p-4">
      <div>
        <p className={`${MICRO_LABEL} mb-1.5 flex items-center gap-1.5`}>
          <CalendarDays size={12} aria-hidden="true" />
          {next.today ? 'Today · completed' : 'Today'}
        </p>
        <DayTemplates day={next.today ?? next.due} />
        <p className="text-[11px] text-text-secondary mt-2">{next.why} {routine.adherence.text}</p>
      </div>
      {then.length > 0 && (
        <div className="text-xs text-text-secondary lg:border-l lg:border-border lg:pl-4">
          <p className={`${MICRO_LABEL} mb-1.5`}>Then</p>
          <ol className="space-y-0.5">
            {then.map((d, i) => (
              <li key={i}>
                <DayLabel day={d} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {routine.workouts.length > 0 && (
        <p className="lg:col-span-2 text-[11px] text-text-secondary border-t border-border pt-3 flex flex-wrap gap-x-3 gap-y-1">
          <span className={MICRO_LABEL}>Workouts</span>
          {routine.workouts.map(w => (
            <Link key={w.id} href={workoutHref(w.id)} className="text-text-primary hover:underline underline-offset-2">
              {w.name}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

/** A schedule day's label with each workout in it linking to its page ("Wed: Workout B"). */
function DayLabel({ day }: { day: ScheduledDayView }) {
  const names = day.templates.map(t => t.name).join(' + ');
  if (day.kind === 'rest' || !names || !day.label.endsWith(names)) return <>{day.label}</>;
  return (
    <>
      {day.label.slice(0, day.label.length - names.length)}
      {day.templates.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ' + '}
          <Link href={workoutHref(t.id)} className="text-text-primary hover:underline underline-offset-2">
            {t.name}
          </Link>
        </span>
      ))}
    </>
  );
}

function PathCard({ path }: { path: PathProgress }) {
  const readiness = path.readiness;
  return (
    <Link href={pathHref(path.pathId)} className="block group h-full">
      <Card className="relative overflow-hidden p-4 pl-5 h-full transition-[box-shadow,border-color] group-hover:border-border-strong group-hover:shadow-pop">
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: ACTIVITY }} aria-hidden="true" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-text-secondary">{path.pathName} path{path.priority === 'secondary' ? ' · secondary' : ''}</p>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary truncate">
              {path.stage.name}
              {path.step ? <span className="font-normal text-text-secondary"> · {path.step.name}</span> : null}
            </p>
          </div>
          <ChevronRight size={16} className="text-text-secondary shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <LightLabel light={path.light} tracked={path.tracked} />
          {path.hold && (
            <Badge variant="warning">
              <PauseCircle size={11} className="mr-1" aria-hidden="true" />
              {path.hold.kind === 'regress' ? 'Regress' : 'On hold'}
            </Badge>
          )}
        </div>
        {readiness && (
          <ReadinessBar readiness={readiness} from={path.stage.name} to={path.nextStage?.name ?? null} className="mt-3" />
        )}
        <p className="text-xs text-text-secondary mt-3 line-clamp-2">
          {path.lastSession ? <>Last: <span className="text-text-primary">{path.lastSession.work}</span> ({path.lastSession.date}). </> : null}
          {path.nextAction}
        </p>
      </Card>
    </Link>
  );
}

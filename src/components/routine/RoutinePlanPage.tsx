'use client';

// ── /workouts/routine ───────────────────────────────────
//
// The active training plan itself: its goal and background, the rhythm of
// training and rest days (the repeating pattern and this week), its workouts,
// and its structure — phases reached through progress, and calendar blocks.
// The Workouts page keeps what to train now; this page is the plan's shape.

import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowRight, Check, HeartPulse, Repeat } from 'lucide-react';
import type { CadenceDay, CadenceNode, CadenceView } from '@/lib/routine/cadence';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { PhaseView } from '@/lib/routine/position';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import { Badge, Button, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { PageHero } from '@/components/art/PageHero';
import { HeroStat } from '@/components/art/HeroStat';
import { CATEGORY_VAR } from '@/components/art/categories';
import { SectionTitle } from '@/components/domain/DomainShared';
import {
  BadgeLink,
  BlockChips,
  DeloadChip,
  ExerciseDataNotice,
  MICRO_LABEL,
  PlanWeek,
  RecoveryChip,
  RoutinePageSkeleton,
  pathHref,
  recoveryHref,
  useRoutineFetch,
  workoutHref,
  type RoutineApiResponse,
} from './shared';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { routineSuggestions } from './discuss-suggestions';

const ACTIVITY = CATEGORY_VAR.activity;

export function RoutinePlanPage() {
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<RoutineApiResponse>('/api/routine', units);

  if (state.status === 'loading') return <RoutinePageSkeleton label="Loading the plan" />;
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <ErrorState title="The plan could not be loaded" message={state.message} onRetry={reload} />
      </div>
    );
  }
  const routine = state.data.routine;
  if (!routine) {
    return (
      <div className="space-y-8">
        <PageHero title="Training plan" eyebrow="Workouts" category="activity" />
        <Card className="p-5">
          <EmptyState
            title="No active plan"
            description="Create one from the Workouts page, or ask the analyst to build one."
            action={
              <Link href="/workouts#routine">
                <Button size="sm">Back to Workouts</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PlanHeader routine={routine} onPlanChange={reload} />
      <Background routine={routine} />
      <ExerciseDataNotice routine={routine} />
      <Cadence cadence={routine.cadence} adherence={routine.adherence.text} />
      <Workouts routine={routine} />
      <Phases routine={routine} />
      <CalendarBlocks routine={routine} />
    </div>
  );
}

function PlanHeader({ routine, onPlanChange }: { routine: RoutineOverview; onPlanChange: () => void }) {
  return (
    <PageHero
      title={routine.title}
      eyebrow="Training plan"
      category="activity"
      subtitle={routine.goal}
      aside={<PhaseStat routine={routine} />}
    >
      {routine.currentPhase ? (
        <BadgeLink href="#phases" variant="accent">
          Phase {routine.currentPhase.index + 1} of {routine.currentPhase.count}: {routine.currentPhase.name}
        </BadgeLink>
      ) : routine.phases.length > 0 ? (
        <BadgeLink href="#phases" variant="success">
          All phases complete
        </BadgeLink>
      ) : null}
      <BlockChips routine={routine} />
      <RecoveryChip routine={routine} />
      <DeloadChip routine={routine} />
      <Link href={recoveryHref}>
        <Button size="sm">
          <HeartPulse size={14} className="mr-1.5" aria-hidden="true" />
          Recovery
        </Button>
      </Link>
      <DiscussButton
        context={{ kind: 'routine' }}
        subject={`the plan "${routine.title}"`}
        suggestions={routineSuggestions(routine)}
        onPlanChange={onPlanChange}
      />
    </PageHero>
  );
}

/** The banner figure: progress through the phases (reached through progress, never the calendar), or the plan week. */
function PhaseStat({ routine }: { routine: RoutineOverview }) {
  const current = routine.currentPhase;
  if (current) {
    const { met, total } = current.progress;
    const pct = total > 0 ? Math.round((met / total) * 100) : 0;
    return (
      <HeroStat
        label="Phase"
        value={
          <>
            {current.index + 1}
            <span className="text-base font-normal text-text-secondary"> of {current.count}</span>
          </>
        }
        sub={
          <>
            <span className="block text-[13px] font-medium text-text-primary">{current.name}</span>
            <PlanWeek routine={routine} className="mt-0.5" />
          </>
        }
      >
        <div
          className="h-2 rounded-full bg-surface-muted overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={met}
          aria-label="Required milestones reached in this phase"
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACTIVITY }} />
        </div>
        <p className="mt-1.5 text-[11px] text-text-secondary tnum">
          {met} of {total} required milestones reached
        </p>
      </HeroStat>
    );
  }
  if (routine.phases.length > 0) {
    return <HeroStat label="Phases" value="Complete" sub={<PlanWeek routine={routine} />} />;
  }
  return (
    <HeroStat
      label="Plan"
      value={routine.started ? `Week ${routine.week}` : 'Not started'}
      sub={routine.started ? `of ${routine.durationWeeks}` : `Starts ${formatDayKeyShort(routine.startDate)}`}
    />
  );
}

/** The plan's background notes, under the banner rather than inside it. */
function Background({ routine }: { routine: RoutineOverview }) {
  if (routine.context.length === 0) return null;
  return (
    <Card variant="muted" className="p-5" as="section" aria-labelledby="background-title">
      <h2 id="background-title" className={`${MICRO_LABEL} mb-2`}>
        Background
      </h2>
      <ul className="space-y-1 text-sm text-text-secondary list-disc pl-4">
        {routine.context.map(c => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </Card>
  );
}

// ── Cadence ─────────────────────────────────────────────

function Cadence({ cadence, adherence }: { cadence: CadenceView; adherence: string }) {
  return (
    <section aria-labelledby="cadence-title">
      <SectionTitle>
        <span id="cadence-title">Cadence</span>
      </SectionTitle>
      <Card className="p-5 md:p-6 space-y-5">
        <p className="text-sm text-text-secondary">{cadence.caption}</p>
        {cadence.pattern.length > 0 && <Pattern nodes={cadence.pattern} />}
        <WeekStrip days={cadence.week} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-accent-tint" aria-hidden="true" />
            Logged
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm border border-primary" aria-hidden="true" />
            Expected
          </span>
          {cadence.kind === 'frequency' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm border border-dashed border-text-secondary" aria-hidden="true" />
              Any day
            </span>
          )}
          <span>
            {cadence.weekSummary}. {adherence}
          </span>
        </div>
      </Card>
    </section>
  );
}

/** The repeating pattern: workouts as boxes, rest as pills, arrows between, and back to the start. */
function Pattern({ nodes }: { nodes: CadenceNode[] }) {
  return (
    // The Today/Next tag floats above its node, so every node and arrow shares one centre line.
    <ol className="flex flex-wrap items-center gap-y-7 pt-5 list-none p-0" aria-label="Repeating pattern">
      {nodes.map((node, i) => (
        <li key={i} className="inline-flex items-center">
          <div className="relative flex">
            {node.current && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-primary whitespace-nowrap">
                {node.current === 'today' ? 'Today' : 'Next'}
              </span>
            )}
            <PatternNode node={node} />
          </div>
          {i < nodes.length - 1 ? (
            <ArrowRight size={14} className="mx-1.5 text-text-secondary shrink-0" aria-hidden="true" />
          ) : (
            <span className="inline-flex items-center gap-1 ml-2 text-[11px] text-text-secondary">
              <Repeat size={13} aria-hidden="true" />
              back to start
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function PatternNode({ node }: { node: CadenceNode }) {
  const ring = node.current ? 'ring-2 ring-primary' : '';
  if (node.kind === 'rest') {
    return (
      <span className={`rounded-full bg-surface-muted px-3 py-1.5 text-xs text-text-secondary ${ring}`} title={node.note}>
        Rest
      </span>
    );
  }
  return (
    <span className={`rounded-control border border-border px-3 py-2 text-sm font-medium text-text-primary ${node.current ? 'bg-accent-tint' : 'bg-surface'} ${ring}`} title={node.note}>
      {node.templates.map((t, k) => (
        <Fragment key={t.id}>
          {k > 0 && ' + '}
          <Link href={workoutHref(t.id)} className="hover:underline underline-offset-2">
            {t.name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

/** Monday to Sunday: what was logged, and what the schedule expects for the days ahead. */
function WeekStrip({ days }: { days: CadenceDay[] }) {
  return (
    <div>
      <h3 className={`${MICRO_LABEL} mb-2`}>This week</h3>
      <ol className="grid grid-cols-7 gap-1 sm:gap-2 list-none p-0">
        {days.map(d => (
          <li key={d.date} aria-current={d.isToday ? 'date' : undefined} aria-label={dayLabel(d)} className="min-w-0 flex flex-col items-center gap-1">
            <span className={`text-[10px] sm:text-[11px] leading-none ${d.isToday ? 'font-semibold text-primary' : 'text-text-secondary'}`}>{d.weekday}</span>
            <span className={`text-[10px] leading-none tnum ${d.isToday ? 'font-semibold text-primary' : 'text-text-secondary'}`}>{Number(d.date.slice(8))}</span>
            <DayCell day={d} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function dayLabel(d: CadenceDay): string {
  const when = `${d.weekday} ${formatDayKeyShort(d.date)}${d.isToday ? ' (today)' : ''}`;
  if (d.logged.length) return `${when}: logged ${d.logged.map(t => t.name).join(', ')}`;
  if (d.otherSession) return `${when}: logged a session outside the plan's workouts`;
  if (d.rested) return `${when}: rest`;
  if (!d.expected) return when;
  if (d.expected.kind === 'rest') return `${when}: rest expected`;
  if (d.expected.kind === 'open') return `${when}: open`;
  return `${when}: ${d.expected.templates.map(t => t.name).join(' + ')} expected`;
}

function DayCell({ day }: { day: CadenceDay }) {
  const base = `w-full min-h-[56px] rounded-control p-1 flex flex-col items-center justify-center gap-0.5 text-center ${day.isToday ? 'ring-2 ring-primary' : ''}`;
  const names = (list: { id: string; name: string }[]) =>
    list.map(t => (
      <Link
        key={t.id}
        href={workoutHref(t.id)}
        title={t.name}
        className="block w-full text-[10px] sm:text-[11px] leading-tight text-text-primary line-clamp-2 break-words hover:underline underline-offset-2"
      >
        {t.name}
      </Link>
    ));

  if (day.logged.length) {
    return (
      <div className={`${base} bg-accent-tint`}>
        <Check size={12} className="text-primary shrink-0" aria-hidden="true" />
        {names(day.logged)}
      </div>
    );
  }
  if (day.otherSession) {
    return (
      <div className={`${base} bg-accent-tint text-[10px] sm:text-[11px] text-text-primary`} title="A logged session that matches none of the plan's workouts">
        <Check size={12} className="text-primary shrink-0" aria-hidden="true" />
        Session
      </div>
    );
  }
  if (day.rested) return <div className={`${base} bg-surface-muted text-[10px] sm:text-[11px] text-text-secondary`}>Rest</div>;
  const e = day.expected;
  if (!e) return <div className={`${base} border border-transparent`} />;
  if (e.kind === 'rest') return <div className={`${base} bg-surface-muted text-[10px] sm:text-[11px] text-text-secondary`}>Rest</div>;
  if (e.kind === 'open') return <div className={`${base} border border-dashed border-text-secondary`} />;
  return <div className={`${base} border border-primary`}>{names(e.templates)}</div>;
}

// ── Workouts ────────────────────────────────────────────

function Workouts({ routine }: { routine: RoutineOverview }) {
  if (routine.workouts.length === 0) return null;
  return (
    <section aria-labelledby="workouts-title">
      <SectionTitle>
        <span id="workouts-title">Workouts</span>
      </SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {routine.workouts.map(w => {
          const ready = w.domains.flatMap(d => d.slots).filter(s => s.suggestion?.status === 'ready').length;
          return (
            <Link key={w.id} href={workoutHref(w.id)} className="block group h-full">
              <Card className="relative overflow-hidden p-5 h-full transition-[box-shadow,border-color] group-hover:border-border-strong group-hover:shadow-pop">
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: ACTIVITY }} aria-hidden="true" />
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{w.name}</p>
                  {w.when && <Badge variant="accent">{w.when}</Badge>}
                </div>
                <p className="text-[13px] text-text-secondary mt-1">
                  {w.domains.map(d => d.areaName).join(' · ') || 'No slots yet'}
                  {w.minutes ? ` · ~${w.minutes} min` : ''}
                </p>
                {ready > 0 && <p className="text-[11px] text-text-secondary mt-3">{ready} ready to progress</p>}
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Phases and calendar blocks ──────────────────────────

// The current phase takes the logged-day fill from the cadence strip; the others
// stay muted, with upcoming ones in muted text as well.
const PHASE_SURFACE: Record<PhaseView['status'], string> = {
  current: 'bg-accent-tint',
  complete: 'bg-surface-muted',
  upcoming: 'bg-surface-muted',
};

/** A milestone or target, linking to the page of the path it measures when it names one. */
function TargetLabel({ label, pathId, className = '' }: { label: string; pathId?: string; className?: string }) {
  if (!pathId) return <span className={className}>{label}</span>;
  return (
    <Link href={pathHref(pathId)} className={`${className} hover:text-primary hover:underline underline-offset-2`}>
      {label}
    </Link>
  );
}

function Phases({ routine }: { routine: RoutineOverview }) {
  if (routine.phases.length === 0) return null;
  const current = routine.currentPhase;
  return (
    <section className="scroll-mt-20" id="phases" aria-labelledby="phases-title">
      <SectionTitle hint="Phases follow your progress, not the calendar">
        <span id="phases-title">Phases</span>
      </SectionTitle>
      <Card className="p-5 md:p-6">
        <p className="text-sm text-text-secondary">
          {current
            ? `Phase ${current.index + 1}: ${current.name} — ${current.progress.met} of ${current.progress.total} required milestones reached${current.since ? `, since ${current.since}` : ''}.`
            : 'Every phase is complete.'}
        </p>
        <ol className="mt-4 space-y-3 list-none p-0">
          {routine.phases.map(p => (
            <li key={p.id} className={`relative overflow-hidden rounded-control p-3 ${p.status === 'current' ? 'pl-4' : ''} ${PHASE_SURFACE[p.status]}`}>
              {p.status === 'current' && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" aria-hidden="true" />}
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={`text-[15px] ${p.status === 'upcoming' ? 'text-text-secondary' : 'text-text-primary'} font-medium`}>
                  {p.index + 1}. {p.name}
                </p>
                <span className="text-[11px] text-text-secondary">
                  {p.status === 'complete'
                    ? `Complete${p.completedOn ? ` · ${p.completedOn}` : ''}`
                    : p.status === 'current'
                      ? `Current · ${p.progress.met} of ${p.progress.total} required`
                      : `Upcoming${p.expectedWeeks ? ` · typically ${p.expectedWeeks[0]}–${p.expectedWeeks[1]} weeks` : ''}`}
                </span>
              </div>
              {p.goals.length > 0 && <p className="text-[11px] text-text-secondary mt-0.5">{p.goals.join(' · ')}</p>}
              <ul className="mt-1.5 space-y-0.5">
                {p.targets.map(t => (
                  <li
                    key={t.label}
                    className="text-xs text-text-secondary"
                    title={t.met === null ? 'Not checked: this milestone names no stage or dose, so logged sessions cannot show it. It never holds the phase back.' : undefined}
                  >
                    <span aria-hidden="true">{t.met === true ? '✓ ' : t.met === false ? '○ ' : '? '}</span>
                    <TargetLabel label={t.label} pathId={t.pathId} className={t.met ? 'text-text-primary' : ''} />
                    {t.optional ? ' (optional)' : ''}
                    {t.met === null ? ' (not checked)' : ''}
                    {t.met && t.metOn ? <span className="tnum"> · {t.metOn}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function CalendarBlocks({ routine }: { routine: RoutineOverview }) {
  if (routine.blocks.length === 0) return null;
  const statusLabel = { past: 'Done', current: 'This week', future: 'Upcoming' } as const;
  return (
    <section className="scroll-mt-20" id="blocks" aria-labelledby="blocks-title">
      <SectionTitle>
        <span id="blocks-title">Calendar blocks</span>
      </SectionTitle>
      <Card className="p-5 md:p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className={`text-left border-b border-border ${MICRO_LABEL}`}>
                <th className="py-2 pr-3 font-medium">Block</th>
                <th className="py-2 pr-3 font-medium">Weeks</th>
                <th className="py-2 pr-3 font-medium">Goals</th>
                <th className="py-2 pr-3 font-medium">Targets</th>
                <th className="py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {routine.blocks.map(b => (
                <tr key={b.id} className={`border-b border-border last:border-b-0 align-top ${b.status === 'current' ? 'bg-accent-tint' : ''}`}>
                  <td className="py-2 pr-3 text-text-primary font-medium">{b.name}</td>
                  <td className="py-2 pr-3 text-text-secondary tnum whitespace-nowrap">{b.weeks[0] === b.weeks[1] ? b.weeks[0] : `${b.weeks[0]}–${b.weeks[1]}`}</td>
                  <td className="py-2 pr-3 text-text-secondary">{b.goals.join('; ')}</td>
                  <td className="py-2 pr-3 text-text-secondary">
                    {b.targets.map(t => (
                      <span key={t.label} className="block">
                        {t.met === true ? '✓ ' : ''}
                        <TargetLabel label={t.label} pathId={t.pathId} />
                      </span>
                    ))}
                  </td>
                  <td className="py-2 text-text-primary whitespace-nowrap">{statusLabel[b.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

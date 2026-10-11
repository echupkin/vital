'use client';

// ── /workouts/routine/[pathId] ──────────────────────────
//
// One progression path in detail: which stage it is on and what comes next, the
// recent sessions with what each one signals, the light with its reasons, the
// next action, the stage's cues and checks, and the recovery indicators that can
// hold progression back.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, PauseCircle } from 'lucide-react';
import type { PathProgress, RoutineOverview } from '@/lib/routine/progress';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { Badge, Button, Card, ErrorState } from '@/components/ui/primitives';
import { DiscussButton } from '@/components/analyst/DiscussDialog';
import { useUnits } from '@/components/ui/UnitsProvider';
import { PageHero } from '@/components/art/PageHero';
import { HeroStat } from '@/components/art/HeroStat';
import { SectionTitle } from '@/components/domain/DomainShared';
import {
  ExerciseDataNotice,
  LIGHT_LABEL,
  LIGHT_MEANING,
  LightDot,
  LightLabel,
  MICRO_LABEL,
  ReadinessBar,
  RecoveryCard,
  RoutinePageSkeleton,
  pathHref,
  useRoutineFetch,
} from './shared';
import { pathSuggestions } from './discuss-suggestions';
import { useBreadcrumbLabel } from '@/components/shell/Breadcrumbs';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import type { NarrativeView } from '@/lib/routine/narrative-types';

interface PathDetailResponse {
  routine: RoutineOverview;
  path: PathProgress;
  narrative?: NarrativeView;
  sources: WorkoutSourceStatus[];
  origin: 'live' | 'demo';
}

export function RoutinePathPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const { units } = useUnits();
  const { state, reload } = useRoutineFetch<PathDetailResponse>(`/api/routine/${encodeURIComponent(pathId)}`, units);
  useBreadcrumbLabel(state.status === 'ok' ? `${state.data.path.pathName} path` : undefined);

  // A model note is written in the background: poll a few times, backing off.
  const polls = useRef(0);
  const pending = state.status === 'ok' && state.data.narrative?.pending === true;
  useEffect(() => {
    if (!pending || polls.current >= 6) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      reload();
    }, 3000 * 2 ** polls.current);
    return () => clearTimeout(timer);
  }, [pending, state, reload]);

  if (state.status === 'loading') return <RoutinePageSkeleton label="Loading the progression detail" />;
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <ErrorState title="This path could not be loaded" message={state.message} onRetry={reload} />
      </div>
    );
  }
  const { path, routine, narrative } = state.data;
  const stageNumber = path.stage.index + 1;

  return (
    <div className="space-y-8">
      <PageHero
        title={`${path.pathName} path`}
        eyebrow={`${routine.title} · ${path.areaName}`}
        category="activity"
        subtitle={
          <>
            Current stage: {stageNumber > 1 || path.stages.length > 1 ? `Stage ${stageNumber} ` : ''}
            {path.stage.name.toLowerCase()}
            {path.step ? ` · ${path.step.name}` : ''}
          </>
        }
        aside={<LightStat path={path} />}
      >
        <Badge>{path.modelLabel}</Badge>
        {path.stage.startedOn && <Badge>Since {path.stage.startedOn}</Badge>}
        {path.nextStage && <Badge variant="accent">Next: {path.nextStage.name}</Badge>}
        <DiscussButton
          context={{ kind: 'routine-path', pathId: path.pathId }}
          subject={`the ${path.pathName} path`}
          suggestions={pathSuggestions(path)}
          onPlanChange={reload}
        />
      </PageHero>

      {path.hold && (
        <Card className="relative overflow-hidden p-4 pl-5">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-category-attention" aria-hidden="true" />
          <p className="flex items-start gap-2 text-sm text-text-primary">
            <PauseCircle size={16} className="text-category-attention shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {path.hold.kind === 'regress' ? 'Regress' : 'On hold'} since {path.hold.since}: {path.hold.reason}. Ask the analyst to clear it when it has resolved.
            </span>
          </p>
        </Card>
      )}

      {!path.tracked && <ExerciseDataNotice routine={routine} />}

      <section aria-labelledby="assessment-title">
        <SectionTitle>
          <span id="assessment-title">Assessment</span>
        </SectionTitle>
        <Assessment path={path} narrative={narrative} />
      </section>

      <section aria-labelledby="stages-title">
        <SectionTitle>
          <span id="stages-title">Stages</span>
        </SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StageMap path={path} />
          <StageGuidance path={path} routine={routine} />
        </div>
      </section>

      <SessionTable path={path} />

      <AreaSiblings routine={routine} path={path} />

      <section aria-labelledby="path-recovery-title">
        <SectionTitle>
          <span id="path-recovery-title">Recovery</span>
        </SectionTitle>
        <RecoveryCard indicators={routine.recovery.indicators} summary={routine.recovery.text} deload={routine.deload.text} />
      </section>
    </div>
  );
}

/** The banner figure: the path's light, what it means, and how close the next stage is. */
function LightStat({ path }: { path: PathProgress }) {
  const light = path.tracked ? path.light : 'none';
  return (
    <HeroStat
      label="Light"
      value={
        <span className="inline-flex items-center gap-2.5">
          <LightDot light={light} size={18} />
          {path.tracked ? LIGHT_LABEL[path.light] : 'Not tracked'}
        </span>
      }
      sub={path.tracked ? LIGHT_MEANING[path.light] : 'needs a workout source'}
    >
      {path.readiness ? <ReadinessBar readiness={path.readiness} from={path.stage.name} to={path.nextStage?.name ?? null} /> : null}
    </HeroStat>
  );
}

function Assessment({ path, narrative }: { path: PathProgress; narrative?: NarrativeView }) {
  const text = narrative?.assessment ?? path.reasons.join(' ');
  const next = narrative?.nextAction ?? path.nextAction;
  return (
    <Card className="p-5 md:p-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={MICRO_LABEL}>Light</span>
        <LightLabel light={path.light} tracked={path.tracked} />
        {path.readiness && <span className="text-xs text-text-secondary tnum">{path.readiness.label}</span>}
      </div>
      {/* An untracked path's reason is the notice above it; saying it again here adds nothing. */}
      {path.tracked && <p className="text-[15px] text-text-primary leading-relaxed max-w-3xl">{text}</p>}
      <p className="text-[15px] text-text-primary leading-relaxed max-w-3xl">
        <span className="font-semibold">Next action:</span> {next}
      </p>
      {narrative && path.tracked && (
        <p className="text-[11px] text-text-secondary">
          {narrative.source === 'model'
            ? `Written by ${narrative.model ?? 'the configured model'} from the computed figures; every number was checked against them.`
            : narrative.note}
        </p>
      )}
    </Card>
  );
}

function SessionTable({ path }: { path: PathProgress }) {
  const [all, setAll] = useState(false);
  if (path.rows.length === 0) {
    return (
      <section aria-labelledby="sessions-title">
        <SectionTitle>
          <span id="sessions-title">Sessions</span>
        </SectionTitle>
        <Card className="p-5">
          <p className="text-sm text-text-secondary">
            {path.tracked
              ? `No sessions logged for ${path.stage.name.toLowerCase()} yet. Sessions are matched by exercise name or template id from your workout source (or by workout type).`
              : `Sessions of ${path.stage.name.toLowerCase()} come from a workout source, and none is connected, so none can be shown here.`}
          </p>
        </Card>
      </section>
    );
  }
  // path.rows runs oldest to newest; the table reads newest first.
  const rows = (all ? path.rows : path.rows.slice(-12)).slice().reverse();
  const otherStages = new Set(path.rows.flatMap(r => [r, ...(r.also ?? [])]).filter(r => r.stageId !== path.stage.id).map(r => r.stageId)).size;
  return (
    <section aria-labelledby="sessions-title">
      <SectionTitle hint={path.rows.length > 12 && !all ? `${rows.length} most recent of ${path.rows.length}` : `${path.rows.length} logged`}>
        <span id="sessions-title">Sessions</span>
      </SectionTitle>
      <Card className="p-5 md:p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left border-b border-border ${MICRO_LABEL}`}>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Work</th>
              <th className="py-2 pr-4 font-medium text-right">{path.model === 'volume' ? 'Sessions' : path.model === 'load' || path.model === 'percentage' ? 'Estimate' : 'Total'}</th>
              <th className="py-2 pr-4 font-medium">Effort</th>
              <th className="py-2 font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              // One row per day: the lead entry, then other stages' work from the same day.
              const entries = [r, ...(r.also ?? [])];
              const tone = (e: typeof r) => (e.stageId !== path.stage.id ? 'text-text-secondary' : 'text-text-primary');
              return (
                <tr key={`${r.dates.join(',')}:${r.stageId}`} className="border-b border-border last:border-b-0 align-top">
                  <td className={`py-2.5 pr-4 whitespace-nowrap tnum ${tone(r)}`}>{r.dates.map(formatDayKeyShort).join(' / ')}</td>
                  <td className="py-2 pr-4">
                    {entries.map(e => (
                      <span key={e.stageId} className={`block ${tone(e)}`}>
                        {e.work}
                        {e.notes && <span className="block text-[11px] text-text-secondary italic">{e.notes}</span>}
                      </span>
                    ))}
                  </td>
                  <td className="py-2 pr-4 text-right tnum whitespace-nowrap">
                    {entries.map(e => <span key={e.stageId} className={`block ${tone(e)}`}>{e.headline}</span>)}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-text-secondary">
                    {entries.map(e => <span key={e.stageId} className="block">{e.effort ?? '—'}</span>)}
                  </td>
                  <td className="py-2">
                    {entries.map(e => <span key={e.stageId} className={`block ${tone(e)}`}>{e.signal}</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <p className="text-[11px] text-text-secondary">
            Every stage of this path{otherStages > 0 ? ' — other stages are shown in grey, each judged against its own marker' : ''}.
            {' '}The light and next action are about {path.stage.name.toLowerCase()}.
          </p>
          {path.rows.length > 12 && (
            <Button variant="ghost" size="sm" onClick={() => setAll(a => !a)}>
              {all ? 'Show recent' : `Show all ${path.rows.length} rows`}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}

function StageMap({ path }: { path: PathProgress }) {
  return (
    <Card className="p-5 md:p-6">
      <h3 className={`${MICRO_LABEL} mb-3`}>All stages</h3>
      <ol className="space-y-3">
        {path.stages.map(s => (
          <li key={s.id} className="flex items-start gap-2">
            {s.complete ? (
              <CheckCircle2 size={16} className="text-category-activity mt-0.5 shrink-0" aria-label={s.status === 'current' ? 'Current, complete' : 'Done'} />
            ) : s.status === 'current' ? (
              <CircleDot size={16} className="text-primary mt-0.5 shrink-0" aria-label="Current" />
            ) : (
              <Circle size={16} className="text-text-secondary mt-0.5 shrink-0" aria-label="Upcoming" />
            )}
            <div className="min-w-0">
              <p className={`text-[15px] ${s.status === 'current' ? 'font-semibold text-text-primary' : s.status === 'done' ? 'text-text-secondary' : 'text-text-primary'}`}>
                {s.name}
                {s.expectedWeeks && <span className="text-[11px] font-normal text-text-secondary"> · {s.expectedWeeks[0]}–{s.expectedWeeks[1]} weeks</span>}
              </p>
              {s.status === 'current' && s.complete && <p className="text-[11px] font-medium text-category-activity">{path.nextStage ? `Complete: ready for ${path.nextStage.name.toLowerCase()}` : 'Complete: the last stage of this path'}</p>}
              {s.target && <p className="text-[11px] text-text-secondary">Move on at {s.target}{s.startedOn ? ` · since ${s.startedOn}` : ''}</p>}
              {s.steps.length > 0 && <p className="text-[11px] text-text-secondary">Steps: {s.steps.join(' → ')}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StageGuidance({ path, routine }: { path: PathProgress; routine: RoutineOverview }) {
  return (
    <Card className="relative overflow-hidden p-5 md:p-6 space-y-4">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-category-activity" aria-hidden="true" />
      <div>
        <p className={MICRO_LABEL}>Current stage</p>
        <h3 className="mt-1 text-[19px] font-semibold tracking-[-0.025em] text-text-primary">{path.stage.name}</h3>
      </div>
      {path.readiness && <ReadinessBar readiness={path.readiness} from={path.stage.name} to={path.nextStage?.name ?? null} />}
      {path.target && (
        <p className="text-xs text-text-secondary">
          <span className="text-text-primary font-medium">Progression marker:</span> {path.target}
        </p>
      )}
      {path.cues.length > 0 && (
        <div>
          <p className={`${MICRO_LABEL} mb-1`}>Cues</p>
          <ul className="text-xs text-text-secondary list-disc pl-4">{path.cues.map(c => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {(path.checks.length > 0 || routine.doNotProgressIf.length > 0) && (
        <div>
          <p className={`${MICRO_LABEL} mb-1`}>Check before progressing</p>
          <p className="text-[11px] text-text-secondary mb-1">These can&apos;t be read from any data source — only you can judge them.</p>
          <ul className="text-xs text-text-secondary list-disc pl-4">
            {[...path.checks, ...routine.doNotProgressIf.map(d => `Don't progress if: ${d.charAt(0).toLowerCase()}${d.slice(1)}`)].map(c => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** The other paths of the same focus area, so the page covers the whole domain. */
function AreaSiblings({ routine, path }: { routine: RoutineOverview; path: PathProgress }) {
  const siblings = routine.paths.filter(p => p.areaId === path.areaId && p.pathId !== path.pathId);
  if (siblings.length === 0) return null;
  return (
    <section aria-labelledby="siblings-title">
      <SectionTitle>
        <span id="siblings-title">Also in {path.areaName}</span>
      </SectionTitle>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0 m-0">
        {siblings.map(p => (
          <li key={p.pathId}>
            <Link
              href={pathHref(p.pathId)}
              className="relative block h-full overflow-hidden rounded-card border border-border bg-surface p-4 pl-5 shadow-card transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-pop"
            >
              <span className="absolute inset-y-0 left-0 w-[3px] bg-category-activity" aria-hidden="true" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">{p.pathName}</span>
                <LightLabel light={p.light} tracked={p.tracked} />
              </div>
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{p.stage.name}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {p.lastSession ? `Last: ${p.lastSession.work} (${formatDayKeyShort(p.lastSession.date)})` : p.tracked ? 'Nothing logged yet' : 'Needs a workout source'}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

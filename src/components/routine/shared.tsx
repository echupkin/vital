'use client';

// ── Routine UI: shared pieces ───────────────────────────
//
// The light (one shared scale for every progression model), the data hook that
// reads /api/routine, the plan-change card the analyst page reuses, the routine
// pages' links, and the status badges and recovery card shown on several pages.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronRight, PlugZap, Undo2 } from 'lucide-react';
import type { Light, Readiness } from '@/lib/routine/models/types';
import type { RoutineOverview } from '@/lib/routine/progress';
import type { RecoveryIndicator, RecoveryStatus } from '@/lib/routine/recovery';
import type { RoutineResponse } from '@/lib/routine/service';
import type { PlanChange } from '@/lib/routine/types';
import type { UnitSystem } from '@/lib/prefs';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import { Badge, Button, Card, Skeleton } from '@/components/ui/primitives';

export const planHref = '/workouts/routine';
export const recoveryHref = '/workouts/recovery';
export const workoutHref = (templateId: string) => `/workouts/routine/workouts/${encodeURIComponent(templateId)}`;
export const pathHref = (pathId: string) => `/workouts/routine/${encodeURIComponent(pathId)}`;

/** The small-caps label the redesigned pages use above a group or a figure. */
export const MICRO_LABEL = 'text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary';

/** A routine page while it loads: a banner-sized block first, so the hero does not shift the layout. */
export function RoutinePageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton height={200} rounded={false} className="rounded-[22px]" />
      <Skeleton height={20} width="30%" />
      <Skeleton height={180} />
    </div>
  );
}

// ── Status badges ───────────────────────────────────────
//
// Every status badge on a routine page links to where it is explained: phases
// and blocks to the plan page, recovery and deloads to the Recovery page.

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'info';

export function BadgeLink({ href, variant, title, children }: { href: string; variant?: BadgeVariant; title?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
    >
      <Badge variant={variant} title={title} className="underline-offset-2 hover:underline">
        {children}
      </Badge>
    </Link>
  );
}

export function recoveryVariant(status: RecoveryStatus): BadgeVariant {
  return status === 'warn' ? 'warning' : status === 'watch' ? 'info' : status === 'ok' ? 'success' : 'default';
}

const RECOVERY_CHIP: Record<RoutineOverview['recovery']['status'], string> = {
  warn: 'Recovery: hold',
  watch: 'Recovery: watch',
  ok: 'Recovery: ok',
  unknown: 'Recovery: unknown',
};

export function RecoveryChip({ routine }: { routine: RoutineOverview }) {
  const r = routine.recovery;
  return (
    <BadgeLink href={recoveryHref} variant={recoveryVariant(r.status)} title={r.text}>
      {RECOVERY_CHIP[r.status]}
    </BadgeLink>
  );
}

/** Due, overdue or running this week; nothing while a deload is not yet due. */
export function DeloadChip({ routine }: { routine: RoutineOverview }) {
  const d = routine.deload;
  if (d.status === 'due' || d.status === 'overdue') {
    return (
      <BadgeLink href={recoveryHref} variant="warning" title={d.text}>
        {d.status === 'overdue' ? 'Deload overdue' : 'Deload due'}
      </BadgeLink>
    );
  }
  if (d.status === 'in-deload') {
    return (
      <BadgeLink href={recoveryHref} variant="info" title={d.text}>
        Deload week
      </BadgeLink>
    );
  }
  return null;
}

/** Calendar blocks running this week, each linking to the plan's block table. */
export function BlockChips({ routine }: { routine: RoutineOverview }) {
  return (
    <>
      {routine.currentBlocks.map(b => (
        <BadgeLink key={b} href={`${planHref}#blocks`}>
          {b}
        </BadgeLink>
      ))}
    </>
  );
}

/** Where the reader is in the plan's calendar: plain text, not a status. */
export function PlanWeek({ routine, className = '' }: { routine: RoutineOverview; className?: string }) {
  return (
    <p className={`text-xs text-text-secondary tnum ${className}`}>
      {routine.started ? `Week ${routine.week} of ${routine.durationWeeks}` : `Starts ${formatDayKeyShort(routine.startDate)}`}
    </p>
  );
}

// ── Recovery card ───────────────────────────────────────

export const RECOVERY_TONE: Record<RecoveryStatus, string> = {
  ok: 'Inside limits',
  watch: 'Watch',
  warn: 'Hold',
  info: 'For information',
  unknown: 'Not enough data',
};

/** The recovery indicators at a glance, linking to the Recovery page for the detail. */
export function RecoveryCard({ indicators, summary, deload }: { indicators: RecoveryIndicator[]; summary: string; deload: string }) {
  return (
    <Card className="p-5" as="section" aria-label="Recovery indicators">
      {/* Titled by the section it sits in, so the card opens with the summary. */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-text-secondary max-w-3xl">{summary} {deload}</p>
        <Link href={recoveryHref} className="group inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          Details
          <ChevronRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {indicators.map(i => (
          <div key={i.signal} className="rounded-control bg-surface-muted p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-text-primary">{i.label}</span>
              <Badge variant={recoveryVariant(i.status)}>{RECOVERY_TONE[i.status]}</Badge>
            </div>
            <p className="text-[11px] text-text-secondary mt-1">{i.text}</p>
            {i.gate?.note && <p className="text-[11px] text-text-secondary mt-1 italic">{i.gate.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export const LIGHT_LABEL: Record<Light, string> = {
  green: 'Green',
  'yellow-green': 'Yellow-green',
  yellow: 'Yellow',
  red: 'Red',
  none: 'No data',
};

export const LIGHT_MEANING: Record<Light, string> = {
  green: 'ready to progress',
  'yellow-green': 'nearly there',
  yellow: 'continue building',
  red: 'back off',
  none: 'nothing logged yet',
};

const LIGHT_DOT: Record<Light, string> = {
  green: 'bg-green-500',
  'yellow-green': 'bg-lime-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
  none: 'bg-transparent border border-border',
};

export function LightDot({ light, size = 10 }: { light: Light; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${LIGHT_DOT[light]}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** A path's light; `tracked={false}` says nothing can be read, rather than nothing was logged. */
export function LightLabel({ light, tracked = true }: { light: Light; tracked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
      <LightDot light={tracked ? light : 'none'} />
      {tracked ? LIGHT_LABEL[light] : 'Not tracked'}
      <span className="text-text-secondary font-normal">· {tracked ? LIGHT_MEANING[light] : 'needs a workout source'}</span>
    </span>
  );
}

/**
 * Shown wherever the routine is, when no workout source is connected and some
 * paths can only be judged from one. Nothing when every path can be followed
 * through Apple Health workout types.
 */
export function ExerciseDataNotice({ routine }: { routine: RoutineOverview }) {
  if (routine.exerciseData) return null;
  const untracked = routine.paths.filter(p => !p.tracked).length;
  if (untracked === 0) return null;
  const all = untracked === routine.paths.length;
  return (
    <Card className="p-4" as="section" aria-labelledby="exercise-data-title">
      <div className="flex items-start gap-3">
        <PlugZap size={18} className="text-category-attention shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h3 id="exercise-data-title" className="text-[15px] font-semibold text-text-primary">
            {all ? 'Progress can’t be tracked yet' : `Progress can’t be tracked for ${untracked} of ${routine.paths.length} paths`}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed max-w-2xl">
            No workout source is connected. Without one, only a workout&rsquo;s type and duration are known, but judging{' '}
            {all ? 'these paths' : 'those paths'} needs the exercises, sets, reps and load a workout-logging app records.
            Until one is connected they show as not tracked, and sessions aren&rsquo;t counted as missed. The plan itself works as
            usual.
          </p>
          <Link href="/settings?tab=sources" className="inline-flex items-center gap-1 text-xs text-primary hover:underline min-h-[24px]">
            Connect a workout source <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export interface RoutineApiResponse extends RoutineResponse {
  references: { id: string; label: string }[];
}

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: T };

/** GET a routine endpoint, re-read on demand and when the unit system changes. */
export function useRoutineFetch<T>(url: string, system: UnitSystem): { state: Loaded<T>; reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // A superseded request (a new unit system, a reload) is dropped, not downloaded.
    const abort = new AbortController();
    setState(s => (s.status === 'ok' ? s : { status: 'loading' }));
    fetch(`${url}${url.includes('?') ? '&' : '?'}system=${system}`, { cache: 'no-store', signal: abort.signal })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `The routine answered HTTP ${res.status}.`);
        return body as T;
      })
      .then(data => !cancelled && setState({ status: 'ok', data }))
      .catch(e => !cancelled && setState({ status: 'error', message: e instanceof Error ? e.message : 'The routine could not be loaded.' }));
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [url, system, nonce]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { state, reload };
}

export async function undoChange(change: PlanChange): Promise<string | null> {
  const res = await fetch('/api/routine/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ change }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Undo failed (HTTP ${res.status}).`;
}

/** What changed in the plan, with a link to the routine and an undo button. */
export function PlanChangeCard({ change, onUndone }: { change: PlanChange; onUndone?: () => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'undone' | { error: string }>('idle');
  const verb = change.kind === 'create' ? 'Created' : change.kind === 'archive' ? 'Archived' : 'Updated';
  return (
    <div className="rounded-control border border-border bg-surface-muted p-3 space-y-2" role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">
          {verb} plan: {change.planTitle}
        </p>
        <span className="text-[11px] text-text-secondary">{change.summary}</span>
      </div>
      {change.diff.length > 0 && (
        <ul className="text-xs text-text-secondary space-y-0.5 list-disc pl-4">
          {change.diff.slice(0, 8).map(line => (
            <li key={line}>{line}</li>
          ))}
          {change.diff.length > 8 && <li>…and {change.diff.length - 8} more</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/workouts#routine" className="text-xs font-medium text-primary hover:underline">
          View routine
        </Link>
        {state === 'undone' ? (
          <span className="text-xs text-text-secondary">Undone.</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={state === 'working'}
            onClick={async () => {
              setState('working');
              const error = await undoChange(change);
              if (error) setState({ error });
              else {
                setState('undone');
                onUndone?.();
              }
            }}
          >
            <Undo2 size={12} className="mr-1" aria-hidden="true" />
            Undo
          </Button>
        )}
        {typeof state === 'object' && <span className="text-xs text-category-attention">{state.error}</span>}
      </div>
    </div>
  );
}

/** Progress toward the next step or stage: the work toward the marker, effort, then qualifying sessions. */
export function ReadinessBar({ readiness, from, to, className = '' }: { readiness: Readiness; from: string; to: string | null; className?: string }) {
  const pct = Math.min(100, Math.round(readiness.progress * 100));
  return (
    <div className={className}>
      <div className="flex justify-between gap-2 text-[11px] text-text-secondary mb-1">
        <span className="min-w-0 truncate">
          {from}
          {to ? ` → ${to}` : ''}
        </span>
        <span className="tnum shrink-0">{readiness.label}</span>
      </div>
      <div
        className="h-2 rounded-full bg-surface-muted overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Progress toward ${to ?? 'the marker'}`}
        title={`${pct}% of the way to ${to ?? 'the marker'}`}
      >
        <div className="h-full rounded-full bg-category-activity" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

'use client';

// ── Settings → Connections → Data pipeline: data quality ─
//
// What the checks in `src/lib/adapters/quality.ts` found in the live export,
// each finding with the days it affects and the steps that fix it, then the
// list of checks that ran and passed. Severity is always written out, never
// carried by colour alone. Overlapping exports and duplicate readings Vital
// corrects itself (see `quality-correct.ts`): a corrected check says so in the
// list with "Stop correcting", and with the correction off its finding has a
// "Fix it" button in place of the steps.

import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { CORRECTABLE_CHECKS, formatRange, type DataQualityReport, type QualityFinding, type QualitySeverity } from '@/lib/adapters/quality';
import { findingMetricId, type SilencedFinding, type SilencedKey } from '@/lib/adapters/quality-silenced';
import type { CorrectableCheck } from '@/lib/adapters/quality-correct';
import type { PipelineQualityResponse, PipelineStatusReport } from '@/lib/pipeline/types';
import { Badge, BadgeSpinner, Skeleton } from '@/components/ui/primitives';

const SEVERITY: Record<QualitySeverity, { label: string; variant: 'warning' | 'info' | 'default'; icon: typeof CircleAlert; tone: string }> = {
  problem: { label: 'Problem', variant: 'warning', icon: CircleAlert, tone: 'text-category-attention' },
  warning: { label: 'Worth fixing', variant: 'warning', icon: TriangleAlert, tone: 'text-category-attention' },
  info: { label: 'Note', variant: 'info', icon: Info, tone: 'text-text-secondary' },
};

/**
 * The data-quality part of the pipeline panel. The checks run in the
 * background after the live data loads, so the pipeline report usually
 * arrives first: then this section says it is checking, waits on
 * /api/pipeline/quality on its own, and fills in when the result is ready —
 * the rest of the page never waits for it. `onReady` lets the panel refresh
 * the stage list once the result is in.
 */
export function DataQualitySection({
  report,
  onReady,
  checkKey = report.checkedAt,
}: {
  report: PipelineStatusReport;
  onReady?: () => void;
  /** Changes when the checks should be asked for afresh ("Check again"). */
  checkKey?: string | number;
}) {
  if (report.qualityState === 'unavailable') return null;
  if (report.qualityState === 'ready' && report.quality) {
    return <DataQuality quality={report.quality} silenced={report.silenced ?? []} onChanged={onReady} />;
  }
  return (
    <PendingDataQuality
      key={checkKey}
      initialFailure={report.qualityState === 'failed'}
      // While the dataset is still being read there is nothing to ask for yet.
      waiting={report.pending?.includes('dataset') ?? false}
      onReady={onReady}
    />
  );
}

function PendingDataQuality({ initialFailure, waiting = false, onReady }: { initialFailure: boolean; waiting?: boolean; onReady?: () => void }) {
  const [result, setResult] = useState<PipelineQualityResponse | null>(
    initialFailure ? { state: 'failed', quality: null, silenced: [], detail: 'The checks could not finish.' } : null
  );

  useEffect(() => {
    if (initialFailure || waiting) return;
    let cancelled = false;
    (async () => {
      // The route waits for the checks, up to a limit; ask again while they are still running.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const res = await fetch('/api/pipeline/quality', { cache: 'no-store' });
          if (!res.ok) throw new Error(`The quality endpoint answered HTTP ${res.status}.`);
          const body = (await res.json()) as PipelineQualityResponse;
          if (body.state === 'computing') continue;
          if (cancelled) return;
          setResult(body);
          if (body.state === 'ready') onReady?.();
          return;
        } catch (e) {
          if (!cancelled) setResult({ state: 'failed', quality: null, silenced: [], detail: e instanceof Error ? e.message : 'The checks could not be read.' });
          return;
        }
      }
      if (!cancelled) setResult({ state: 'computing', quality: null, silenced: [], detail: 'The checks are taking longer than usual. Use “Check again” in a minute.' });
    })();
    return () => {
      cancelled = true;
    };
  }, [initialFailure, waiting, onReady]);

  if (result?.state === 'ready' && result.quality) {
    return <DataQuality quality={result.quality} silenced={result.silenced} onChanged={onReady} />;
  }
  if (result?.state === 'unavailable') return null;

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="data-quality-heading" aria-busy={!result}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 id="data-quality-heading" className="text-sm font-semibold text-text-primary">
          Data quality
        </h3>
        {!result ? (
          <Badge variant="default" className="text-[10px]">
            <BadgeSpinner />
            Checking…
          </Badge>
        ) : (
          <Badge variant="warning" className="text-[10px]">{result.state === 'failed' ? 'Could not check' : 'Still checking'}</Badge>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-[11px] text-text-secondary leading-relaxed mb-4">
        {!result
          ? 'Checking the export’s records for activity counted twice, duplicate readings, missing days and a stalled automation. This runs in the background after your data loads; nothing else on the page waits for it.'
          : result.detail}
      </p>
      {!result && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton height={14} width="55%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={14} width="50%" />
        </div>
      )}
    </section>
  );
}

const keyId = (k: SilencedKey) => `${k.checkId}:${k.metricId}`;
const correctId = (checkId: CorrectableCheck) => `correct:${checkId}`;

/**
 * The data-quality report with Silence / Restore and Fix it / Stop correcting.
 * It does the calls and hands the refresh to `onChanged`, which reloads the
 * report quietly, so the panel does not blank out. The view below is a plain
 * function of its props.
 */
export function DataQuality({
  quality,
  silenced = [],
  onChanged,
}: {
  quality: DataQualityReport;
  silenced?: SilencedFinding[];
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (url: string, method: 'POST' | 'DELETE', body: object, busyKey: string) => {
      setBusy(busyKey);
      setError(null);
      try {
        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `The server answered HTTP ${res.status}.`);
        }
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The change could not be saved.');
      } finally {
        setBusy(null);
      }
    },
    [onChanged]
  );

  return (
    <DataQualityView
      quality={quality}
      silenced={silenced}
      busy={busy}
      error={error}
      onSilence={key => void send(SILENCE_URL, 'POST', silenceBody(key), keyId(key))}
      onRestore={key => void send(SILENCE_URL, 'DELETE', silenceBody(key), keyId(key))}
      onCorrect={(checkId, on) => void send(CORRECT_URL, on ? 'POST' : 'DELETE', { checkId }, correctId(checkId))}
    />
  );
}

const SILENCE_URL = '/api/pipeline/quality/silence';
const CORRECT_URL = '/api/pipeline/quality/correct';
const silenceBody = (key: SilencedKey) => (key.metricId ? key : { checkId: key.checkId });

export function DataQualityView({
  quality,
  silenced,
  busy = null,
  error = null,
  onSilence,
  onRestore,
  onCorrect = () => {},
}: {
  quality: DataQualityReport;
  silenced: SilencedFinding[];
  /** Key of the change in flight, when there is one. */
  busy?: string | null;
  error?: string | null;
  onSilence: (key: SilencedKey) => void;
  onRestore: (key: SilencedKey) => void;
  /** Turn a correction on ("Fix it") or off ("Stop correcting"). */
  onCorrect?: (checkId: CorrectableCheck, on: boolean) => void;
}) {
  const serious = quality.findings.filter(f => f.severity !== 'info').length;
  const notes = quality.findings.length - serious;
  const hiddenNow = silenced.some(s => s.found);
  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="data-quality-heading">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 id="data-quality-heading" className="text-sm font-semibold text-text-primary">
          Data quality
        </h3>
        <Badge variant={serious ? 'warning' : 'success'} className="text-[10px]">
          {serious
            ? `${serious} to fix`
            : quality.findings.length
              ? 'No recent problems'
              : hiddenNow
                ? 'No data-quality problems found'
                : 'All checks passed'}
        </Badge>
        {notes > 0 && (
          <Badge variant="info" className="text-[10px]">
            {notes} note{notes === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed mb-4">
        Checked on the export’s records as the server stores them, before Vital adds them up per day. Anything affecting
        only days more than 90 days ago is a note: recent figures are not affected. Activity counted twice and readings
        stored twice Vital corrects in its own totals; nothing here ever changes the export server. A silenced issue
        stays hidden for all of its days, including days that show up later.
      </p>

      {error && (
        <p role="alert" className="mb-3 text-[12px] text-category-attention">
          {error}
        </p>
      )}

      {quality.findings.length > 0 && (
        <ul className="space-y-3 list-none p-0 m-0 mb-5">
          {quality.findings.map((f, i) => (
            <Finding key={`${f.check}-${i}`} finding={f} busy={busy} onSilence={onSilence} onCorrect={onCorrect} />
          ))}
        </ul>
      )}

      <ul className="space-y-1.5 list-none p-0 m-0" aria-label="Checks that ran">
        {quality.checks.map(c => (
          <li key={c.id} className="flex items-start gap-2 text-[12px]">
            {c.outcome === 'pass' || c.outcome === 'corrected' ? (
              <CircleCheck size={14} className="mt-0.5 shrink-0 text-category-activity" aria-hidden="true" />
            ) : c.outcome === 'note' ? (
              <Info size={14} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
            ) : (
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
            )}
            <span>
              <span className="font-medium text-text-primary">{c.label}</span>
              <span className="sr-only">
                {c.outcome === 'pass' ? ': passed' : c.outcome === 'corrected' ? ': corrected by Vital' : c.outcome === 'note' ? ': note' : ': flagged'}
              </span>
              <span className="text-text-secondary"> — {c.summary}</span>
              {c.outcome === 'corrected' && isCorrectable(c.id) && (
                <span className="block mt-0.5 text-[11px] text-text-secondary">
                  Vital leaves these records out of its own totals; your export server is not changed.{' '}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60"
                    disabled={busy !== null}
                    aria-label={`Stop correcting: ${c.label}`}
                    onClick={() => onCorrect(c.id as CorrectableCheck, false)}
                  >
                    {busy === correctId(c.id as CorrectableCheck) ? 'Stopping…' : 'Stop correcting'}
                  </button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {silenced.length > 0 && <SilencedList silenced={silenced} busy={busy} onRestore={onRestore} onCorrect={onCorrect} />}
    </section>
  );
}

function SilencedList({
  silenced,
  busy,
  onRestore,
  onCorrect,
}: {
  silenced: SilencedFinding[];
  busy: string | null;
  onRestore: (key: SilencedKey) => void;
  onCorrect: (checkId: CorrectableCheck, on: boolean) => void;
}) {
  return (
    <details className="mt-5 group" data-silenced-issues>
      <summary className="cursor-pointer text-[12px] font-medium text-text-primary">Silenced issues ({silenced.length})</summary>
      <ul className="mt-2 space-y-2 list-none p-0 m-0">
        {silenced.map(s => {
          const key = { checkId: s.checkId, metricId: s.metricId };
          return (
            <li key={keyId(key)} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-border p-3 text-[12px]">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-text-primary">{s.title}</span>
                {s.metricLabel && <span className="text-text-secondary"> · {s.metricLabel}</span>}
                <span className="block text-[11px] text-text-secondary tnum">
                  {s.found
                    ? s.firstDay && s.lastDay
                      ? s.firstDay === s.lastDay
                        ? `Seen ${s.firstDay}`
                        : `Seen ${s.firstDay} to ${s.lastDay}`
                      : 'Hidden while it lasts'
                    : 'Not found right now; it stays hidden if it comes back'}
                </span>
              </span>
              {/* A silenced issue Vital can correct can still be fixed from here (which also lifts the silence). */}
              {s.found && isCorrectable(s.checkId) && (
                <button
                  type="button"
                  className="shrink-0 rounded-control bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-text hover:opacity-90 disabled:opacity-60"
                  disabled={busy !== null}
                  aria-label={`Fix it: ${s.title}`}
                  onClick={() => onCorrect(s.checkId as CorrectableCheck, true)}
                >
                  {busy === correctId(s.checkId as CorrectableCheck) ? 'Fixing…' : 'Fix it'}
                </button>
              )}
              <button
                type="button"
                className="shrink-0 rounded-control border border-border px-2.5 py-1 text-[12px] font-medium text-primary disabled:opacity-60"
                disabled={busy !== null}
                aria-label={`Restore: ${s.title}${s.metricLabel ? `, ${s.metricLabel}` : ''}`}
                onClick={() => onRestore(key)}
              >
                {busy === keyId(key) ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const isCorrectable = (id: string): id is CorrectableCheck => (CORRECTABLE_CHECKS as readonly string[]).includes(id);

function Finding({
  finding: f,
  busy,
  onSilence,
  onCorrect,
}: {
  finding: QualityFinding;
  busy: string | null;
  onSilence: (key: SilencedKey) => void;
  onCorrect: (checkId: CorrectableCheck, on: boolean) => void;
}) {
  const s = SEVERITY[f.severity];
  const Icon = s.icon;
  const key = { checkId: f.check, metricId: findingMetricId(f) };
  return (
    <li className="rounded-control border border-border bg-surface-muted/40 p-4">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{f.title}</span>
            <Badge variant={s.variant} className="text-[10px]">{s.label}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-text-secondary leading-relaxed">{f.detail}</p>
          {f.ranges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Affected days">
              {f.ranges.map(r => (
                <span key={`${r.from}-${r.to}`} className="rounded-full border border-border px-2 py-0.5 text-[10px] tnum text-text-secondary">
                  {formatRange(r)}
                  {r.days > 1 ? ` · ${r.days} days` : ''}
                </span>
              ))}
            </div>
          )}
          {f.correctable && isCorrectable(f.check) ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="rounded-control bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-text hover:opacity-90 disabled:opacity-60"
                  disabled={busy !== null}
                  aria-label={`Fix it: ${f.title}`}
                  onClick={() => onCorrect(f.check as CorrectableCheck, true)}
                >
                  {busy === correctId(f.check as CorrectableCheck) ? 'Fixing…' : 'Fix it'}
                </button>
                <span className="text-[11px] text-text-secondary">
                  Vital leaves the repeated records out of its own totals. Your export server is not changed.
                </span>
              </div>
              {f.remedy[0] && <p className="mt-2 text-[11px] text-text-secondary leading-relaxed">To keep it from happening again: {f.remedy[0]}</p>}
            </div>
          ) : (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-[12px] font-medium text-primary">How to fix it</summary>
              <ol className="mt-2 ml-4 list-decimal space-y-1.5 text-[12px] text-text-secondary leading-relaxed">
                {f.remedy.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              className="rounded-control border border-border px-2.5 py-1 text-[12px] font-medium text-text-primary disabled:opacity-60"
              disabled={busy !== null}
              aria-label={`Silence: ${f.title}`}
              onClick={() => onSilence(key)}
            >
              {busy === keyId(key) ? 'Silencing…' : 'Silence'}
            </button>
            <span className="text-[11px] text-text-secondary">Stop showing this as an issue. You can restore it below.</span>
          </div>
        </div>
      </div>
    </li>
  );
}

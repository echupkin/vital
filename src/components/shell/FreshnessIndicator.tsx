'use client';

import { useState } from 'react';
import { Database, RefreshCw, CircleDashed, CircleCheck, CircleAlert, CircleSlash, LoaderCircle } from 'lucide-react';
import { Dialog, Badge, BadgeSpinner, Button, ErrorState } from '@/components/ui/primitives';
import type { StageStatus } from '@/lib/pipeline/types';
import { usePipelineReport } from '@/components/settings/usePipelineReport';
import { STAGE_STATUS_LABEL } from '@/lib/pipeline/types';

function StageIcon({ status }: { status: StageStatus }) {
  if (status === 'healthy') return <CircleCheck size={15} className="text-category-activity shrink-0" aria-hidden="true" />;
  if (status === 'degraded') return <CircleAlert size={15} className="text-category-attention shrink-0" aria-hidden="true" />;
  if (status === 'unconfigured') return <CircleSlash size={15} className="text-text-secondary shrink-0" aria-hidden="true" />;
  if (status === 'checking') return <LoaderCircle size={15} className="text-primary shrink-0 motion-safe:animate-spin" aria-hidden="true" />;
  return <CircleDashed size={15} className="text-text-secondary shrink-0" aria-hidden="true" />;
}

function StageBadge({ status }: { status: StageStatus }) {
  const variant = status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'default';
  // The state is written out, never conveyed by colour alone.
  return <Badge variant={variant} className="text-[10px]">{STAGE_STATUS_LABEL[status]}</Badge>;
}

/**
 * Data freshness control. Opening it loads the pipeline status from the
 * server-side route, which reads the Health Auto Export configuration from the
 * server environment. In demo mode every upstream stage reports unknown or not
 * configured — never healthy — and a failed check is shown as an explicit error
 * instead of being replaced with demo data.
 */
export function FreshnessIndicator() {
  const [open, setOpen] = useState(false);
  // Checked part by part once the dialog first opens; each stage fills in as its own check answers.
  const { report, error, load } = usePipelineReport({ enabled: open });
  const live = report.mode === 'live';
  const checking = (part: 'sources' | 'dataset') => report.pending.includes(part);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-control hover:bg-surface-muted transition-colors min-h-[36px]"
        aria-label="Data status and pipeline"
        title="Data status"
      >
        <RefreshCw size={13} aria-hidden="true" />
        <span className="hidden sm:inline">Data status</span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Data pipeline">
        {/* ── Error ───────────────────────────────── */}
        {error && (
          <ErrorState
            title="The pipeline status is unavailable"
            message={`${error} No live status is assumed in its place.`}
            onRetry={() => void load()}
          />
        )}

        {/* ── Report ──────────────────────────────── */}
        {!error && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4" role="status" aria-live="polite">
              {checking('sources') ? (
                <Badge variant="default">
                  <BadgeSpinner />
                  Checking…
                </Badge>
              ) : (
                <Badge variant={live ? 'success' : 'accent'}>{live ? 'Live source configured' : 'Demo mode'}</Badge>
              )}
              <span className="text-xs text-text-secondary">{report.summary}</span>
            </div>

            <ol className="space-y-3 list-none p-0 m-0">
              {report.stages.map((stage, i) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <StageIcon status={stage.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{stage.name}</span>
                      <StageBadge status={stage.status} />
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">{stage.detail}</p>
                    {stage.observationCount != null && (
                      <p className="text-[10px] text-text-secondary leading-relaxed mt-0.5 tnum">
                        {stage.observationCount} observation(s)
                        {stage.lastObservationAt ? ` · newest ${stage.lastObservationAt.slice(0, 10)}` : ''}
                      </p>
                    )}
                    <p className="text-[10px] text-text-secondary leading-relaxed mt-0.5">
                      Derived from: {stage.derivedFrom}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-secondary tnum">{i + 1}</span>
                </li>
              ))}
            </ol>

            <div className="flex items-start gap-2 mt-5 pt-4 border-t border-border text-[11px] text-text-secondary">
              <Database size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1 leading-relaxed">
                <p>
                  A stage is marked healthy only when a real check confirmed it. Checking… means its check is still
                  running. Unknown means nothing could be confirmed, and it is the correct state for every upstream
                  stage in demo mode.
                </p>
                {checking('dataset') ? (
                  <p>Dataset: still checking.</p>
                ) : (
                  <p>
                    Dataset: {report.dataset.source === 'live' ? 'live history' : 'demo data'} ·{' '}
                    {report.dataset.observationCount} daily observations across {report.dataset.metricCount} metrics ·{' '}
                    coverage {report.dataset.windowStartKey} → {report.dataset.referenceKey} · newest observation{' '}
                    {report.dataset.lastObservationAt ?? 'unknown'} · checked {report.checkedAt}. Imported records are
                    read-only in this build: this pipeline sends nothing upstream, and no background ingestion job
                    exists.
                    The live dataset is refreshed only by a read-only cache warm-up at process start and by
                    stale-while-revalidate once the cache TTL lapses.
                  </p>
                )}
                {report.dataset.error && (
                  <p className="text-category-attention">Dataset load problem: {report.dataset.error}</p>
                )}
                {report.probe.attempted && (
                  <p>
                    Read probe: GET /api/metrics/{report.probe.metric} → {report.probe.outcome}
                    {report.probe.httpStatus != null ? ` (HTTP ${report.probe.httpStatus})` : ''} in{' '}
                    {report.probe.durationMs ?? '—'} ms, {report.probe.records ?? 0} record(s).
                  </p>
                )}
                {!checking('dataset') && (
                  <p>
                    Cache: {report.cache.keys} key(s), TTL {report.cache.ttlSeconds}s, age{' '}
                    {report.cache.ageMs == null ? 'n/a' : `${Math.round(report.cache.ageMs / 1000)}s`}, {' '}
                    {report.cache.hits} hit(s) / {report.cache.misses} miss(es). One upstream pass serves
                    concurrent page loads, and a lapsed TTL serves the held dataset while it refreshes in the
                    background.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => load({ fresh: true })}>
                <RefreshCw size={12} aria-hidden="true" />
                <span className="ml-1.5">Check again</span>
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

'use client';

// ── Settings → Connections ──────────────────────────────────────────────────
//
// The data pipeline: each stage's status, and the data-quality section with its
// findings, Silence and Silenced issues. Nothing else lives on this tab.

import { useCallback } from 'react';
import { Database } from 'lucide-react';
import { Badge, BadgeSpinner, Button, Card, DataStateNote, ErrorState } from '@/components/ui/primitives';
import { STAGE_STATUS_LABEL, type StageStatus } from '@/lib/pipeline/types';
import { DataQualitySection } from './DataQuality';
import { SectionHead } from './SectionHead';
import { usePipelineReport } from './usePipelineReport';

export function ConnectionsTab() {
  const { report, error, load, refreshQuietly, loads } = usePipelineReport();
  const checking = (part: 'sources' | 'dataset') => report.pending.includes(part);
  // Stable, so the data-quality section does not restart its wait on every render.
  const refreshDataset = useCallback(() => refreshQuietly(['dataset']), [refreshQuietly]);

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SectionHead icon={<Database size={18} className="text-text-secondary" />} title="Data pipeline" />
          <Button
            variant="secondary"
            size="sm"
            title="Read the data from every source again, instead of the copy the server holds"
            onClick={() => load({ fresh: true })}
          >
            Check again
          </Button>
        </div>

        {error && (
          <ErrorState
            title="The pipeline status could not be read"
            message={`${error} No live status is being assumed in its place.`}
            onRetry={() => void load()}
          />
        )}

        {!error && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4" role="status" aria-live="polite">
              {checking('sources') ? (
                <Badge variant="default">
                  <BadgeSpinner />
                  Checking…
                </Badge>
              ) : (
                <Badge variant={report.mode === 'live' ? 'success' : 'accent'}>
                  {report.mode === 'live' ? 'Live source configured' : 'Demo mode'}
                </Badge>
              )}
              <span className="text-xs text-text-secondary">{report.summary}</span>
            </div>
            <ol className="space-y-3 list-none p-0 m-0">
              {report.stages.map((stage, i) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <StageDot status={stage.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{stage.name}</span>
                      <StageLabel status={stage.status} />
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">{stage.detail}</p>
                    <p className="text-[10px] text-text-secondary leading-relaxed mt-0.5">
                      How this status was derived: {stage.derivedFrom}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-secondary tnum">{i + 1}</span>
                </li>
              ))}
            </ol>
            <DataQualitySection report={report} onReady={refreshDataset} checkKey={loads} />
            <div className="mt-4">
              <DataStateNote>
                A stage is marked healthy only when its status is known from a real check. Checking… means its check is
                still running; each stage fills in as soon as its own check is done. Unknown is a valid state and is
                used wherever nothing can be confirmed.{' '}
                {checking('dataset') ? 'Data as of: still checking.' : `Data as of ${report.dataAsOf}; checked ${report.checkedAt}.`}
              </DataStateNote>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export function StageDot({ status }: { status: StageStatus }) {
  const tone =
    status === 'healthy'
      ? 'bg-category-activity'
      : status === 'degraded'
        ? 'bg-category-attention'
        : status === 'checking'
          ? 'bg-primary motion-safe:animate-pulse'
          : 'bg-border';
  return <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${tone}`} aria-hidden="true" />;
}

export function StageLabel({ status }: { status: StageStatus }) {
  const variant = status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'default';
  // The word is part of the label, so the state is never conveyed by colour alone.
  return (
    <Badge variant={variant} className="text-[10px]">
      {status === 'checking' && <BadgeSpinner />}
      {STAGE_STATUS_LABEL[status]}
    </Badge>
  );
}

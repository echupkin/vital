'use client';

// ── /lab/[analyteKey] — one analyte, its whole imported history ─────────────
//
// Follows the conventions of `MetricDetailPage.tsx`: a back link, a header with
// the latest value and its status, explicit data-state notes, a range control
// over the view, a chart, and the accessible table alternative behind a
// chart/table switch.
//
// WHAT IS DIFFERENT, and must be: every row here is an IMPORTED RECORD. Each row
// names its source document and that document's date, the name the document
// printed, the pass that read it, and the interval exactly as printed. When a
// row carries no status, the row says why — including the case where a
// sex-specific interval would be needed and Sex is unset.
//
// An unknown key is an honest not-found state with real advice, never a crash.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { analyteByKey } from '@/lib/lab/analytes';
import {
  fetchLabDocuments,
  fetchLabSummary,
  fetchProvenance,
  type RowProvenance,
} from '@/lib/lab/client-data';
import {
  changeFromPrevious,
  chartDescription,
  chartDomain,
  chartModel,
  filterByRange,
  formatReading,
  intervalProvenance,
  latestPoint,
  orderedPoints,
  relatedAnalytes,
  summariseDocuments,
  unscoredReason,
  type LabAnalyte,
  type LabProfileFacts,
  type LabReportDocument,
  type LabSummary,
} from '@/lib/lab/view';
import {
  Badge,
  Card,
  DataStateNote,
  ErrorState,
  InsufficientDataState,
  LoadingState,
  SegmentedControl,
} from '@/components/ui/primitives';
import { LabChart, LabObservationTable } from '@/components/charts';
import { LabNotices, LabStatusBadge, needsSexNotice, observationRows } from './LabShared';

const RANGE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1825', label: '5Y' },
  { value: '365', label: '1Y' },
  { value: '90', label: '90D' },
  { value: '30', label: '30D' },
];

interface LoadedLab {
  summary: LabSummary;
  documents: LabReportDocument[];
  provenance: Map<string, RowProvenance>;
}

interface LabState {
  loading: boolean;
  error: string | null;
  data: LoadedLab | null;
}

export function LabDetailPage() {
  const params = useParams();
  const rawKey = params?.analyteKey;
  const analyteKey = decodeURIComponent(Array.isArray(rawKey) ? (rawKey[0] ?? '') : (rawKey ?? ''));

  const [state, setState] = useState<LabState>({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const [summary, documents] = await Promise.all([fetchLabSummary(), fetchLabDocuments()]);
      const provenance = await fetchProvenance(documents.documents.map(document => document.id));
      setState({
        loading: false,
        error: null,
        data: { summary, documents: documents.documents, provenance },
      });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : 'The stored lab results could not be read.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <LoadingState label="Reading the stored lab results" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState
          title="The stored lab results could not be read"
          message={`${state.error ?? 'No lab series was returned.'} Nothing is shown in its place.`}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return <LabDetailContent analyteKey={analyteKey} data={state.data} />;
}

function BackLink() {
  return (
    <Link
      href="/lab"
      className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors min-h-[44px]"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      <span>All lab results</span>
    </Link>
  );
}

function LabDetailContent({ analyteKey, data }: { analyteKey: string; data: LoadedLab }) {
  const { summary, documents, provenance } = data;
  const profile: LabProfileFacts = summary.profile;
  const registry = analyteByKey(analyteKey);
  const analyte = summary.analytes.find(entry => entry.analyteKey === analyteKey) ?? null;

  // ── An honest not-found state ────────────────────────────────────────────
  if (!analyte && !registry) {
    return (
      <div className="space-y-6">
        <BackLink />
        <InsufficientDataState
          metricName="this analyte"
          message={`No analyte is registered under the key "${analyteKey}", and no imported result uses it either. The link may be out of date, or the key may be misspelled.`}
        />
        <div>
          <Link href="/lab" className="text-sm text-primary hover:underline">
            Return to the lab results
          </Link>
        </div>
      </div>
    );
  }

  const displayName = analyte?.displayName ?? registry?.displayName ?? analyteKey;
  const category = analyte?.category ?? registry?.category ?? 'Other';

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Badge variant="default" className="text-[10px]">{category}</Badge>
          <Badge variant={registry ? 'accent' : 'warning'} className="text-[10px]">
            {registry ? 'In the reference registry' : 'Not in the reference registry'}
          </Badge>
          {analyte && (
            <Badge variant="default" className="text-[10px]">
              {analyte.points.length} imported observation{analyte.points.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold text-text-primary">{displayName}</h1>
        <p className="text-xs text-text-secondary mt-1">
          Imported from PDFs you uploaded — never measured by Vital.
          {registry?.unit ? ` Registry unit: ${registry.unit}.` : ''}
        </p>
      </header>

      {!summary.available && (
        <Card className="p-5">
          <DataStateNote tone="attention">
            {summary.reason ?? 'The lab store is not available, so no lab results can be read here.'} Nothing is
            shown in their place.
          </DataStateNote>
        </Card>
      )}

      {!analyte && (
        <Card className="p-5">
          <InsufficientDataState
            metricName={displayName}
            message={`No imported document contains a result for ${displayName}. Nothing is substituted — no value and no chart are shown. Import a report that includes it and this page fills in.`}
          />
          {registry?.note && (
            <DataStateNote>{registry.note}</DataStateNote>
          )}
          <div className="mt-3">
            <Link href="/settings?tab=data" className="text-sm text-primary hover:underline">
              Open Settings → Data &amp; coverage
            </Link>
          </div>
        </Card>
      )}

      {analyte && (
        <AnalyteHistory
          analyte={analyte}
          profile={profile}
          provenance={provenance}
          documents={documents}
          presentKeys={summary.analytes.map(entry => entry.analyteKey)}
          category={category}
        />
      )}

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-text-secondary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-text-primary">How this value was scored</h2>
        </div>
        <LabNotices />
      </Card>
    </div>
  );
}

function AnalyteHistory({
  analyte,
  profile,
  provenance,
  documents,
  presentKeys,
  category,
}: {
  analyte: LabAnalyte;
  profile: LabProfileFacts;
  provenance: Map<string, RowProvenance>;
  documents: LabReportDocument[];
  presentKeys: string[];
  category: LabAnalyte['category'];
}) {
  const [range, setRange] = useState('all');
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const allPoints = useMemo(() => orderedPoints(analyte), [analyte]);
  const days = range === 'all' ? null : Number(range);
  const points = useMemo(() => filterByRange(allPoints, days), [allPoints, days]);
  const rangedAnalyte = useMemo<LabAnalyte>(() => ({ ...analyte, points }), [analyte, points]);

  const model = useMemo(() => chartModel(rangedAnalyte), [rangedAnalyte]);
  const change = useMemo(() => changeFromPrevious(rangedAnalyte), [rangedAnalyte]);
  const latest = latestPoint(rangedAnalyte);
  const rows = useMemo(() => observationRows(rangedAnalyte, provenance, profile), [rangedAnalyte, provenance, profile]);
  const related = useMemo(
    () => relatedAnalytes(analyte.analyteKey, category, presentKeys),
    [analyte.analyteKey, category, presentKeys]
  );
  const docSummary = useMemo(() => summariseDocuments(documents), [documents]);

  // Which imported documents hold this analyte, and how many observations each
  // contributed — the history across documents, stated rather than implied.
  const perDocument = useMemo(() => {
    return documents
      .map(document => ({
        document,
        count: allPoints.filter(point => point.reportId === document.id).length,
      }))
      .filter(entry => entry.count > 0);
  }, [documents, allPoints]);

  if (!latest) {
    return (
      <Card className="p-5">
        <DataStateNote>No observation falls inside this range.</DataStateNote>
      </Card>
    );
  }

  const interval = intervalProvenance(latest.interval);
  const reason = unscoredReason(analyte, latest, profile);
  const sexNotice = needsSexNotice(analyte, profile);

  return (
    <>
      {/* ── Header facts ───────────────────────────────── */}
      <section aria-label="Latest observation">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Latest value</div>
            <div className="text-2xl font-semibold tnum text-text-primary leading-none">
              {formatReading(latest)}
            </div>
            <div className="text-[10px] text-text-secondary mt-1">{formatDayKeyLong(latest.resultOn)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Status</div>
            <LabStatusBadge label={latest.statusLabel} tone={latest.tone} />
            <div className="text-[10px] text-text-secondary mt-1">
              {points.length} observation{points.length === 1 ? '' : 's'} in this range
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Interval</div>
            <div className="text-sm font-medium tnum text-text-primary">{interval.refText ?? 'none'}</div>
            <div className="text-[10px] text-text-secondary mt-1">{interval.text}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1">Change</div>
            <div className="text-sm font-medium tnum text-text-primary">
              {change === null
                ? 'no observations'
                : change.kind === 'first'
                  ? 'First observation'
                  : change.kind === 'numeric'
                    ? change.deltaText
                    : 'not comparable'}
            </div>
            <div className="text-[10px] text-text-secondary mt-1">
              {change?.kind === 'numeric'
                ? `since ${formatDayKeyLong(change.from.resultOn)}, ${change.windowText}`
                : change?.kind === 'first'
                  ? 'no earlier value to compare with'
                  : change?.kind === 'unavailable'
                    ? 'one side is not a number'
                    : '—'}
            </div>
          </Card>
        </div>

        <div className="mt-3 space-y-1.5">
          {interval.note && <DataStateNote>{interval.note}</DataStateNote>}
          {reason && (
            <DataStateNote tone="attention">
              The latest observation is not scored. {reason}
            </DataStateNote>
          )}
          {sexNotice && !(reason ?? '').includes('Sex in Settings') && (
            <DataStateNote tone="attention">
              This analyte&rsquo;s reference intervals are sex-specific and Sex is not set, so none is applied and
              the results stay unscored rather than banded on an assumption. Set Sex in{' '}
              <Link href="/settings?tab=account" className="text-primary hover:underline">
                Settings → Account
              </Link>
              .
            </DataStateNote>
          )}
          <DataStateNote>
            {docSummary.count} document{docSummary.count === 1 ? '' : 's'} imported
            {docSummary.firstOn && docSummary.lastOn
              ? `, covering result dates ${docSummary.firstOn} → ${docSummary.lastOn}`
              : ', with no result dates recorded'}
            {docSummary.newestDocumentDate
              ? `. Newest document date ${docSummary.newestDocumentDate}.`
              : '. No document printed a date of its own.'}{' '}
            Each row below is one stored observation and keeps its own document date.
          </DataStateNote>
        </div>
      </section>

      {/* ── Range control ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} ariaLabel="Observation range" />
        <div className="flex rounded-control overflow-hidden border border-border">
          <button
            type="button"
            onClick={() => setView('chart')}
            aria-pressed={view === 'chart'}
            className={`px-3 py-2 text-xs font-medium min-h-[44px] ${
              view === 'chart' ? 'bg-surface text-text-primary' : 'bg-surface-muted text-text-secondary'
            }`}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            aria-pressed={view === 'table'}
            className={`px-3 py-2 text-xs font-medium min-h-[44px] ${
              view === 'table' ? 'bg-surface text-text-primary' : 'bg-surface-muted text-text-secondary'
            }`}
          >
            Table
          </button>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary -mt-3">
        The range is measured back from the newest observation ({formatDayKeyLong(allPoints[allPoints.length - 1]!.resultOn)}
        ), never from today — a document imported long after it was produced still appears.
      </p>

      {/* ── Chart or table ─────────────────────────────── */}
      <Card className="p-4 md:p-6">
        {view === 'chart' ? (
          <>
            <LabChart
              analyteName={analyte.displayName}
              model={model}
              height={280}
              domain={chartDomain(model)}
            />
            <p className="sr-only">{chartDescription(analyte.displayName, model)}</p>
            <div className="mt-3">
              <LabObservationTable
                rows={rows}
                caption={`The same observations as the chart: ${analyte.displayName}, oldest first`}
              />
            </div>
          </>
        ) : (
          <LabObservationTable
            rows={rows}
            caption={`Every stored observation of ${analyte.displayName}, oldest first, with its provenance`}
            showProvenance
          />
        )}
      </Card>

      {/* ── History across documents ───────────────────── */}
      <section aria-label="History across documents">
        <h2 className="text-sm font-semibold text-text-primary mb-3">History across documents</h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Documents holding this analyte">
          <table className="w-full text-sm text-left min-w-[560px]">
            <caption className="text-left text-xs text-text-secondary mb-2">
              Every imported document that contains {analyte.displayName}
            </caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Document</th>
                <th scope="col" className="py-2 pr-4 font-medium">Document date</th>
                <th scope="col" className="py-2 pr-4 font-medium">Laboratory</th>
                <th scope="col" className="py-2 font-medium">Observations of this analyte</th>
              </tr>
            </thead>
            <tbody>
              {perDocument.map(entry => (
                <tr key={entry.document.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text-primary break-all">{entry.document.sourceFilename}</td>
                  <td className="py-2 pr-4 text-text-secondary tnum">
                    {entry.document.documentDate ?? 'none printed'}
                  </td>
                  <td className="py-2 pr-4 text-text-secondary">{entry.document.labName ?? 'not named'}</td>
                  <td className="py-2 text-text-secondary tnum">{entry.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Related analytes ───────────────────────────── */}
      {related.length > 0 && (
        <section aria-label="Related analytes">
          <h2 className="text-sm font-semibold text-text-primary mb-3">Related analytes in {category}</h2>
          <div className="flex flex-wrap gap-2">
            {related.map(key => (
              <Link
                key={key}
                href={`/lab/${key}`}
                className="px-3 py-2 min-h-[44px] inline-flex items-center text-xs font-medium bg-surface-muted text-text-secondary hover:text-text-primary hover:bg-surface border border-border rounded-control transition-colors"
              >
                {analyteByKey(key)?.displayName ?? key}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
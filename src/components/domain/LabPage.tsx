'use client';

// ── /lab — imported lab results ─────────────────────────────────────────────
//
// WHAT THIS PAGE IS. A view of lab values the owner IMPORTED from PDFs, scored
// against the reference interval each value was read against: the interval the
// report itself printed (which always wins), or a cited fallback interval when
// the report printed none. Nothing here was measured by Vital, nothing is
// corrected toward a nicer number, and nothing is invented when a value is
// missing.
//
// WHAT THIS PAGE MAY NOT DO. No health score, no percentage, no gauge, no red
// banner, no "normal/abnormal" verdict, no diagnosis and no safety claim: the
// summary strip counts observations by status and says that is all it is. A
// missing value is never rendered as 0, and two observations sharing a date are
// never merged into one point.
//
// NO SOURCE DOCUMENT IS NAMED HERE. Each card shows the observation's own date —
// the date the owner cares about — and the documents are listed in
// Settings → Data & coverage. There is no cross-document comparison section:
// the date-stamped history per analyte is the aggregate that matters.
//
// THE EMPTY STATE IS THE HONEST DEFAULT TODAY: with no document imported the
// page says so and offers the way to add one, rather than showing a wall of
// zeroes.
//
// The decisions (grouping, ordering, counts, deltas and the chart shape) live in
// `@/lib/lab/view` as pure functions with their own tests; this file is the
// presentation over them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronRight, FlaskConical, Info } from 'lucide-react';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import {
  fetchLabDocuments,
  fetchLabSummary,
  fetchProvenance,
  type RowProvenance,
} from '@/lib/lab/client-data';
import {
  BUCKET_LABEL,
  changeFromPrevious,
  chartModel,
  countStatuses,
  groupAnalytes,
  hasDocumentsWithoutResults,
  hasNoDocuments,
  intervalProvenance,
  latestPoint,
  orderedPoints,
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
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/components/ui/primitives';
import { LabChart, LabChartFacts, LabObservationTable } from '@/components/charts';
import { DomainHeader, SectionTitle } from './DomainShared';
import { LabNotices, LabStatusBadge, observationRows, needsSexNotice } from './LabShared';

// ── State ───────────────────────────────────────────────────────────────────

interface LoadedLab {
  summary: LabSummary;
  documents: LabReportDocument[];
  documentsAvailable: boolean;
  documentsReason: string | null;
  provenance: Map<string, RowProvenance>;
}

interface LabState {
  loading: boolean;
  error: string | null;
  data: LoadedLab | null;
}

export function LabPage() {
  const [state, setState] = useState<LabState>({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const [summary, documents] = await Promise.all([fetchLabSummary(), fetchLabDocuments()]);
      // Provenance for every stored row: the printed name, the flag and the
      // extraction pass the series read model does not carry. NO document name
      // is read here — the Lab surfaces name no source document.
      const provenance = await fetchProvenance(documents.documents.map(document => document.id));
      setState({
        loading: false,
        error: null,
        data: {
          summary,
          documents: documents.documents,
          documentsAvailable: documents.available,
          documentsReason: documents.reason,
          provenance,
        },
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
        <DomainHeader
          title="Lab"
          subtitle="Lab values imported from PDFs you uploaded, scored against the interval each document printed."
        />
        <LoadingState label="Reading the stored lab results" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="space-y-6">
        <DomainHeader
          title="Lab"
          subtitle="Lab values imported from PDFs you uploaded, scored against the interval each document printed."
        />
        <ErrorState
          title="The stored lab results could not be read"
          message={`${state.error ?? 'No lab series was returned.'} Nothing is shown in their place — no zeroes, no placeholder rows.`}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return <LabContent data={state.data} />;
}

// ── The page ────────────────────────────────────────────────────────────────

function LabContent({ data }: { data: LoadedLab }) {
  const { summary, documents, provenance } = data;
  const profile: LabProfileFacts = summary.profile;
  const analytes = summary.analytes;
  const docSummary = summariseDocuments(documents);

  const groups = useMemo(() => groupAnalytes(analytes), [analytes]);
  const counts = useMemo(() => countStatuses(analytes), [analytes]);
  const sexNotice = useMemo(
    () => analytes.filter(analyte => needsSexNotice(analyte, profile)),
    [analytes, profile]
  );

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Lab"
        subtitle="Lab values imported from PDFs you uploaded, scored against the interval each document printed."
      >
        <Badge variant="default" className="text-[10px]">
          {docSummary.count} document{docSummary.count === 1 ? '' : 's'} imported
        </Badge>
      </DomainHeader>

      {!summary.available && (
        <Card className="p-5">
          <DataStateNote tone="attention">
            {summary.reason ??
              'The lab store is not available, so no lab results can be read here.'}{' '}
            Nothing is shown in their place.
          </DataStateNote>
        </Card>
      )}

      {/* ── Empty state: the honest default today ───────── */}
      {hasNoDocuments(documents) && (
        <Card className="p-6">
          <EmptyState
            icon={<FlaskConical size={26} aria-hidden="true" />}
            title="No lab documents imported yet"
            description="Vital does not measure blood work. Upload a lab report PDF and its results appear here, per analyte, scored against the reference interval the document itself printed. Until one is imported there is nothing to show — no zeroes, no empty charts."
            action={
              <Link
                href="/settings?tab=data"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-control bg-primary text-primary-text text-sm font-medium hover:opacity-90"
              >
                Open Settings → Data &amp; coverage
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            }
          />
          <div className="mt-6 border-t border-border pt-4 space-y-3">
            <DataStateNote>
              {data.documentsAvailable
                ? 'No document is stored. Nothing was imported, so nothing is missing or hidden.'
                : data.documentsReason ??
                  'The stored documents could not be listed, so this page cannot say whether any were imported.'}
            </DataStateNote>
            <LabNotices />
          </div>
        </Card>
      )}

      {/* ── Documents imported, but no observation in them ─ */}
      {hasDocumentsWithoutResults(documents, analytes) && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-2">
            {documents.length} document{documents.length === 1 ? '' : 's'} imported, no lab values in them
          </h2>
          <DataStateNote>
            The import produced no observation, so there is nothing to score. An order form has no values at all;
            a scan has no text layer to read. The documents themselves are listed in Settings → Data &amp; coverage.
          </DataStateNote>
        </Card>
      )}

      {analytes.length > 0 && (
        <>
          {/* ── Header facts ──────────────────────────── */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-text-primary mb-3">What is on this page</h2>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Fact
                label="Documents imported"
                value={`${docSummary.count}`}
                sub={docSummary.labNames.length > 0 ? docSummary.labNames.join(', ') : 'no laboratory named'}
              />
              <Fact
                label="Result dates"
                value={
                  docSummary.firstOn && docSummary.lastOn
                    ? docSummary.firstOn === docSummary.lastOn
                      ? docSummary.firstOn
                      : `${docSummary.firstOn} → ${docSummary.lastOn}`
                    : 'none recorded'
                }
                sub="the date each value belongs to, never the document's date"
              />
              <Fact
                label="Newest document date"
                value={docSummary.newestDocumentDate ?? 'none printed'}
                sub="the date the document itself carries"
              />
              <Fact
                label="Observations"
                value={`${summary.totalObservations}`}
                sub={`${analytes.length} analyte${analytes.length === 1 ? '' : 's'}`}
              />
            </dl>
            <div className="mt-4">
              <DataStateNote>
                These values were <strong className="font-medium text-text-primary">imported from PDFs</strong> you
                uploaded — Vital did not measure them. Each observation keeps the date of the column it was printed
                under, so several documents over time line up on one history.
              </DataStateNote>
            </div>
            {summary.collisions > 0 && (
              <div className="mt-2">
                <DataStateNote tone="attention">
                  {summary.collisions} result date{summary.collisions === 1 ? '' : 's'} carr
                  {summary.collisions === 1 ? 'ies' : 'y'} more than one observation for the same analyte. Both are
                  kept and shown as separate points — different assays or laboratories legitimately report the same
                  analyte on one day — and neither is discarded.
                </DataStateNote>
              </div>
            )}
          </Card>

          {/* ── Summary strip: counts only ────────────── */}
          <section aria-label="Observations by status">
            <SectionTitle hint={`counted over ${counts.total} imported observations`}>
              Observations by status
            </SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <CountCard label={BUCKET_LABEL.in_range} count={counts.inRange} />
              <CountCard label={BUCKET_LABEL.slightly_out} count={counts.slightlyOut} />
              <CountCard label={BUCKET_LABEL.out} count={counts.out} />
              <CountCard label={BUCKET_LABEL.unscored} count={counts.unscored} />
            </div>
            <div className="mt-3">
              <DataStateNote>
                These are counts, not a score: no percentage, no grade and no health assessment. “In range” means
                inside the reference interval this value was scored against — a population range, not a personal
                target.
              </DataStateNote>
            </div>
            {!profile.sexSet && sexNotice.length > 0 && (
              <div className="mt-2">
                <DataStateNote tone="attention">
                  A sex-specific interval would be needed for{' '}
                  {sexNotice.map(analyte => analyte.displayName).join(', ')}, and none is applied while Sex is unset:
                  set Sex in Settings → Account and those results are scored on the next read. Nothing is banded on
                  an assumption.
                </DataStateNote>
              </div>
            )}
          </section>

          {/* ── Per-analyte cards, by category ───────── */}
          {groups.map(group => (
            <section key={group.category} aria-label={`${group.category} analytes`}>
              <SectionTitle
                hint={`${group.analytes.length} analyte${group.analytes.length === 1 ? '' : 's'} · out of range first`}
              >
                {group.category}
              </SectionTitle>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {group.analytes.map(analyte => (
                  <AnalyteCard
                    key={analyte.analyteKey}
                    analyte={analyte}
                    profile={profile}
                    provenance={provenance}
                  />
                ))}
              </div>
            </section>
          ))}

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Info size={14} className="text-text-secondary" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-text-primary">How these values were scored</h2>
            </div>
            <LabNotices />
          </Card>
        </>
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</dt>
      <dd className="text-text-primary font-medium tnum break-words">{value}</dd>
      {sub && <dd className="text-[10px] text-text-secondary leading-relaxed">{sub}</dd>}
    </div>
  );
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-semibold tnum text-text-primary leading-none">{count}</div>
      <div className="text-xs text-text-secondary mt-1">{label}</div>
    </Card>
  );
}

// ── One analyte ─────────────────────────────────────────────────────────────

function AnalyteCard({
  analyte,
  profile,
  provenance,
}: {
  analyte: LabAnalyte;
  profile: LabProfileFacts;
  provenance: Map<string, RowProvenance>;
}) {
  const latest = latestPoint(analyte);
  const model = useMemo(() => chartModel(analyte), [analyte]);
  const change = useMemo(() => changeFromPrevious(analyte), [analyte]);
  const rows = useMemo(() => observationRows(analyte, provenance, profile), [analyte, provenance, profile]);
  if (!latest) return null;

  const points = orderedPoints(analyte);
  const oldest = points[0] ?? latest;
  const interval = intervalProvenance(latest.interval);
  const reason = unscoredReason(analyte, latest, profile);

  return (
    <Card className="p-5 flex flex-col" as="article" aria-label={analyte.displayName}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-text-primary">{analyte.displayName}</h3>
        <LabStatusBadge label={latest.statusLabel} tone={latest.tone} />
      </div>
      <p className="text-xs text-text-secondary">
        {points.length} stored observation{points.length === 1 ? '' : 's'}, from{' '}
        {formatDayKeyLong(oldest.resultOn)} to {formatDayKeyLong(latest.resultOn)}
      </p>

      <div className="mt-4">
        <LabChart analyteName={analyte.displayName} model={model} height={180} />
      </div>

      {/* The two compact cards the owner asked for: the latest result with its
          OBSERVATION DATE, and the reference range with its source in words. */}
      <LabChartFacts model={model} latest={latest} className="mt-3" />

      <dl className="mt-3 space-y-1.5 text-xs">
        {interval.note && (
          <dd className="text-[11px] text-text-secondary leading-relaxed">{interval.note}</dd>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-text-secondary">Change:</dt>
          <dd className="text-text-primary tnum">
            {change === null
              ? 'no observations'
              : change.kind === 'first'
                ? change.text
                : change.kind === 'numeric'
                  ? `${change.deltaText} since ${formatDayKeyLong(change.from.resultOn)} (${change.windowText})`
                  : change.text}
          </dd>
        </div>
        {reason && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-secondary">Not scored:</dt>
            <dd className="text-text-primary leading-relaxed">{reason}</dd>
          </div>
        )}
      </dl>

      <details className="mt-3">
        <summary className="text-xs text-primary cursor-pointer min-h-[44px] flex items-center">
          Show {rows.length} observation{rows.length === 1 ? '' : 's'} as a table
        </summary>
        <div className="mt-2">
          <LabObservationTable
            rows={rows}
            caption={`Every stored observation of ${analyte.displayName}, oldest first`}
          />
        </div>
      </details>

      <div className="mt-3 pt-3 border-t border-border">
        <Link
          href={`/lab/${analyte.analyteKey}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline min-h-[44px]"
        >
          Open {analyte.displayName} detail
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

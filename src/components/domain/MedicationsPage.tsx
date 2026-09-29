'use client';

// ── /medications — what was logged ──────────────────────────────────────────
//
// WHAT THIS PAGE IS. A view of the medication records the owner's Health Auto
// Export history holds for a bounded window: the doses attributable to today, a
// per-medication history over the window, and the window the data actually
// covers. It reports WHAT WAS LOGGED.
//
// WHAT THIS PAGE MAY NOT DO. No adherence score, no percentage, no target, no
// "missed" verdict, no advice, and no diagnostic, treatment or prescribing word
// anywhere in the copy — a dose the source does not state is never rendered as
// 0, a day with no records is never drawn as a zero bar, and a record with no
// scheduled date is listed rather than dropped. The source's own free-text label
// is shown verbatim; no strength is parsed out of it or invented.
//
// THE EMPTY STATE IS HONEST: with no records in the window the page says so in
// words — no empty chart, no zeroes.
//
// The decisions (grouping, per-day series, counts, labels) live in
// `@/lib/medications/view` as pure functions with their own tests; this file is
// the presentation over them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Pill } from 'lucide-react';
import { Badge, Card, DataStateNote, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { MedicationDoseChart } from '@/components/charts';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { useUnits } from '@/components/ui/UnitsProvider';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { fetchMedications, type MedicationReadResponse } from '@/lib/medications/client-data';
import {
  MEDICATIONS_LOOKBACK_DAYS,
  coverageLabel,
  dailyStatusSeries,
  formatUnits,
  groupMedications,
  hasNoRecords,
  medicationsWindow,
  recordsOnDay,
  scheduledTimeLabel,
  statusSummaryWords,
  undatedRecords,
  type MedicationGroup,
} from '@/lib/medications/view';
import type { MedicationRecord, MedicationStatus } from '@/lib/adapters/medications';
import { DomainHeader, SectionTitle } from './DomainShared';

// ── State ───────────────────────────────────────────────────────────────────

interface MedicationsState {
  loading: boolean;
  error: string | null;
  data: MedicationReadResponse | null;
}

export function MedicationsPage() {
  const { referenceKey } = useDatasetMeta();
  const [state, setState] = useState<MedicationsState>({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const data = await fetchMedications(medicationsWindow(referenceKey, MEDICATIONS_LOOKBACK_DAYS));
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : 'The medication records could not be read.',
      });
    }
  }, [referenceKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <div className="space-y-6">
        <DomainHeader
          title="Medications"
          subtitle="Doses recorded in your Health Auto Export history — what was logged, and when."
        />
        <LoadingState label="Reading the recorded medication doses" />
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="space-y-6">
        <DomainHeader
          title="Medications"
          subtitle="Doses recorded in your Health Auto Export history — what was logged, and when."
        />
        <ErrorState
          title="The medication records could not be read"
          message={`${state.error ?? 'No medication records were returned.'} Nothing is shown in their place — no zeroes, no placeholder rows.`}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return <MedicationsContent data={state.data} referenceKey={referenceKey} onRefresh={load} />;
}

// ── The page ────────────────────────────────────────────────────────────────

function MedicationsContent({
  data,
  referenceKey,
  onRefresh,
}: {
  data: MedicationReadResponse;
  referenceKey: string;
  onRefresh: () => void;
}) {
  const { timezone } = useUnits();
  const records = data.records;
  const empty = hasNoRecords(records);

  const today = useMemo(() => recordsOnDay(records, referenceKey), [records, referenceKey]);
  const groups = useMemo(() => groupMedications(records), [records]);
  const series = useMemo(() => dailyStatusSeries(records), [records]);
  const undated = useMemo(() => undatedRecords(records), [records]);
  const covered = coverageLabel(data.covered, timezone);

  return (
    <div className="space-y-8">
      <DomainHeader
        title="Medications"
        subtitle={`Doses recorded in your Health Auto Export history over the last ${MEDICATIONS_LOOKBACK_DAYS} days.`}
      >
        <Badge variant="default" className="text-[10px]">
          {records.length} record{records.length === 1 ? '' : 's'}
        </Badge>
      </DomainHeader>

      {/* ── Source not configured, or a genuine read failure ───────── */}
      {!data.available && (
        <Card className="p-5">
          <DataStateNote tone="attention">
            {data.reason ?? 'The medication source could not be read.'} Nothing is shown in its place.
          </DataStateNote>
        </Card>
      )}

      {/* ── Empty state: the honest default ─────────────────────────── */}
      {empty && (
        <Card className="p-6">
          <EmptyState
            icon={<Pill size={26} aria-hidden="true" />}
            title="No medication records in this window"
            description={`There are no medication records in the last ${MEDICATIONS_LOOKBACK_DAYS} days. This surface reports what your Health Auto Export history logged, and this window logged nothing. Nothing is shown in place of it: no zeroes, no empty chart.`}
          />
          <div className="mt-6 border-t border-border pt-4">
            <DataStateNote>{coverageSentence(data, covered)}</DataStateNote>
          </div>
        </Card>
      )}

      {/* ── Today's doses ──────────────────────────────────────────── */}
      {!empty && (
        <section>
          <SectionTitle hint={formatDayKeyLong(referenceKey)}>Doses recorded today</SectionTitle>
          <Card className="p-5">
            {today.length === 0 ? (
              <DataStateNote>
                No dose was recorded on {formatDayKeyLong(referenceKey)}. A day with no recorded dose is not a
                day of zero doses — it is a day the source logged nothing.
              </DataStateNote>
            ) : (
              <ul className="list-none p-0 m-0 divide-y divide-border">
                {today.map(record => (
                  <li key={record.id || `${record.displayText}-${record.scheduledDate}`}>
                    <TodayRow record={record} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* ── Per-medication history ─────────────────────────────────── */}
      {!empty && groups.length > 0 && (
        <section>
          <SectionTitle hint={`${groups.length} medication${groups.length === 1 ? '' : 's'}`}>
            Per-medication history
          </SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map(group => (
              <MedicationGroupCard key={group.key} group={group} />
            ))}
          </div>
        </section>
      )}

      {/* ── Doses per recorded day (only when there is something to plot) ─ */}
      {!empty && series.length > 0 && (
        <section>
          <SectionTitle hint={`${series.length} day${series.length === 1 ? '' : 's'} with records`}>
            Doses per recorded day
          </SectionTitle>
          <Card className="p-5">
            <MedicationDoseChart rows={series} />
          </Card>
        </section>
      )}

      {/* ── Records with no scheduled date (undated, listed not dropped) ─ */}
      {undated.length > 0 && (
        <section>
          <SectionTitle hint={`${undated.length} record${undated.length === 1 ? '' : 's'}`}>
            Records with no scheduled date
          </SectionTitle>
          <Card className="p-5 space-y-3">
            <DataStateNote>
              These records carry no scheduled date, so they fall inside no day and are attributed to none. They
              are listed here rather than dropped or counted into a day.
            </DataStateNote>
            <ul className="list-none p-0 m-0 divide-y divide-border">
              {undated.map(record => (
                <li key={record.id || record.displayText} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-text-primary">{record.displayText}</span>
                  <StatusBadge status={record.status} />
                  <span className="text-xs text-text-secondary tnum">{formatUnits(record.dosage)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* ── Provenance / coverage ──────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-text-secondary" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-text-primary">Coverage for this page</h3>
        </div>
        <DataStateNote>{coverageSentence(data, covered)}</DataStateNote>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 text-xs text-primary hover:underline"
        >
          Refresh
        </button>
      </Card>
    </div>
  );
}

function coverageSentence(data: MedicationReadResponse, covered: string | null): string {
  const window =
    data.window === null
      ? 'no window was echoed back'
      : `${formatDayKeyLong(data.window.from)} to ${formatDayKeyLong(data.window.to)} requested`;
  if (covered === null) {
    return `${data.source}, server-side: ${window}. Nothing attributable was returned for it, so the span the records cover cannot be stated. A day with no record is not counted as zero.`;
  }
  return `${data.source}, server-side: ${window}; the returned records cover ${covered}. Days with no record are missing rather than counted as zero.`;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function TodayRow({ record }: { record: MedicationRecord }) {
  const { timezone } = useUnits();
  return (
    <div className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-medium text-text-primary">{record.displayText}</span>
      <span className="text-xs text-text-secondary tnum">{scheduledTimeLabel(record.scheduledDate, timezone)}</span>
      <StatusBadge status={record.status} />
      <span className="text-xs text-text-secondary tnum ml-auto">{formatUnits(record.dosage)}</span>
    </div>
  );
}

/**
 * A status as a WORD (with tone, never colour alone). 'Unknown' says what it
 * means — the source recorded no status — rather than inventing one.
 */
export function StatusBadge({ status }: { status: MedicationStatus }) {
  if (status === 'Taken') {
    return (
      <Badge variant="success" className="text-[10px]">
        Taken
      </Badge>
    );
  }
  if (status === 'Skipped') {
    return (
      <Badge variant="warning" className="text-[10px]">
        Skipped
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-[10px]">
      Status not recorded
    </Badge>
  );
}

function MedicationGroupCard({ group }: { group: MedicationGroup }) {
  const words = statusSummaryWords(group.records);
  return (
    <Card className="p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-medium text-text-primary">{group.key}</span>
        <Badge variant="default" className="text-[10px] shrink-0">
          {group.records.length} record{group.records.length === 1 ? '' : 's'}
        </Badge>
      </div>

      <p className="text-[11px] text-text-secondary">
        {group.days.length === 0
          ? 'No dated record in this window'
          : `Recorded on ${group.days.length} day${group.days.length === 1 ? '' : 's'} · last ${formatDayKeyLong(group.lastDay!)}`}
      </p>
      <p className="text-[11px] text-text-secondary mt-0.5">
        {group.skipped === 0 ? 'No entry was recorded as skipped' : `${group.skipped} recorded as skipped`}
      </p>
      {words.length > 0 && <p className="text-[11px] text-text-secondary mt-0.5">{words.join(' · ')}</p>}
    </Card>
  );
}

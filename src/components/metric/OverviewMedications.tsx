'use client';

// ── Medications block on the Overview page (app-rendered) ───────────────────
//
// WHAT THIS IS. A self-contained, VISIBLE block on the Overview page listing the
// medications the owner is currently recording, each with its recent history in
// words: how many days of the window carry a record, the newest day one was
// logged, and how many entries were recorded as skipped. It reports WHAT WAS
// LOGGED.
//
// INDEPENDENT OF THE BRIEFING. The model's briefing context carries no
// medications at all — medications reach the AI through the analyst instead —
// so this block reads its own data over the network and can never be blocked by,
// or derive its content from, briefing text. It renders whatever the medication
// route returned regardless of the hero's state; the two never share an input.
//
// HONESTY. With no records in the window the block says so in words — no empty
// chart, no zeroes. A dosage the source omits is never rendered as 0; a record
// with no scheduled date falls inside no day and is attributed to none rather
// than dropped or counted into a day. Nothing here is advice, and no diagnostic,
// treatment or prescribing word appears anywhere in the copy. The list is only
// what the owner's Health Auto Export history holds — it is never stated to be
// exhaustive.
//
// The read is bounded and server-side (`/api/medications`), the same route the
// Medications page uses; this block asks for the same window through the shipped
// helpers and invents no window arithmetic of its own.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Pill } from 'lucide-react';
import { Badge, Card, DataStateNote, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { useUnits } from '@/components/ui/UnitsProvider';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { fetchMedications, type MedicationReadResponse } from '@/lib/medications/client-data';
import {
  MEDICATIONS_LOOKBACK_DAYS,
  coverageLabel,
  formatUnits,
  groupMedications,
  hasNoRecords,
  medicationsWindow,
  undatedRecords,
  type MedicationGroup,
} from '@/lib/medications/view';
import { SectionTitle } from '@/components/domain/DomainShared';

interface MedicationsState {
  loading: boolean;
  error: string | null;
  data: MedicationReadResponse | null;
}

export function OverviewMedications() {
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

  return (
    <section data-overview-medications aria-label="Medications">
      <SectionTitle hint={`last ${MEDICATIONS_LOOKBACK_DAYS} days`}>Medications</SectionTitle>
      <Card className="p-5">
        {state.loading && <LoadingState label="Reading the recorded medication doses" />}
        {!state.loading && state.error && (
          <ErrorState
            title="The medication records could not be read"
            message={`${state.error} Nothing is shown in their place — no zeroes, no placeholder rows.`}
            onRetry={() => void load()}
          />
        )}
        {!state.loading && !state.error && state.data && (
          <MedicationsOverviewBody data={state.data} referenceKey={referenceKey} />
        )}
      </Card>
    </section>
  );
}

// ── The block body (pure of any briefing input) ─────────────────────────────

/**
 * Everything the block shows, as a function of the medication read alone. It is
 * exported so the render is asserted directly in tests (adherence wording, the
 * skipped count, the covered window, the empty state) without standing up a
 * briefing, which is what proves it needs none.
 */
export function MedicationsOverviewBody({
  data,
  referenceKey,
}: {
  data: MedicationReadResponse;
  referenceKey: string;
}) {
  const { timezone } = useUnits();
  const records = data.records;
  const groups = useMemo(() => groupMedications(records), [records]);
  const undated = useMemo(() => undatedRecords(records), [records]);
  const covered = coverageLabel(data.covered, timezone);
  const empty = hasNoRecords(records);

  return (
    <div className="space-y-4" data-medications-body>
      {!data.available && (
        <DataStateNote tone="attention">
          {data.reason ?? 'The medication source could not be read.'} Nothing is shown in its place.
        </DataStateNote>
      )}

      {empty ? (
        <EmptyState
          icon={<Pill size={26} aria-hidden="true" />}
          title="No medication records in this window"
          description={`There are no medication records in the last ${MEDICATIONS_LOOKBACK_DAYS} days. This block reports what your Health Auto Export history logged, and this window logged nothing. Nothing is shown in place of it: no zeroes, no empty chart.`}
        />
      ) : (
        <ul className="list-none p-0 m-0 divide-y divide-border" data-medications-list>
          {groups.map(group => (
            <li key={group.key} className="py-3 first:pt-0 last:pb-0">
              <MedicationRow group={group} />
            </li>
          ))}
        </ul>
      )}

      {/* Records with no scheduled date fall inside no day — listed, not dropped. */}
      {undated.length > 0 && (
        <div className="border-t border-border pt-3" data-medications-undated>
          <p className="text-[11px] text-text-secondary mb-2" data-undated-note>
            {undatedSentence(undated.length)}
          </p>
          <ul className="list-none p-0 m-0 divide-y divide-border">
            {undated.map(record => (
              <li
                key={record.id || record.displayText}
                className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                <span className="text-sm text-text-primary">{record.displayText}</span>
                <span className="text-xs text-text-secondary tnum">{formatUnits(record.dosage)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Source / freshness line, stated in words the way the app describes provenance. */}
      <div className="border-t border-border pt-3 flex items-start gap-2">
        <Info size={13} className="text-text-secondary shrink-0 mt-0.5" aria-hidden="true" />
        <DataStateNote>{sourceSentence(data, covered, referenceKey)}</DataStateNote>
      </div>
    </div>
  );
}

/** One medication: name, the days it was recorded, its newest day, and skipped count. */
function MedicationRow({ group }: { group: MedicationGroup }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-medication-row={group.key}>
      <span className="text-sm font-medium text-text-primary">{group.key}</span>
      <Badge variant="default" className="text-[10px] shrink-0">
        {group.records.length} record{group.records.length === 1 ? '' : 's'}
      </Badge>
      <span className="text-xs text-text-secondary" data-medication-adherence>
        {adherenceSentence(group)}
      </span>
      <span className="text-xs text-text-secondary ml-auto" data-medication-skipped>
        {skippedSentence(group)}
      </span>
    </div>
  );
}

/**
 * The recent history in words — never a score, a percentage or a target:
 *   'recorded on 28 of the last 30 days, last Sep 28'
 * A group holding only undated records says exactly that instead.
 */
export function adherenceSentence(group: MedicationGroup): string {
  if (group.days.length === 0 || group.lastDay === null) {
    return `no dated record in the last ${MEDICATIONS_LOOKBACK_DAYS} days`;
  }
  return `recorded on ${group.days.length} of the last ${MEDICATIONS_LOOKBACK_DAYS} days, last ${formatDayKeyLong(
    group.lastDay
  )}`;
}

/** The skipped count as words. A zero here is a true zero (records exist), not missing data. */
export function skippedSentence(group: MedicationGroup): string {
  if (group.skipped === 0) return 'nothing recorded as skipped';
  return `${group.skipped} recorded as skipped`;
}

/** The sentence over the undated-record list, matching grammar to the count. */
export function undatedSentence(count: number): string {
  if (count === 1) {
    return '1 record carries no scheduled date, so it falls inside no day and is attributed to none. It is listed here rather than dropped or counted into a day.';
  }
  return `${count} records carry no scheduled date, so they fall inside no day and are attributed to none. They are listed here rather than dropped or counted into a day.`;
}

/**
 * The source and the window actually covered, in words. Never a host, a token or
 * a path; and a missing day is stated as missing rather than counted as zero.
 */
export function sourceSentence(
  data: MedicationReadResponse,
  covered: string | null,
  referenceKey: string
): string {
  const requested =
    data.window === null
      ? 'no window was echoed back'
      : `${formatDayKeyLong(data.window.from)} to ${formatDayKeyLong(data.window.to)} requested`;
  const head = `${data.source}, read server-side for ${formatDayKeyLong(
    referenceKey
  )}: ${requested}.`;
  if (covered === null) {
    return `${head} Nothing attributable was returned for it, so the span the records cover cannot be stated. A day with no record is not counted as zero.`;
  }
  return `${head} The records returned cover ${covered}. Days with no record are missing rather than counted as zero.`;
}
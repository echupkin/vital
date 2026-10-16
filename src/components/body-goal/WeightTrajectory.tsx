'use client';

// ── Body → Weight trajectory ────────────────────────────
//
// The one weight chart on the Body page, with or without a goal: weigh-ins,
// the seven-day average and the 30-day change, plus — when a goal is set — the
// goal line and the projection at the chosen rate. Beside it, the recorded
// range over the same 90 days. Rendered only when there are weigh-ins in the
// window (owner request 2).

import Link from 'next/link';
import { REFERENCE_KEY, seriesFor } from '@/lib/adapters/dataset';
import { buildSeriesSummary, diffDays, formatDayKeyLong, mean, trailingWindow, windowRangeLabel } from '@/lib/analytics';
import { formatMetricValue, formatMetricWithUnit } from '@/lib/metrics/format';
import type { BodyGoalReport } from '@/lib/body-goal/report';
import { Badge, Card, DataStateNote } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { ChangeBadge, SectionTitle } from '@/components/domain/DomainShared';
import { WeightTrajectoryChart } from './WeightTrajectoryChart';
import { formatSignedKg } from './format';

/** The window reaches back this many days from today, so its first day is "90 days ago". */
const DAYS = 90;
/** The comparison the "Recent change" weight card makes: the last 30 days against the 30 before. */
const RECENT_DAYS = 30;

/** "Today", "Yesterday", or the date. */
function dayLabel(key: string): string {
  const ago = diffDays(key, REFERENCE_KEY);
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : formatDayKeyLong(key);
}

/** "Today", "Yesterday", or "N days ago". */
function daysAgo(key: string): string {
  const ago = diffDays(key, REFERENCE_KEY);
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${ago} days ago`;
}

export function WeightTrajectory({ report }: { report: BodyGoalReport | null }) {
  const { units } = useUnits();
  const all = seriesFor('weight_body_mass');
  // DAYS + 1 calendar days: today plus the 90 before it.
  const win = trailingWindow(REFERENCE_KEY, DAYS + 1);
  const inWindow = all.filter(p => p.key >= win.startKey && p.key <= win.endKey);
  if (inWindow.length === 0) return null;

  const recent = buildSeriesSummary('weight_body_mass', REFERENCE_KEY, RECENT_DAYS, units);
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const values = inWindow.map(p => p.value);
  const gaps = inWindow.slice(1).map((p, i) => diffDays(inWindow[i].key, p.key));
  const avgGap = gaps.length ? mean(gaps) : NaN;
  const projecting = report?.projection?.chosen != null;
  const holding = report?.maintenance ?? null;

  return (
    <section>
      <SectionTitle hint={`${windowRangeLabel(win)} · ${inWindow.length} weigh-ins`}>Weight trajectory</SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 md:p-6 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">
              Weight{recent.latest ? ` · ${recent.latestValue} on ${formatDayKeyLong(recent.latest.key)}` : ''}
            </span>
            <ChangeBadge summary={recent} days={RECENT_DAYS} />
          </div>
          <WeightTrajectoryChart weights={all} from={win.startKey} today={REFERENCE_KEY} report={report} units={units} />
          <div className="mt-3 space-y-1">
            {report?.projection?.trendNote && <DataStateNote>{report.projection.trendNote}</DataStateNote>}
            <DataStateNote>
              The thin line joins consecutive weigh-ins, about {Number.isFinite(avgGap) ? avgGap.toFixed(1) : '—'} days apart; it
              does not mean weight was measured in between.{projecting ? ' The dashed line is a projection at the chosen rate, not a deadline.' : ''}
              {holding ? ` The shaded band is the maintenance range: ${holding.basis.charAt(0).toLowerCase()}${holding.basis.slice(1)}` : ''}
            </DataStateNote>
          </div>
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-text-secondary">Recorded range</span>
            <Badge variant="default" className="text-[10px]" title="Days with a weigh-in, across all your history">{all.length} all time</Badge>
          </div>
          <dl className="text-sm space-y-1.5 mb-3">
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary" title={formatDayKeyLong(first.key)}>{daysAgo(first.key)}</dt>
              <dd className="tnum text-text-primary">{formatMetricWithUnit('weight_body_mass', first.value, units)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">{dayLabel(last.key)}</dt>
              <dd className="tnum text-text-primary">{formatMetricWithUnit('weight_body_mass', last.value, units)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Change across window</dt>
              <dd className="tnum text-text-primary">{formatSignedKg(last.value - first.value, units)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Lowest / highest</dt>
              <dd className="tnum text-text-primary">
                {`${formatMetricValue('weight_body_mass', Math.min(...values), units)} / ${formatMetricValue('weight_body_mass', Math.max(...values), units)}`}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Weighed in</dt>
              <dd className="tnum text-text-primary">{inWindow.length} of {DAYS + 1} days</dd>
            </div>
          </dl>
          <div className="mt-auto">
            <Link href="/metric/weight_body_mass" className="text-sm text-primary hover:underline">
              Open weight detail
            </Link>
          </div>
          <DataStateNote>
            The lowest and highest readings are the extremes of the measurements taken, not a range your weight stayed
            inside between them.
          </DataStateNote>
        </Card>
      </div>
    </section>
  );
}

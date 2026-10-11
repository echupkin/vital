'use client';

// ── Overview: the body goal at a glance ─────────────────
//
// Phase, whether the weight trend is on track (see GoalTrack), the
// projected arrival and what to eat, linking to Body. Hidden when no goal is set (or it cannot
// be read): the Overview never shows an empty goal shell.

import Link from 'next/link';
import { ChevronRight, Target } from 'lucide-react';
import { Badge, Card } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { PHASE_LABEL } from '@/lib/body-goal/phase';
import { formatKcal, formatKg, formatRange, formatTargetPct } from './format';
import { GoalTrack } from './GoalTrack';
import { useBodyGoal, useGoalReport } from './useBodyGoal';

export function GoalTile() {
  const { units } = useUnits();
  const { active } = useBodyGoal();
  const report = useGoalReport(active);
  if (!active || !report) return null;
  const { phase, projection, targets } = report;
  const title = active.kind === 'weight' ? formatKg(active.target, units) : `${formatTargetPct(active.target)} body fat`;

  return (
    <Card className="p-5 md:p-6" as="section" aria-label="Your body goal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <Target size={14} aria-hidden="true" />
            Your goal
            {phase.phase && <Badge variant="accent">{PHASE_LABEL[phase.phase]}</Badge>}
          </div>
          <p className="mt-1 text-[22px] font-semibold tnum text-text-primary">{title}</p>
        </div>
        <Link href="/body" className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">
          Open Body <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {phase.reason ? (
        <p className="mt-2 text-sm text-text-secondary">{phase.reason}</p>
      ) : (
        <>
          <div className="mt-3">
            <GoalTrack report={report} units={units} compact />
          </div>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-text-secondary">{phase.phase === 'maintain' ? 'Status' : 'Projected arrival'}</dt>
              <dd className="tnum text-text-primary">
                {phase.phase === 'maintain' ? 'At the goal' : projection?.chosen ? formatDayKeyLong(projection.chosen.arrival) : '—'}
              </dd>
            </div>
            {targets?.calories ? (
              <div>
                <dt className="text-xs text-text-secondary">Calories to aim for</dt>
                <dd className="tnum text-text-primary">{formatRange(targets.calories, 'kcal')}</dd>
                {report.energy.maintenance !== null && <dd className="text-[11px] text-text-secondary">maintenance ≈ {formatKcal(report.energy.maintenance)}</dd>}
              </div>
            ) : targets ? (
              <div>
                <dt className="text-xs text-text-secondary">Protein to aim for</dt>
                <dd className="tnum text-text-primary">{formatRange(targets.protein, 'g')}</dd>
                <dd className="text-[11px] text-text-secondary">a day, from body weight</dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
    </Card>
  );
}

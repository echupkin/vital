'use client';

// The figures beside a map, all for the selected activities and date range
// inside the map's area: totals, coverage, the longest session and effort.
// Pointing at a session or a stretch with a mouse previews it on the map; a
// click or tap pins it there until it is clicked or tapped again. Touch has no
// hover to end, so only a mouse previews.

import type { ReactNode } from 'react';
import type { CoverageHighlights, Stretch } from '@/lib/activity-maps/coverage';
import { formatDistance, formatSeconds } from '@/lib/activity-maps/format';
import { formatDayKeyLong, formatDayKeyShort } from '@/lib/analytics/windows';
import type { UnitSystem } from '@/lib/prefs/types';

// The small-caps group label and the figure follow the rest of the app (the
// routine pages' micro label, Workout history's totals), scaled to a side panel.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[12px] font-medium text-text-secondary">{label}</div>
      <div className="whitespace-nowrap text-[22px] font-semibold leading-none tnum tracking-[-0.03em] text-text-primary">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-text-secondary">{sub}</div>}
    </div>
  );
}

/** The highlights that can be drawn on the map. */
export type HighlightId = 'longest' | 'hardest';

/** The track a highlight draws, as polylines of flat [lat, lon, …]; null when it has none. */
export function highlightLines(highlights: CoverageHighlights, id: HighlightId | null): number[][] | null {
  if (id === 'longest') return highlights.longest?.lines ?? null;
  if (id === 'hardest') return highlights.effort.hardest?.lines ?? null;
  return null;
}

/** A highlight that can be drawn on the map: a session's track or a stretch. */
function TrackRow({
  id,
  label,
  detail,
  pinned,
  onHover,
  onToggle,
}: {
  id: HighlightId;
  label: string;
  detail: string;
  pinned: boolean;
  onHover: (id: HighlightId | null) => void;
  onToggle: (id: HighlightId) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      className="w-full rounded-control border border-border px-3 py-2 text-left hover:border-border-strong hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent-tint"
      onPointerEnter={e => e.pointerType === 'mouse' && onHover(id)}
      onPointerLeave={e => e.pointerType === 'mouse' && onHover(null)}
      onClick={() => onToggle(id)}
    >
      <span className="block text-xs text-text-primary">{label}</span>
      <span className="block text-[11px] text-text-secondary tnum">{detail}</span>
    </button>
  );
}

export function HighlightsPanel({
  highlights,
  units,
  pinned,
  onHover,
  onToggle,
}: {
  highlights: CoverageHighlights;
  units: UnitSystem;
  /** The highlight clicked or tapped on, drawn until it is clicked or tapped again. */
  pinned: HighlightId | null;
  onHover: (id: HighlightId | null) => void;
  onToggle: (id: HighlightId) => void;
}) {
  const row = (id: HighlightId) => ({ id, pinned: pinned === id, onHover, onToggle });
  const { totals, coverage, longest, visits, effort } = highlights;
  if (totals.workouts === 0) {
    return <p className="text-sm text-text-secondary">No route of the selected activities enters this area in the selected range.</p>;
  }
  const span = (s: Stretch) => (s.first === s.last ? formatDayKeyShort(s.first) : `${formatDayKeyShort(s.first)} – ${formatDayKeyShort(s.last)}`);
  return (
    <div className="space-y-6">
      <Group title="Totals">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Figure label="Workouts" value={totals.workouts.toLocaleString()} />
          <Figure label="Time here" value={formatSeconds(totals.seconds)} />
          <Figure label="Travelled" value={formatDistance(totals.distanceM, units)} />
        </div>
        {totals.byType.length > 1 && (
          <ul className="m-0 list-none space-y-1 p-0 text-[11px]">
            {totals.byType.map(t => (
              <li key={t.type} className="flex justify-between gap-2">
                <span className="truncate text-text-primary">{t.type}</span>
                <span className="shrink-0 text-text-secondary tnum">
                  {t.workouts} · {formatSeconds(t.seconds)} · {formatDistance(t.distanceM, units)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {visits.first && visits.last && (
          <p className="text-[11px] text-text-secondary">
            First here {formatDayKeyLong(visits.first)}
            {visits.last !== visits.first ? `; most recently ${formatDayKeyLong(visits.last)}` : ''}.
          </p>
        )}
      </Group>

      <Group title="Coverage">
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Distinct ground" value={formatDistance(coverage.uniqueDistanceM, units)} sub="Each stretch counted once" />
          <Figure
            label="New ground"
            value={formatDistance(coverage.newDistanceM, units)}
            sub={`First travelled since ${formatDayKeyShort(coverage.newSinceKey)}`}
          />
        </div>
      </Group>

      <Group title="Longest session">
        {longest ? (
          <TrackRow
            {...row('longest')}
            label={`${formatDistance(longest.distanceM, units)} · ${longest.type}`}
            detail={`${formatDayKeyLong(longest.dayKey)} · ${formatSeconds(longest.seconds)} here`}
          />
        ) : (
          <p className="text-xs text-text-secondary">No session in this range yet.</p>
        )}
      </Group>

      <Group title="Effort">
        {effort.meanHeartRate != null ? (
          <>
            <Figure
              label="Average heart rate here"
              value={`${effort.meanHeartRate} bpm`}
              sub={effort.measuredShare < 0.95 ? `Measured for ${Math.round(effort.measuredShare * 100)}% of the time here` : undefined}
            />
            {effort.hardest && effort.hardest.meanHeartRate != null && (
              <TrackRow
                {...row('hardest')}
                label={`Hardest stretch: ~${effort.hardest.meanHeartRate} bpm`}
                detail={`${formatDistance(effort.hardest.lengthM, units)} · ${span(effort.hardest)}`}
              />
            )}
          </>
        ) : (
          <p className="text-xs text-text-secondary">No heart rate was recorded on these routes.</p>
        )}
      </Group>
    </div>
  );
}

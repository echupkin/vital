'use client';

// The key to a coverage map: what the colour means and the range it spans, how
// line width reads, and, for a per-point metric, the neutral that means "not
// measured". Text stays in text tokens; only the swatches carry the ramp.

import { MISSING_COLOR, pathMetric, type MetricScale, type PathMetricId } from '@/lib/activity-maps/metrics';
import type { Scheme } from './useColorScheme';

export function MapLegend({
  metric,
  scale,
  tone,
  maxCount,
  smoothingM,
}: {
  metric: PathMetricId;
  scale: MetricScale | null;
  tone: Scheme;
  maxCount: number;
  /** σ of the smoothing the colours were drawn with, if any. */
  smoothingM?: number | null;
}) {
  const m = pathMetric(metric);
  const ramp = m.ramp[tone];
  if (!scale) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-text-secondary">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-text-primary">{m.description}</span>
        <span className="whitespace-nowrap tnum">{m.format(scale.min)}</span>
        <span
          aria-hidden="true"
          className="inline-block h-2 w-24 rounded-full"
          style={{ background: `linear-gradient(to right, ${ramp.join(', ')})` }}
        />
        <span className="whitespace-nowrap tnum">
          {m.format(scale.max)}
          {m.clamp ? '+' : ''}
        </span>
      </span>
      {m.sample && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-1 w-4 rounded-full" style={{ background: MISSING_COLOR }} />
          No reading
        </span>
      )}
      {m.width === 'count' && maxCount > 1 && <span>Thicker lines were travelled more often (up to {maxCount}×)</span>}
      {smoothingM != null && <span>Smoothed over about {Math.round(smoothingM)} m along the streets</span>}
      {m.clamp && (
        <span>
          Colours span the {m.clamp[0]}th–{m.clamp[1]}th percentile, so one outlier does not flatten the rest
        </span>
      )}
    </div>
  );
}

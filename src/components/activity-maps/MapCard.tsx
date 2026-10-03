'use client';

// ── One map on Activity → Maps ──────────────────────────
//
// Its own controls (activities, colour metric, date range) saved with the map,
// the map itself, the key, and the highlights for what is drawn. What the map is
// drawn on (provider, style, light or dark) is chosen in the edit dialog. The
// coverage is read from /api/activity-coverage whenever a control changes; the
// last answer stays on screen while the next one loads.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button, Card, DataStateNote, FilterChip, SegmentedControl, Skeleton } from '@/components/ui/primitives';
import { SectionTitle } from '@/components/domain/DomainShared';
import { RangeControl } from '@/components/ui/RangeControl';
import { useUnits } from '@/components/ui/UnitsProvider';
import { PATH_METRICS, type PathMetricId } from '@/lib/activity-maps/metrics';
import type { ActivityMap, MapSettings } from '@/lib/activity-maps/types';
import { fetchCoverage, type CoverageResponse } from '@/lib/activity-maps/client';
import { formatDaySpan } from '@/lib/activity-maps/format';
import { resolveTiles } from './basemaps';
import { useTileConfig } from './TileConfigContext';
import { HighlightsPanel, highlightLines, type HighlightId } from './HighlightsPanel';
import { LeafletMap, nextFocus, type MapFocus } from './LeafletMap';
import { MapLegend } from './MapLegend';
import { useColorScheme } from './useColorScheme';

const RANGE_EXTRAS = [
  { value: '365', label: '1Y' },
  { value: 'all', label: 'All' },
];

function CardMenu({
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  onEdit: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  const item = (label: string, icon: React.ReactNode, action: (() => void) | null, danger = false) =>
    action && (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          action();
        }}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted ${
          danger ? 'text-category-attention' : 'text-text-primary'
        }`}
      >
        {icon}
        {label}
      </button>
    );
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" aria-label="Map options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-control border border-border bg-surface-elevated py-1 shadow-pop">
          {item('Edit area, name and map style', <Pencil size={14} aria-hidden="true" />, onEdit)}
          {item('Move up', <ArrowUp size={14} aria-hidden="true" />, onMoveUp)}
          {item('Move down', <ArrowDown size={14} aria-hidden="true" />, onMoveDown)}
          {item('Delete', <Trash2 size={14} aria-hidden="true" />, onDelete, true)}
        </div>
      )}
    </div>
  );
}

export function MapCard({
  map,
  onSettings,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  map: ActivityMap;
  onSettings: (settings: MapSettings) => void;
  onEdit: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onDelete: () => Promise<void>;
}) {
  const { units } = useUnits();
  const scheme = useColorScheme();
  const tiles = useTileConfig();
  const { settings, bbox } = map;
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A highlight from the panel drawn over the routes: the one under the mouse,
  // else the one clicked or tapped on.
  const [hovered, setHovered] = useState<HighlightId | null>(null);
  const [pinned, setPinned] = useState<HighlightId | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const typesKey = settings.activityTypes ? settings.activityTypes.join('\u0000') : '';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchCoverage({ bbox, types: settings.activityTypes, range: settings.range, metric: settings.metric }, controller.signal)
      .then(res => {
        setCoverage(res);
        setHovered(null);
        setPinned(null);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The map could not be read.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The types are compared by value, not by array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox.south, bbox.west, bbox.north, bbox.east, typesKey, settings.range, settings.metric]);

  const update = (patch: Partial<MapSettings>) => onSettings({ ...settings, ...patch });
  const toggleType = (type: string) => {
    const current = settings.activityTypes ?? [];
    const next = current.includes(type) ? current.filter(t => t !== type) : [...current, type];
    update({ activityTypes: next.length > 0 ? next.sort() : null });
  };

  const present = coverage?.types ?? [];
  const selected = settings.activityTypes ?? [];
  const chips = [
    ...present,
    ...selected.filter(t => !present.some(p => p.type === t)).map(type => ({ type, workouts: 0 })),
  ];
  const paths = coverage?.available ? coverage.paths ?? [] : null;
  const emphasis = coverage?.available && coverage.highlights ? highlightLines(coverage.highlights, hovered ?? pinned) : null;
  // Widths follow the smoothed values when the paths carry them, so the legend
  // quotes the same top as the colour key rather than one raw peak.
  const smoothedPaths = (paths ?? []).some(p => p.values);
  const maxCount =
    smoothedPaths && coverage?.scale
      ? Math.round(coverage.scale.max)
      : (paths ?? []).reduce((a, p) => Math.max(a, p.count), 0);
  const drawn = resolveTiles(settings.basemap, tiles.keys, scheme);
  const tone = drawn.tone;
  // The days the map covers: a fixed range's own dates, or with All from the
  // first drawn route up to today, whether or not anything was recorded today.
  // The reference day (the app's today) reads "Today".
  const today = coverage?.referenceKey ?? null;
  const first = coverage?.available ? coverage.highlights?.visits.first : null;
  const rangeLabel = coverage?.range
    ? formatDaySpan(coverage.range.fromKey, coverage.range.toKey, today)
    : first && today
      ? formatDaySpan(first, today, today)
      : 'All recorded workouts';

  return (
    <section aria-label={map.name}>
      <SectionTitle
        hint={rangeLabel}
        action={<CardMenu onEdit={onEdit} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onDelete={() => setConfirmDelete(true)} />}
      >
        {map.name}
      </SectionTitle>
      <Card className="relative overflow-hidden p-4 md:p-6">
        {/* The activity accent along the top edge, as on the headline series cards. */}
        <span className="absolute inset-x-0 top-0 h-[3px] bg-category-activity" aria-hidden="true" />
        {confirmDelete && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-surface-muted px-3 py-2" role="alert">
            <span className="text-sm text-text-primary">Delete &ldquo;{map.name}&rdquo;? Your workouts are not affected.</span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Keep
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDelete();
                  } finally {
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </span>
          </div>
        )}

        {/* The filter rows read like Workout history's: a label, then its controls. */}
        <div className="mb-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-xs font-medium text-text-secondary">Activity</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Activities">
              <FilterChip
              active={settings.activityTypes === null}
              onClick={() => update({ activityTypes: null })}
              label={present.length > 0 ? `All (${present.reduce((n, t) => n + t.workouts, 0)})` : 'All'}
            />
              {chips.map(t => (
                <FilterChip
                  key={t.type}
                  active={selected.includes(t.type)}
                  onClick={() => toggleType(t.type)}
                  label={`${t.type} (${t.workouts})`}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-text-secondary">Colour by</span>
              <SegmentedControl
                ariaLabel="Colour by"
                options={PATH_METRICS.map(m => ({ value: m.id, label: m.label }))}
                value={settings.metric}
                onChange={v => update({ metric: v as PathMetricId })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-text-secondary">Date range</span>
              <RangeControl
                value={String(settings.range)}
                extraOptions={RANGE_EXTRAS}
                onChange={v => update({ range: v === 'all' ? 'all' : Number(v) })}
                ariaLabel={`${map.name} date range`}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
            <LeafletMap
              className="aspect-[3/2] w-full"
              bbox={bbox}
              basemap={settings.basemap}
              paths={paths}
              metric={settings.metric}
              scale={coverage?.scale ?? null}
              emphasis={emphasis}
              focus={focus}
              busy={loading ? (coverage ? 'Updating routes…' : 'Reading routes…') : null}
              ariaLabel={`Map of ${map.name}`}
              overlay={
                <Button size="sm" onClick={() => setFocus(f => nextFocus(f, bbox))} aria-label="Reset view">
                  <RotateCcw size={14} aria-hidden="true" />
                </Button>
              }
            />
            {paths && paths.length > 0 && (
              <MapLegend metric={settings.metric} scale={coverage?.scale ?? null} tone={tone} maxCount={maxCount} smoothingM={coverage?.smoothingM} />
            )}
            <div className="space-y-1">
              {drawn.missingKey?.key && (
                <DataStateNote tone="attention">
                  {drawn.missingKey.label} has no API key configured, so its tiles are requested without one and may not
                  load. Set <code>{drawn.missingKey.key.envVar}</code>; see{' '}
                  <Link href="/settings?tab=connections" className="underline">
                    Settings → Connections
                  </Link>
                  .
                </DataStateNote>
              )}
              {error && <DataStateNote tone="attention">{error}</DataStateNote>}
              {coverage && !coverage.available && (
                <DataStateNote tone="attention">
                  Routes are unavailable: {coverage.reason} Nothing is drawn in their place.
                </DataStateNote>
              )}
              {coverage?.available && paths?.length === 0 && (
                <DataStateNote>No recorded route enters this area for the selected activities and range.</DataStateNote>
              )}
              {coverage?.unreadWorkouts ? (
                <DataStateNote tone="attention">
                  {coverage.unreadWorkouts} workout{coverage.unreadWorkouts === 1 ? '' : 's'}&rsquo; routes could not be read
                  this time and are missing from the map; they are retried on the next load.
                </DataStateNote>
              ) : null}
              {coverage?.truncated && (
                <DataStateNote>
                  The least-travelled paths are left off so the map stays responsive. Frame a smaller area to see every one.
                </DataStateNote>
              )}
              {coverage?.available && coverage.toleranceM != null && paths && paths.length > 0 && (
                <DataStateNote>
                  Tracks within about {coverage.toleranceM} m of each other are merged, so both sides of a street, or a
                  route walked both ways, count as one path.
                </DataStateNote>
              )}
            </div>
          </div>
          <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            {coverage?.available && coverage.highlights ? (
              <HighlightsPanel
                highlights={coverage.highlights}
                units={units}
                pinned={pinned}
                onHover={setHovered}
                onToggle={id => setPinned(p => (p === id ? null : id))}
              />
            ) : loading ? (
              <div role="status" aria-live="polite" className="space-y-3">
                <span className="sr-only">Reading routes</span>
                <Skeleton height={14} width="40%" />
                <Skeleton height={56} />
                <Skeleton height={14} width="40%" />
                <Skeleton height={56} />
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}

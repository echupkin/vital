'use client';

// ── Add (or edit) a map's area ──────────────────────────
//
// Two steps. FIND a starting point: a place search (sent through Vital's
// server to the configured geocoder), "lat, lon" typed in (parsed here, never
// sent anywhere), the browser's location, or the demo area in demo mode.
// FRAME the area: pan and zoom until the frame holds what the map should show.
// The framed box is what is saved, with a name. Routes already recorded are
// previewed across the whole map and a margin past it, not only inside the
// frame, so the reader sees how far they run beyond it without panning around;
// the workout count is for the frame alone.
//
// Editing a map opens straight on the framing step at its saved area, with the
// old box outlined. The framing step also chooses what the map is drawn on
// (provider, tile style, light or dark), previewed live in the frame.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Crosshair, MapPin, Search } from 'lucide-react';
import Link from 'next/link';
import { Button, DataStateNote, Dialog } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import {
  MAX_BBOX_SIDE_KM,
  MAX_NAME_LENGTH,
  MIN_BBOX_SIDE_M,
  bboxAround,
  bboxSizeMeters,
  parseLatLon,
  validateBBox,
  type BBox,
} from '@/lib/activity-maps/types';
import { DEMO_CENTER } from '@/lib/activity-maps/demo-area';
import { fetchCoverage, geocodeRequest, type CoverageResponse, type GeocodeResult } from '@/lib/activity-maps/client';
import { formatBoxSize } from '@/lib/activity-maps/format';
import { DEFAULT_BASEMAP, KEYLESS_DEFAULT_BASEMAP, mapProvider, type BasemapChoice } from '@/lib/activity-maps/providers';
import { LeafletMap } from './LeafletMap';
import { BasemapPicker } from './BasemapPicker';
import { providerReady } from './basemaps';
import { useTileConfig } from './TileConfigContext';

export interface MapAreaDraft {
  name: string;
  bbox: BBox;
  basemap: BasemapChoice;
}

/** The box a found point opens on: a neighbourhood, about 3 km across. */
const START_SIDE_M = 3000;
/** A found place bigger than this opens on its centre rather than its whole extent. */
const MAX_START_SIDE_M = 40_000;

function shortName(label: string): string {
  return label.split(',')[0].trim().slice(0, MAX_NAME_LENGTH) || 'My area';
}

export function MapAreaDialog({
  open,
  onClose,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  /** The map being edited; absent when adding one. */
  initial?: MapAreaDraft | null;
  onSave: (draft: MapAreaDraft) => Promise<void>;
}) {
  const { units } = useUnits();
  const meta = useDatasetMeta();
  const [step, setStep] = useState<'find' | 'frame'>(initial ? 'frame' : 'find');
  const [startBox, setStartBox] = useState<BBox | null>(initial?.bbox ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [frameBox, setFrameBox] = useState<BBox | null>(initial?.bbox ?? null);
  const [viewBox, setViewBox] = useState<BBox | null>(null);
  const tiles = useTileConfig();
  // A new map starts on CARTO when its key is configured, OpenStreetMap otherwise.
  const startBasemap = useMemo(
    () => initial?.basemap ?? (providerReady(mapProvider(DEFAULT_BASEMAP.provider), tiles.keys) ? DEFAULT_BASEMAP : KEYLESS_DEFAULT_BASEMAP),
    [initial, tiles.keys]
  );
  const [basemap, setBasemap] = useState<BasemapChoice>(startBasemap);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ around: CoverageResponse; inside: CoverageResponse } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Every opening starts fresh.
  useEffect(() => {
    if (!open) return;
    setStep(initial ? 'frame' : 'find');
    setStartBox(initial?.bbox ?? null);
    setFrameBox(initial?.bbox ?? null);
    setViewBox(null);
    setName(initial?.name ?? '');
    setBasemap(startBasemap);
    setQuery('');
    setResults(null);
    setFindError(null);
    setSaveError(null);
    setPreview(null);
    setPreviewing(false);
  }, [open, initial, startBasemap]);

  const canLocate = typeof window !== 'undefined' && window.isSecureContext && 'geolocation' in navigator;

  function startAt(box: BBox, label: string | null) {
    setStartBox(box);
    setFrameBox(box);
    if (label && !name) setName(shortName(label));
    setStep('frame');
  }

  function startAtPoint(lat: number, lon: number, label: string | null) {
    startAt(bboxAround(lat, lon, START_SIDE_M), label);
  }

  function chooseResult(r: GeocodeResult) {
    if (r.bbox) {
      const { width, height } = bboxSizeMeters(r.bbox);
      if (Math.max(width, height) <= MAX_START_SIDE_M && Math.min(width, height) >= MIN_BBOX_SIDE_M) {
        startAt(r.bbox, r.label);
        return;
      }
    }
    startAtPoint(r.lat, r.lon, r.label);
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setFindError(null);
    const point = parseLatLon(query);
    if (point) {
      startAtPoint(point.lat, point.lon, null);
      return;
    }
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await geocodeRequest(query);
      if (!res.available) setFindError(`${res.reason ?? 'Place search is not available.'} Enter "lat, lon" instead.`);
      else if (res.reason) setFindError(res.reason);
      setResults(res.results);
    } catch (error) {
      setFindError(error instanceof Error ? error.message : 'The place search failed.');
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  function locate() {
    setFindError(null);
    navigator.geolocation.getCurrentPosition(
      pos => startAtPoint(pos.coords.latitude, pos.coords.longitude, null),
      () => setFindError('Your location could not be read. Search for a place or enter "lat, lon" instead.'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 }
    );
  }

  const check = useMemo(() => (frameBox ? validateBBox(frameBox) : null), [frameBox]);
  const size = frameBox ? bboxSizeMeters(frameBox) : null;

  // Preview what is already recorded, once the map settles: the routes across
  // the map and past it (or just the frame, when the map is too large an area to
  // read), and the workouts inside the frame.
  useEffect(() => {
    if (step !== 'frame' || !frameBox || !check?.ok) {
      setPreviewing(false);
      return;
    }
    const view = viewBox ? validateBBox(viewBox) : null;
    const aroundBox = view?.ok ? view.value : check.value;
    const controller = new AbortController();
    const read = (bbox: BBox) =>
      fetchCoverage({ bbox, types: null, range: 'all', metric: 'frequency' }, controller.signal);
    const timer = setTimeout(() => {
      setPreviewing(true);
      Promise.all([read(aroundBox), aroundBox === check.value ? null : read(check.value)])
        .then(([around, inside]) => setPreview({ around, inside: inside ?? around }))
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [step, frameBox, viewBox, check]);

  async function save() {
    if (!check?.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ name: name.trim() || 'My area', bbox: check.value, basemap });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The map could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const chosen = mapProvider(basemap.provider);
  const missingKey = providerReady(chosen, tiles.keys) ? null : chosen;
  const title = initial ? 'Edit map' : 'Add a map';
  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg">
      {step === 'find' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <p className="text-sm text-text-secondary">
            Start from a place, then pan and zoom to frame the area this map should show.
          </p>
          <form onSubmit={search} className="flex gap-2" role="search">
            <label htmlFor="map-place" className="sr-only">
              Place or coordinates
            </label>
            <input
              id="map-place"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='An address or place, or "lat, lon"'
              className="min-h-[44px] flex-1 rounded-control border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-secondary"
            />
            <Button type="submit" variant="primary" disabled={searching || !query.trim()}>
              <Search size={14} className="mr-1.5" aria-hidden="true" />
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </form>
          {findError && <DataStateNote tone="attention">{findError}</DataStateNote>}
          {results && results.length === 0 && !findError && (
            <p className="text-sm text-text-secondary">Nothing matched. Try a broader name, or enter &quot;lat, lon&quot;.</p>
          )}
          {results && results.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0">
              {results.map(r => (
                <li key={`${r.lat},${r.lon},${r.label}`}>
                  <button
                    type="button"
                    onClick={() => chooseResult(r)}
                    className="flex w-full items-start gap-2 rounded-control px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-muted"
                  >
                    <MapPin size={14} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {canLocate && (
              <Button type="button" onClick={locate}>
                <Crosshair size={14} className="mr-1.5" aria-hidden="true" />
                Use my location
              </Button>
            )}
            {meta.mode === 'demo' && (
              <Button type="button" onClick={() => startAtPoint(DEMO_CENTER.lat, DEMO_CENTER.lon, DEMO_CENTER.label)}>
                Use the demo area
              </Button>
            )}
          </div>
          <DataStateNote>
            A place search is sent from Vital&rsquo;s server to the configured geocoder (OpenStreetMap Nominatim unless
            changed). Coordinates you type are read here and are not sent anywhere.
          </DataStateNote>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {startBox && (
            <LeafletMap
              className="min-h-[260px] flex-1"
              bbox={startBox}
              basemap={basemap}
              paths={preview?.around.paths ?? null}
              metric="frequency"
              scale={preview?.around.scale ?? null}
              frame
              onFrameChange={(frame, view) => {
                setFrameBox(frame);
                setViewBox(view);
              }}
              outline={initial?.bbox ?? null}
              busy={previewing ? 'Reading routes…' : null}
              notice={missingKey?.key && (
                <>
                  {missingKey.label} needs an API key and none is configured, so its tiles are requested without one and
                  may not load. Set <code>{missingKey.key.envVar}</code> (see{' '}
                  <Link href="/settings?tab=connections" className="underline">
                    Settings → Connections
                  </Link>
                  ).
                </>
              )}
              ariaLabel="Frame the map's area"
            />
          )}
          <div className="flex flex-col gap-1 text-xs text-text-secondary">
            Map style
            <BasemapPicker value={basemap} onChange={setBasemap} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-text-secondary">
              Name
              <input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={e => setName(e.target.value)}
                placeholder="My area"
                className="min-h-[44px] rounded-control border border-border bg-surface px-3 text-sm text-text-primary"
              />
            </label>
            <div className="text-xs text-text-secondary tnum" aria-live="polite">
              {size ? formatBoxSize(size.width, size.height, units) : ''}
              {preview?.inside.available && preview.inside.highlights
                ? ` · ${preview.inside.highlights.totals.workouts} workout${preview.inside.highlights.totals.workouts === 1 ? '' : 's'} inside`
                : ''}
            </div>
          </div>
          {check && !check.ok && (
            <DataStateNote tone="attention">
              The frame must be between {MIN_BBOX_SIDE_M} m and {MAX_BBOX_SIDE_KM} km on a side. Zoom{' '}
              {size && Math.max(size.width, size.height) > MAX_BBOX_SIDE_KM * 1000 ? 'in' : 'out'} to fit.
            </DataStateNote>
          )}
          {saveError && <DataStateNote tone="attention">{saveError}</DataStateNote>}
          <div className="flex flex-wrap justify-between gap-2">
            {!initial ? (
              <Button type="button" variant="ghost" onClick={() => setStep('find')}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={!check?.ok || saving} onClick={save}>
                {saving ? 'Saving…' : initial ? 'Save' : 'Add map'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

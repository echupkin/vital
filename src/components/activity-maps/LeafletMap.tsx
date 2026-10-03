'use client';

// ── LeafletMap: one coverage map ────────────────────────
//
// Plain Leaflet behind a small React shell. Leaflet touches `window` on import,
// so it is loaded with a dynamic import, and only once the map scrolls near the
// viewport: a page of several maps does not start every one at once.
//
//   * Paths draw on one canvas renderer. Frequency is one stroke per path; a
//     per-vertex metric (heart rate) shades along the line, drawn as runs of
//     segments that share a colour step, so a long path is a handful of strokes
//     rather than one per segment.
//   * Every stroke sits on a thin halo in the map's own surface colour, so a line
//     stays legible over busy streets and terrain.
//   * The page does not lose its scroll to the map: wheel zoom turns on when the
//     map is clicked and off when the pointer leaves it.
//   * While paths are read (`busy`), a bar sweeps the top edge. It fades in after
//     a moment, so an answer from the route cache never flashes it.
//   * The container is `isolate`d, so Leaflet's pane z-indices (400-1000) stay
//     inside the map instead of floating over the top bar and dialogs.
//
// With `frame`, the map shows an inset frame and reports the area inside it as
// the reader pans and zooms: that is how the add-map dialog picks a box.

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as Leaflet from 'leaflet';
import { Loader2 } from 'lucide-react';
import type { BBox } from '@/lib/activity-maps/types';
import type { BasemapChoice } from '@/lib/activity-maps/providers';
import type { CoveragePath } from '@/lib/activity-maps/coverage';
import {
  MISSING_COLOR,
  lineWidth,
  widthAt,
  pathMetric,
  rampColor,
  scalePosition,
  type MetricScale,
  type PathMetricId,
} from '@/lib/activity-maps/metrics';
import { formatDayKeyShort } from '@/lib/analytics/windows';
import { MAX_ZOOM, TILE_REFERRER_POLICY, resolveTiles } from './basemaps';
import { useTileConfig } from './TileConfigContext';
import { useColorScheme } from './useColorScheme';

type LeafletModule = typeof Leaflet;

/** Where the map should look; a new `key` moves it even to the same place. */
export type MapFocus =
  | { key: number; kind: 'bbox'; bbox: BBox }
  | { key: number; kind: 'point'; lat: number; lon: number; zoom: number };

export interface LeafletMapProps {
  /** The area the map opens on and returns to on "reset view". */
  bbox: BBox;
  basemap: BasemapChoice;
  paths: CoveragePath[] | null;
  metric: PathMetricId;
  scale: MetricScale | null;
  /** A stretch to draw emphasised on top, as polylines of flat [lat, lon, …]. */
  emphasis?: number[][] | null;
  focus?: MapFocus | null;
  /** Show the selection frame and report the framed area. */
  frame?: boolean;
  /**
   * The framed area, and the area around it worth drawing routes for: the whole
   * map with a margin, so routes are seen running out past the frame.
   */
  onFrameChange?: (frame: BBox, view: BBox) => void;
  /** Draw the saved area's outline (the dialog, when editing). */
  outline?: BBox | null;
  className?: string;
  /** Extra controls laid over the map's top-right corner. */
  overlay?: ReactNode;
  /**
   * What the map is waiting for, while its paths are read: a bar sweeps the top
   * edge and, outside the framing dialog, a scrim and this label sit over it.
   */
  busy?: string | null;
  /** A note laid along the map's bottom edge, where it does not change the map's size. */
  notice?: ReactNode;
  ariaLabel: string;
}

/**
 * Every map card is this shape, and so is the frame a map's area is chosen
 * with: what the reader frames is exactly what the card shows.
 */
export const MAP_ASPECT = 3 / 2;

/** How far one +/- press zooms while framing an area: a quarter level. */
export const FRAME_ZOOM_STEP = 0.25;

/** How far past the visible map the framing dialog reads routes, as a share of its size on each side. */
const VIEW_MARGIN = 0.25;

/** The least margin round the frame, as a share of the container on each side. */
export const FRAME_MARGIN = 0.08;

/** The frame: the largest MAP_ASPECT rectangle centred inside the margins, in container pixels. */
export function frameRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const availW = width * (1 - 2 * FRAME_MARGIN);
  const availH = height * (1 - 2 * FRAME_MARGIN);
  const w = Math.min(availW, availH * MAP_ASPECT);
  const h = w / MAP_ASPECT;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

const HALO = { light: 'rgba(255,255,255,0.85)', dark: 'rgba(12,13,17,0.7)' };
const EMPHASIS = { light: '#14161C', dark: '#F2F3F6' };
/**
 * Behind the tiles, close to their own ground in each rendering, in place of
 * Leaflet's light grey #ddd. Safari clips the tile layer to the rounded box a
 * device pixel inside its top and left edges, and a grey sliver there reads as
 * a heavier border on those two sides, plainest on a dark map.
 */
const TILE_GROUND = { light: '#f4f4f2', dark: '#0b0b0c' };
/** Colour steps a shaded line is quantised into. */
const STEPS = 32;

function bounds(L: LeafletModule, b: BBox): Leaflet.LatLngBounds {
  return L.latLngBounds([b.south, b.west], [b.north, b.east]);
}

/** Show a box: filling the map, or, when choosing an area, filling the frame. */
function fit(L: LeafletModule, map: Leaflet.Map, box: BBox, frame: boolean): void {
  const size = map.getSize();
  const r = frame ? frameRect(size.x, size.y) : { x: 0, y: 0 };
  map.fitBounds(bounds(L, box), { animate: false, padding: [r.x, r.y] });
}

/**
 * A tile layer whose tiles overlap their neighbours by a pixel. At a fractional
 * zoom (the maps fit their box exactly, so they rarely sit on a whole level) each
 * tile is scaled to a sub-pixel size, and the browser leaves hairline gaps where
 * they meet: the map's light background shows through as a faint grid, plainest
 * on a dark style. The extra pixel is drawn under the next tile, so nothing
 * shifts. Leaflet's own answer (tiles blended `plus-lighter`, so the soft edges
 * of neighbours add up to opaque) leaves a faint grid at these scales, and would
 * add the overlapping pixels into a lighter one, so these tiles blend normally
 * (the `vital-tiles` rule in globals.css).
 */
function seamlessTileLayer(L: LeafletModule, url: string, options: Leaflet.TileLayerOptions): Leaflet.TileLayer {
  const Seamless = L.TileLayer.extend({
    _initTile(this: Leaflet.TileLayer, tile: HTMLElement) {
      (L.TileLayer.prototype as unknown as { _initTile(t: HTMLElement): void })._initTile.call(this, tile);
      const size = this.getTileSize();
      tile.style.width = `${size.x + 1}px`;
      tile.style.height = `${size.y + 1}px`;
    },
  }) as unknown as new (url: string, options: Leaflet.TileLayerOptions) => Leaflet.TileLayer;
  return new Seamless(url, options);
}

type PolylineClass = new (latlngs: Leaflet.LatLngExpression[] | Leaflet.LatLngExpression[][], options?: Leaflet.PolylineOptions) => Leaflet.Polyline;
const exactPolylines = new WeakMap<LeafletModule, PolylineClass>();

/**
 * A polyline drawn at its true sub-pixel position. Leaflet rounds every vertex
 * to a whole CSS pixel before drawing (latLngToLayerPoint), which on a 2x
 * canvas snaps a dense GPS track onto a two-device-pixel grid: lines zigzag
 * and their edges look aliased, plainest as dark lines on a light map. This
 * projects the same way without the rounding.
 */
function exactPolyline(
  L: LeafletModule,
  latlngs: Leaflet.LatLngExpression[] | Leaflet.LatLngExpression[][],
  options: Leaflet.PolylineOptions
): Leaflet.Polyline {
  let Exact = exactPolylines.get(L);
  if (!Exact) {
    Exact = L.Polyline.extend({
      _projectLatlngs(
        this: Leaflet.Polyline & { _map: Leaflet.Map; _projectLatlngs: (...a: unknown[]) => void },
        latlngs: unknown[],
        result: Leaflet.Point[][],
        projectedBounds: Leaflet.Bounds
      ) {
        if (latlngs[0] instanceof L.LatLng) {
          const origin = this._map.getPixelOrigin();
          const ring = (latlngs as Leaflet.LatLng[]).map(ll => this._map.project(ll).subtract(origin));
          for (const p of ring) projectedBounds.extend(p);
          result.push(ring);
        } else {
          for (const part of latlngs) this._projectLatlngs(part, result, projectedBounds);
        }
      },
    }) as unknown as PolylineClass;
    exactPolylines.set(L, Exact);
  }
  return new Exact(latlngs, options);
}

function latLngs(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function describe(path: CoveragePath, value: string | null): string {
  const when =
    path.first === path.last ? formatDayKeyShort(path.first) : `${formatDayKeyShort(path.first)} – ${formatDayKeyShort(path.last)}`;
  const lines = [
    `<strong>${path.count}× </strong>${escapeHtml(path.types.join(', '))}`,
    escapeHtml(when),
  ];
  if (value) lines.push(escapeHtml(value));
  return lines.join('<br>');
}

export function LeafletMap({
  bbox,
  basemap,
  paths,
  metric,
  scale,
  emphasis,
  focus,
  frame = false,
  onFrameChange,
  outline,
  className = '',
  overlay,
  busy = null,
  notice,
  ariaLabel,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const rendererRef = useRef<Leaflet.Canvas | null>(null);
  const [L, setL] = useState<LeafletModule | null>(null);
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();
  const tiles = useTileConfig();
  // Memoised: the tile and path layers are rebuilt whenever this changes, and a
  // fresh object on every render (a window focus re-syncs the preferences and
  // re-renders the page) tore down and redrew the whole map each time.
  // Keyed by value: a new choice object with the same fields is not a change.
  const key = tiles.keys[basemap.provider];
  const base = useMemo(
    () => resolveTiles({ provider: basemap.provider, style: basemap.style, appearance: basemap.appearance }, key ? { [basemap.provider]: key } : {}, scheme),
    [basemap.provider, basemap.style, basemap.appearance, key, scheme]
  );
  const frameCb = useRef(onFrameChange);
  frameCb.current = onFrameChange;
  const initialBox = useRef(bbox);
  const [frameBox, setFrameBox] = useState<ReturnType<typeof frameRect> | null>(null);

  // The bordered box is sized in whole pixels. Its slot is usually fractional
  // (a 3:2 card 692 px wide is 461.33 px tall), and Safari, which draws the
  // map as its own GPU layer, then smears the bottom and right border across
  // two pixels, so they read fainter than the crisp top and left.
  const sizeRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = sizeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setBox(prev => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load Leaflet once the map is near the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || L) return;
    let cancelled = false;
    const load = () =>
      import('leaflet').then(mod => {
        if (!cancelled) setL(((mod as unknown as { default?: LeafletModule }).default ?? mod) as LeafletModule);
      });
    if (typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [L]);

  // Create the map.
  useEffect(() => {
    const el = containerRef.current;
    if (!L || !el) return;
    const map = L.map(el, {
      zoomControl: true,
      // A card sits in a scrolling page, so the wheel zooms only after a click.
      // The framing dialog has no page to scroll, and the wheel is the finest
      // control there is for choosing an area, so it is on from the start.
      scrollWheelZoom: frame,
      attributionControl: true,
      maxZoom: MAX_ZOOM,
      // No snapping: a whole-level zoom can show up to twice the framed area,
      // so the box is fitted exactly.
      zoomSnap: 0,
      // A whole level doubles or halves the area. That is fine for looking
      // around a card, too coarse for framing one: there the buttons and keys
      // step a quarter level (~19% in width) and the wheel moves at half its
      // usual rate.
      zoomDelta: frame ? FRAME_ZOOM_STEP : 1,
      wheelPxPerZoomLevel: frame ? 120 : 60,
    });
    map.attributionControl.setPrefix(false);
    rendererRef.current = L.canvas({ padding: 0.5, tolerance: 6 });
    mapRef.current = map;
    fit(L, map, initialBox.current, frame);

    if (!frame) {
      map.on('click', () => map.scrollWheelZoom.enable());
      map.on('mouseout', () => map.scrollWheelZoom.disable());
    }

    const report = () => {
      const cb = frameCb.current;
      if (!cb) return;
      const size = map.getSize();
      const r = frameRect(size.x, size.y);
      const nw = map.containerPointToLatLng([r.x, r.y]);
      const se = map.containerPointToLatLng([r.x + r.width, r.y + r.height]);
      const view = map.getBounds().pad(VIEW_MARGIN);
      cb(
        { south: se.lat, west: nw.lng, north: nw.lat, east: se.lng },
        { south: view.getSouth(), west: view.getWest(), north: view.getNorth(), east: view.getEast() }
      );
    };
    map.on('moveend', report);

    // A map first laid out while hidden, or resized since, measures itself
    // again; otherwise it keeps the size it was created at and sticks there.
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      const size = map.getSize();
      setFrameBox(frameRect(size.x, size.y));
    });
    ro.observe(el);
    setReady(true);
    report();
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      rendererRef.current = null;
      setReady(false);
    };
  }, [L, frame]);

  // Tiles: the provider, and its light or dark rendering.
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !ready) return;
    const d = base;
    const layer = seamlessTileLayer(L, d.url, {
      className: 'vital-tiles',
      ...(d.subdomains ? { subdomains: d.subdomains } : {}),
      referrerPolicy: TILE_REFERRER_POLICY,
      maxNativeZoom: d.maxNativeZoom,
      maxZoom: MAX_ZOOM,
      attribution: d.attribution,
      detectRetina: false,
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [L, ready, base]);

  // Coverage paths.
  useEffect(() => {
    const map = mapRef.current;
    const renderer = rendererRef.current;
    if (!L || !map || !renderer || !ready || !paths || paths.length === 0) return;
    const m = pathMetric(metric);
    const tone = base.tone;
    const ramp = m.ramp[tone];
    const maxCount = paths.reduce((a, p) => Math.max(a, p.count), 1);

    const halos = L.layerGroup();
    const lines = L.featureGroup();
    for (const path of paths) {
      const pts = latLngs(path.coords);
      if (pts.length < 2) continue;

      if (!path.values) {
        const w = lineWidth(m, path.count, maxCount);
        const color = scale ? rampColor(ramp, scalePosition(m, scale, path.count)) : ramp[ramp.length - 1];
        exactPolyline(L, pts, { renderer, color: HALO[tone], weight: w + 3, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(halos);
        const line = exactPolyline(L, pts, { renderer, color, weight: w, opacity: 1, lineCap: 'round', lineJoin: 'round' });
        (line.options as { meta?: string }).meta = describe(path, null);
        line.addTo(lines);
        continue;
      }

      // Shade along the line, from values smoothed along the streets: one run
      // per stretch of segments on one step, its colour and (for frequency) its
      // width both read from the step, so neither jumps where GPS scatter split
      // a street into strands.
      const values = path.values;
      const stepOf = (i: number): number => {
        const a = values[i];
        const b = values[i + 1];
        const v = a == null ? b : b == null ? a : (a + b) / 2;
        if (v == null || !scale) return -1;
        return Math.round(scalePosition(m, scale, v) * (STEPS - 1));
      };
      let runStart = 0;
      let runStep = stepOf(0);
      const flush = (end: number) => {
        const segment = pts.slice(runStart, end + 1);
        const known = values.slice(runStart, end + 1).filter((v): v is number => v != null);
        const mean = known.length > 0 ? known.reduce((s, v) => s + v, 0) / known.length : null;
        const t = runStep < 0 ? 0 : runStep / (STEPS - 1);
        const color = runStep < 0 ? MISSING_COLOR : rampColor(ramp, t);
        const w = widthAt(m, t);
        exactPolyline(L, segment, { renderer, color: HALO[tone], weight: w + 3, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(halos);
        const line = exactPolyline(L, segment, { renderer, color, weight: w, opacity: 1, lineCap: 'round', lineJoin: 'round' });
        (line.options as { meta?: string }).meta = describe(path, mean == null ? 'No reading here' : `~${m.format(mean)}`);
        line.addTo(lines);
      };
      for (let i = 1; i < pts.length - 1; i++) {
        const step = stepOf(i);
        if (step !== runStep) {
          flush(i);
          runStart = i;
          runStep = step;
        }
      }
      flush(pts.length - 1);
    }

    // One shared tooltip for every line, rather than one bound to each.
    const tip = L.tooltip({ sticky: true, direction: 'top', offset: [0, -6], opacity: 0.95 });
    lines.on('mousemove', (e: Leaflet.LeafletMouseEvent) => {
      const meta = ((e.propagatedFrom as Leaflet.Polyline | undefined)?.options as { meta?: string } | undefined)?.meta;
      if (!meta) return;
      tip.setLatLng(e.latlng).setContent(meta);
      if (!map.hasLayer(tip)) tip.addTo(map);
    });
    lines.on('mouseout', () => tip.remove());

    halos.addTo(map);
    lines.addTo(map);
    return () => {
      tip.remove();
      lines.remove();
      halos.remove();
    };
  }, [L, ready, paths, metric, scale, base]);

  // The emphasised stretch, from the highlights panel.
  useEffect(() => {
    const map = mapRef.current;
    const renderer = rendererRef.current;
    if (!L || !map || !renderer || !ready || !emphasis || emphasis.length === 0) return;
    const tone = base.tone;
    const lines = emphasis.map(latLngs).filter(l => l.length >= 2);
    const group = L.layerGroup([
      exactPolyline(L, lines, { renderer, color: HALO[tone], weight: 11, opacity: 1, interactive: false, lineCap: 'round' }),
      exactPolyline(L, lines, { renderer, color: EMPHASIS[tone], weight: 6, opacity: 1, interactive: false, lineCap: 'round', dashArray: '1 9' }),
    ]);
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [L, ready, emphasis, base]);

  // The saved area's outline, while editing it.
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !ready || !outline) return;
    const rect = L.rectangle(bounds(L, outline), {
      color: EMPHASIS[base.tone],
      weight: 1.5,
      dashArray: '4 4',
      fill: false,
      interactive: false,
    });
    rect.addTo(map);
    return () => {
      rect.remove();
    };
  }, [L, ready, outline, base.tone]);

  // Follow the area: a box saved from the dialog moves the map to it, without a
  // reload. The first fit happens when the map is created.
  const fitted = useRef(bbox);
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !ready) return;
    const prev = fitted.current;
    if (prev.south === bbox.south && prev.west === bbox.west && prev.north === bbox.north && prev.east === bbox.east) return;
    fitted.current = bbox;
    fit(L, map, bbox, frame);
    // The box is compared by value; a new object with the same corners is not a move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, ready, frame, bbox.south, bbox.west, bbox.north, bbox.east]);

  // Move when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || !ready || !focus) return;
    if (focus.kind === 'bbox') fit(L, map, focus.bbox, frame);
    else map.setView([focus.lat, focus.lon], focus.zoom, { animate: false });
  }, [L, ready, focus, frame]);

  return (
    <div ref={sizeRef} className={`relative ${className}`}>
      <div
        className="absolute left-0 top-0 isolate overflow-hidden rounded-card border border-border bg-surface-muted"
        style={box ? { width: box.width, height: box.height } : { right: 0, bottom: 0 }}
      >
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ background: TILE_GROUND[base.tone] }}
          role="region"
          aria-label={ariaLabel}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-text-secondary">Loading map…</div>
        )}
        {frame && ready && frameBox && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[1000] rounded-md border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
            style={{ left: frameBox.x, top: frameBox.y, width: frameBox.width, height: frameBox.height }}
          />
        )}
        {busy && ready && (
          <div role="status" className="map-busy pointer-events-none absolute inset-0 z-[1000]">
            <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden">
              <div className="map-busy-bar h-full rounded-full" />
            </div>
            {frame ? (
              <span className="sr-only">{busy}</span>
            ) : (
              <div className="map-busy-scrim absolute inset-0 flex items-center justify-center">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs text-text-primary shadow-pop">
                  <Loader2 size={14} className="animate-spin text-primary" aria-hidden="true" />
                  {busy}
                </span>
              </div>
            )}
          </div>
        )}
        {overlay && <div className="absolute right-2 top-2 z-[1000] flex gap-1">{overlay}</div>}
        {notice && (
          <div className="absolute inset-x-2 bottom-6 z-[1000] rounded-control border border-border bg-surface-elevated px-3 py-2 text-xs text-text-primary shadow-pop">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fit the map back to an area: what "reset view" does. */
export function nextFocus(prev: MapFocus | null | undefined, bbox: BBox): MapFocus {
  return { key: (prev?.key ?? 0) + 1, kind: 'bbox', bbox };
}

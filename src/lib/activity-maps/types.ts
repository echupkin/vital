// ── Activity maps: shared types and pure rules ──────────
//
// A map is an AREA the reader chose (a bounding box and a name) plus the display
// choices saved with it: which activities to draw, what the line colour means,
// the basemap and the date range. It is configuration only: a box and a few
// ids. Routes, heart rate and every other observation are read live from the
// source on each request and never stored with a map (see
// db/migrations/0009-activity-maps.sql).
//
// Pure and import-light, so the server store, the API routes, the client and
// the tests share one validator and one set of defaults.

import { isPathMetricId, DEFAULT_PATH_METRIC, type PathMetricId } from './metrics';
import { DEFAULT_BASEMAP, readStoredBasemap, validateBasemapChoice, type BasemapChoice } from './providers';

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A trailing window in days, or 'all' for every recorded workout. */
export type MapRange = 'all' | number;

export interface MapSettings {
  /** Activity types to draw; null means every type with a route in the area. */
  activityTypes: string[] | null;
  metric: PathMetricId;
  /** The tile provider, style and light/dark appearance the map is drawn on. */
  basemap: BasemapChoice;
  range: MapRange;
}

export interface ActivityMap {
  id: string;
  name: string;
  bbox: BBox;
  settings: MapSettings;
  position: number;
  revision: number;
  updatedAt: string;
}

/** What a create or an update carries: the editable fields. */
export interface ActivityMapInput {
  name: string;
  bbox: BBox;
  settings: MapSettings;
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  activityTypes: null,
  metric: DEFAULT_PATH_METRIC,
  basemap: DEFAULT_BASEMAP,
  range: 'all',
};

export function defaultMapSettings(): MapSettings {
  return { ...DEFAULT_MAP_SETTINGS, basemap: { ...DEFAULT_MAP_SETTINGS.basemap } };
}

export const MAX_NAME_LENGTH = 80;
export const MAX_ACTIVITY_TYPES = 50;
export const MAX_RANGE_DAYS = 3650;
/** The largest box a map may cover, per side. Coverage at this scale is a region, not a street map. */
export const MAX_BBOX_SIDE_KM = 400;
/** The smallest, per side: below this a GPS track is mostly noise. */
export const MIN_BBOX_SIDE_M = 100;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownFields(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter(key => !allowed.includes(key));
}

// ── Geometry helpers shared with the client ───────────

/** Metres per degree of latitude; longitude is this scaled by cos(latitude). */
export const M_PER_DEG_LAT = 111_320;

export function bboxSizeMeters(bbox: BBox): { width: number; height: number } {
  const midLat = (bbox.north + bbox.south) / 2;
  return {
    width: (bbox.east - bbox.west) * M_PER_DEG_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6),
    height: (bbox.north - bbox.south) * M_PER_DEG_LAT,
  };
}

/** A box `widthM` × `heightM` centred on a point, clamped at the poles and the antimeridian. */
export function bboxAround(lat: number, lon: number, widthM: number, heightM: number = widthM): BBox {
  const halfLat = heightM / 2 / M_PER_DEG_LAT;
  const halfLon = widthM / 2 / (M_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  return {
    south: Math.max(lat - halfLat, -90),
    west: Math.max(lon - halfLon, -180),
    north: Math.min(lat + halfLat, 90),
    east: Math.min(lon + halfLon, 180),
  };
}

export function validateBBox(value: unknown): Validated<BBox> {
  if (!isRecord(value)) return { ok: false, errors: ['bbox must be an object with south, west, north and east.'] };
  const extra = unknownFields(value, ['south', 'west', 'north', 'east']);
  if (extra.length > 0) return { ok: false, errors: [`bbox has unknown fields: ${extra.join(', ')}.`] };
  const { south, west, north, east } = value;
  const nums = [south, west, north, east];
  if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) {
    return { ok: false, errors: ['bbox south, west, north and east must be finite numbers.'] };
  }
  const box = { south, west, north, east } as BBox;
  const errors: string[] = [];
  if (box.south < -90 || box.north > 90) errors.push('bbox latitude must be within -90..90.');
  if (box.west < -180 || box.east > 180) errors.push('bbox longitude must be within -180..180 (a box may not cross the antimeridian).');
  if (box.south >= box.north) errors.push('bbox south must be below north.');
  if (box.west >= box.east) errors.push('bbox west must be left of east.');
  if (errors.length === 0) {
    const { width, height } = bboxSizeMeters(box);
    if (Math.max(width, height) > MAX_BBOX_SIDE_KM * 1000) errors.push(`bbox may be at most ${MAX_BBOX_SIDE_KM} km on a side.`);
    if (Math.min(width, height) < MIN_BBOX_SIDE_M) errors.push(`bbox must be at least ${MIN_BBOX_SIDE_M} m on a side.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: box };
}

function validateRange(value: unknown): MapRange | null {
  if (value === 'all') return 'all';
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_RANGE_DAYS) return value;
  return null;
}

/**
 * Settings read strictly on the way in: an unknown field, metric or basemap is an
 * error a client should hear about.
 */
export function validateMapSettings(value: unknown): Validated<MapSettings> {
  if (!isRecord(value)) return { ok: false, errors: ['settings must be an object.'] };
  const extra = unknownFields(value, ['activityTypes', 'metric', 'basemap', 'range']);
  if (extra.length > 0) return { ok: false, errors: [`settings has unknown fields: ${extra.join(', ')}.`] };
  const errors: string[] = [];
  const types = value.activityTypes;
  let activityTypes: string[] | null = null;
  if (types !== null && types !== undefined) {
    if (
      !Array.isArray(types) ||
      types.length > MAX_ACTIVITY_TYPES ||
      !types.every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 100)
    ) {
      errors.push(`settings.activityTypes must be null or up to ${MAX_ACTIVITY_TYPES} non-empty names.`);
    } else {
      activityTypes = [...new Set(types.map(t => t.trim()))];
    }
  }
  const metric = value.metric ?? DEFAULT_MAP_SETTINGS.metric;
  if (!isPathMetricId(metric)) errors.push('settings.metric is not a known path metric.');
  const basemap = validateBasemapChoice(value.basemap ?? DEFAULT_MAP_SETTINGS.basemap);
  if (!basemap.ok) errors.push(basemap.error);
  const range = validateRange(value.range ?? DEFAULT_MAP_SETTINGS.range);
  if (range === null) errors.push(`settings.range must be "all" or a whole number of days, 1-${MAX_RANGE_DAYS}.`);
  if (errors.length > 0 || !basemap.ok) return { ok: false, errors };
  return {
    ok: true,
    value: { activityTypes, metric: metric as PathMetricId, basemap: basemap.value, range: range as MapRange },
  };
}

/**
 * Settings read tolerantly from storage: a metric or basemap this build no longer
 * knows reads as the default, so one stale id never loses the whole map.
 */
export function readStoredSettings(value: unknown): MapSettings {
  const base = defaultMapSettings();
  if (!isRecord(value)) return base;
  const types = value.activityTypes;
  return {
    activityTypes:
      Array.isArray(types) && types.every(t => typeof t === 'string') ? (types as string[]) : null,
    metric: isPathMetricId(value.metric) ? value.metric : base.metric,
    basemap: readStoredBasemap(value.basemap),
    range: validateRange(value.range) ?? base.range,
  };
}

export function validateMapInput(value: unknown): Validated<ActivityMapInput> {
  if (!isRecord(value)) return { ok: false, errors: ['The body must be a JSON object.'] };
  const extra = unknownFields(value, ['name', 'bbox', 'settings', 'revision']);
  if (extra.length > 0) return { ok: false, errors: [`Unknown fields: ${extra.join(', ')}.`] };
  const errors: string[] = [];
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) errors.push(`name must be 1-${MAX_NAME_LENGTH} characters.`);
  const bbox = validateBBox(value.bbox);
  if (!bbox.ok) errors.push(...bbox.errors);
  const settings = value.settings === undefined ? ({ ok: true, value: defaultMapSettings() } as const) : validateMapSettings(value.settings);
  if (!settings.ok) errors.push(...settings.errors);
  if (errors.length > 0 || !bbox.ok || !settings.ok) return { ok: false, errors };
  return { ok: true, value: { name, bbox: bbox.value, settings: settings.value } };
}

// ── Coordinate input ──────────────────────────────────

/**
 * "37.77, -122.48" (or with a space, or a semicolon) read as a point. Anything
 * that parses here is handled in the browser and never sent to a geocoder.
 */
export function parseLatLon(input: string): { lat: number; lon: number } | null {
  const match = input.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

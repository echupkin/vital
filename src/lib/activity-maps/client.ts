// ── Activity maps: the browser's reads and writes ───────
//
// Everything the Maps page and the add-map dialog ask the server for. The
// browser never calls the health source or the geocoder itself; every request
// here is same-origin. A failure is reported as the route's own message, never
// replaced with an empty map.

import type { ActivityMap, ActivityMapInput, BBox, MapRange } from './types';
import type { PathMetricId } from './metrics';
import type { CoverageResponse } from './service';
import type { GeocodeResult } from './geocode';
import type { TileConfig } from './tiles';

export type { CoverageResponse, GeocodeResult };

export class MapRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MapRequestError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `The request failed (HTTP ${res.status}).`;
    throw new MapRequestError(message, res.status);
  }
  return body as T;
}

export async function fetchMaps(): Promise<{ maps: ActivityMap[]; tiles: TileConfig }> {
  return request<{ maps: ActivityMap[]; tiles: TileConfig }>('/api/activity-maps');
}

export async function createMapRequest(input: ActivityMapInput): Promise<ActivityMap> {
  return (await request<{ map: ActivityMap }>('/api/activity-maps', { method: 'POST', body: JSON.stringify(input) })).map;
}

export async function updateMapRequest(id: string, input: ActivityMapInput, revision: number): Promise<ActivityMap> {
  return (
    await request<{ map: ActivityMap }>(`/api/activity-maps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, revision }),
    })
  ).map;
}

export async function deleteMapRequest(id: string, revision: number): Promise<void> {
  await request(`/api/activity-maps/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' });
}

export async function reorderMapsRequest(order: string[]): Promise<ActivityMap[]> {
  return (await request<{ maps: ActivityMap[] }>('/api/activity-maps', { method: 'PUT', body: JSON.stringify({ order }) })).maps;
}

export interface CoverageParams {
  bbox: BBox;
  types: string[] | null;
  range: MapRange;
  metric: PathMetricId;
}

export function coverageUrl(p: CoverageParams): string {
  const q = new URLSearchParams();
  // Rounded so a box that moved by a rounding error reuses the server's cache.
  q.set('south', p.bbox.south.toFixed(6));
  q.set('west', p.bbox.west.toFixed(6));
  q.set('north', p.bbox.north.toFixed(6));
  q.set('east', p.bbox.east.toFixed(6));
  for (const t of p.types ?? []) q.append('type', t);
  q.set('range', String(p.range));
  q.set('metric', p.metric);
  return `/api/activity-coverage?${q.toString()}`;
}

export async function fetchCoverage(p: CoverageParams, signal?: AbortSignal): Promise<CoverageResponse> {
  return request<CoverageResponse>(coverageUrl(p), { signal });
}

export interface GeocodeResponse {
  available: boolean;
  reason: string | null;
  results: GeocodeResult[];
}

export async function geocodeRequest(q: string): Promise<GeocodeResponse> {
  return request<GeocodeResponse>(`/api/geocode?q=${encodeURIComponent(q)}`);
}

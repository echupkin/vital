// ── Place search for the add-map dialog (SERVER ONLY) ───
//
// The dialog turns a typed place into a starting point by asking a geocoder,
// OpenStreetMap Nominatim by default. The request goes from the server, so the
// browser talks only to Vital, but the TYPED TEXT does leave the network: that
// is what a geocoder is. `GEOCODER_URL=off` turns the search off entirely; the
// dialog still takes "lat, lon" (parsed in the browser) and "use my location".
//
// Nominatim's usage policy asks for at most one request a second, an
// identifying User-Agent, and no search-as-you-type; the dialog searches on
// submit only, and this module spaces requests at least a second apart across
// the process. Neither the query nor the results are logged.

export const DEFAULT_GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
export const GEOCODER_TIMEOUT_MS = 8000;
export const GEOCODER_MIN_INTERVAL_MS = 1000;
export const MAX_QUERY_LENGTH = 200;
const DEFAULT_USER_AGENT = 'Vital (self-hosted health dashboard)';

/** Nominatim asks for an identifying agent; GEOCODER_USER_AGENT can add a contact. */
function userAgent(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GEOCODER_USER_AGENT ?? '').trim() || DEFAULT_USER_AGENT;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  /** The place's own extent, when the geocoder gives one. */
  bbox: { south: number; west: number; north: number; east: number } | null;
}

/** The configured endpoint, or null when search is turned off. */
export function geocoderUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.GEOCODER_URL ?? '').trim();
  if (raw.toLowerCase() === 'off') return null;
  return raw || DEFAULT_GEOCODER_URL;
}

export class GeocodeError extends Error {}

let nextSlot = 0;

/** Wait for this request's turn, keeping requests a second apart. */
async function takeSlot(now: () => number = Date.now): Promise<void> {
  const at = Math.max(now(), nextSlot);
  nextSlot = at + GEOCODER_MIN_INTERVAL_MS;
  const wait = at - now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
}

/** Nominatim's jsonv2 rows → results; anything malformed is skipped. */
export function parseNominatim(body: unknown): GeocodeResult[] {
  if (!Array.isArray(body)) throw new GeocodeError('The place search answered with something other than a list.');
  const out: GeocodeResult[] = [];
  for (const row of body) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const lat = toNumber(r.lat);
    const lon = toNumber(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = typeof r.display_name === 'string' ? r.display_name : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    let bbox: GeocodeResult['bbox'] = null;
    if (Array.isArray(r.boundingbox) && r.boundingbox.length === 4) {
      // Nominatim orders it [south, north, west, east].
      const [south, north, west, east] = r.boundingbox.map(toNumber);
      if ([south, north, west, east].every(Number.isFinite) && south < north && west < east) {
        bbox = { south, west, north, east };
      }
    }
    out.push({ label, lat, lon, bbox });
  }
  return out;
}

export async function geocode(
  query: string,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<GeocodeResult[]> {
  const url = geocoderUrl(deps.env);
  if (!url) throw new GeocodeError('Place search is turned off on this server (GEOCODER_URL=off).');
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) return [];
  await takeSlot();
  const target = new URL(url);
  target.searchParams.set('q', q);
  target.searchParams.set('format', 'jsonv2');
  target.searchParams.set('limit', '6');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(target, {
      headers: { 'User-Agent': userAgent(deps.env), accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new GeocodeError('The place search could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new GeocodeError(`The place search answered HTTP ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GeocodeError('The place search returned a body that is not JSON.');
  }
  return parseNominatim(body);
}

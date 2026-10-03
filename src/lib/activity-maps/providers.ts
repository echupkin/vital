// ── Map tile providers ──────────────────────────────────
//
// Every provider a map can be drawn on, and the tile styles each offers. Almost
// nothing about them is interchangeable (subdomains, a retina suffix on one and
// not the others, zoom ceilings of 20, 19 and 17), so each is a descriptor
// rather than a URL swap. Above a provider's native ceiling Leaflet upscales its
// last real tile instead of requesting tiles the server does not have.
//
// A style with both a light and a dark rendering lets a map choose Light, Dark
// or Auto (follow the loaded theme); a light-only style is drawn as it is.
//
// A provider that needs a key names the environment variable it is read from,
// like every other integration key: the server reads it (tiles.ts) and the key
// travels only in the tile URLs the browser requests. Every provider can be
// chosen whether or not its key is set; one without its key is still requested
// without it (the provider may refuse), and the map says the key is missing.
//
// Pure and key-free: shared by the server, the Settings page and the maps.

export type MapProviderId = 'carto' | 'osm' | 'opentopomap';
export type MapAppearance = 'auto' | 'light' | 'dark';
export const MAP_APPEARANCES: readonly MapAppearance[] = ['auto', 'light', 'dark'];

export interface MapStyle {
  id: string;
  label: string;
  /** Tile URL templates; a style without `dark` has one rendering only. */
  url: { light: string; dark?: string };
}

export interface MapProviderKey {
  /** The server environment variable the key is read from. */
  envVar: string;
  /** Where a key is issued. */
  signupUrl: string;
  /** What a well-formed key looks like; anything else is reported as invalid. */
  pattern: RegExp;
  /** Query parameter the key is sent in. */
  param: string;
}

export interface MapProvider {
  id: MapProviderId;
  label: string;
  description: string;
  /** The provider's terms or tile usage policy. */
  policyUrl: string;
  /** Null when the tiles need no key. */
  key: MapProviderKey | null;
  styles: readonly MapStyle[];
  subdomains: string;
  maxNativeZoom: number;
  attribution: string;
}

/** What a map is drawn on: saved with the map. */
export interface BasemapChoice {
  provider: MapProviderId;
  style: string;
  appearance: MapAppearance;
}

const OSM_CREDIT =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const CARTO_TILES = 'https://{s}.basemaps.cartocdn.com';

export const MAP_PROVIDERS: readonly MapProvider[] = [
  {
    id: 'carto',
    label: 'CARTO',
    description: 'Clean, muted street maps that keep routes in front, with a dark rendering for dark themes.',
    policyUrl: 'https://carto.com/basemaps',
    key: {
      envVar: 'MAP_TILES_CARTO_KEY',
      signupUrl: 'https://carto.com/basemaps/apikey',
      pattern: /^[A-Za-z0-9._-]{8,200}$/,
      param: 'key',
    },
    styles: [
      {
        id: 'positron',
        label: 'Positron / Dark Matter',
        url: { light: `${CARTO_TILES}/light_all/{z}/{x}/{y}{r}.png`, dark: `${CARTO_TILES}/dark_all/{z}/{x}/{y}{r}.png` },
      },
      {
        id: 'positron-nolabels',
        label: 'Positron / Dark Matter, no labels',
        url: {
          light: `${CARTO_TILES}/light_nolabels/{z}/{x}/{y}{r}.png`,
          dark: `${CARTO_TILES}/dark_nolabels/{z}/{x}/{y}{r}.png`,
        },
      },
      {
        id: 'voyager',
        label: 'Voyager',
        url: { light: `${CARTO_TILES}/rastertiles/voyager/{z}/{x}/{y}{r}.png` },
      },
    ],
    subdomains: 'abcd',
    maxNativeZoom: 20,
    attribution: `${OSM_CREDIT} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>`,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: "OpenStreetMap's own standard map: detailed and colourful, light only.",
    policyUrl: 'https://operations.osmfoundation.org/policies/tiles/',
    key: null,
    styles: [{ id: 'standard', label: 'Standard', url: { light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' } }],
    subdomains: '',
    maxNativeZoom: 19,
    attribution: OSM_CREDIT,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    description: 'Topographic map with contour lines and hill shading, light only.',
    policyUrl: 'https://opentopomap.org/about',
    key: null,
    styles: [{ id: 'terrain', label: 'Terrain', url: { light: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' } }],
    subdomains: 'abc',
    maxNativeZoom: 17,
    attribution: `Map data: ${OSM_CREDIT}, SRTM | Map style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC-BY-SA</a>)`,
  },
];

export const DEFAULT_BASEMAP: BasemapChoice = { provider: 'carto', style: 'positron', appearance: 'auto' };
/** What a new map starts on when CARTO's key is not configured. */
export const KEYLESS_DEFAULT_BASEMAP: BasemapChoice = { provider: 'osm', style: 'standard', appearance: 'auto' };

export function isMapProviderId(value: unknown): value is MapProviderId {
  return typeof value === 'string' && MAP_PROVIDERS.some(p => p.id === value);
}

export function mapProvider(id: MapProviderId): MapProvider {
  return MAP_PROVIDERS.find(p => p.id === id) ?? MAP_PROVIDERS[0];
}

export function mapStyle(provider: MapProvider, styleId: string): MapStyle | undefined {
  return provider.styles.find(s => s.id === styleId);
}

/** True when the style has both a light and a dark rendering. */
export function hasDarkVariant(choice: BasemapChoice): boolean {
  const style = mapStyle(mapProvider(choice.provider), choice.style);
  return Boolean(style?.url.dark);
}

/** A provider's first style, at Auto: what choosing a provider starts on. */
export function providerDefault(id: MapProviderId): BasemapChoice {
  return { provider: id, style: mapProvider(id).styles[0].id, appearance: 'auto' };
}

/**
 * Basemap choices saved before providers existed: 'street' was CARTO whenever a
 * key was set, 'topo' was OpenTopoMap.
 */
const LEGACY_BASEMAPS: Record<string, BasemapChoice> = {
  street: DEFAULT_BASEMAP,
  topo: { provider: 'opentopomap', style: 'terrain', appearance: 'auto' },
};

/** A choice checked strictly: unknown fields, providers, styles or appearances are errors. */
export function validateBasemapChoice(value: unknown): { ok: true; value: BasemapChoice } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'settings.basemap must be an object { provider, style, appearance }.' };
  }
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter(k => !['provider', 'style', 'appearance'].includes(k));
  if (extra.length > 0) return { ok: false, error: `settings.basemap has unknown fields: ${extra.join(', ')}.` };
  if (!isMapProviderId(v.provider)) return { ok: false, error: 'settings.basemap.provider is not a known map provider.' };
  const provider = mapProvider(v.provider);
  const style = typeof v.style === 'string' ? mapStyle(provider, v.style) : undefined;
  if (!style) return { ok: false, error: `settings.basemap.style is not one of ${provider.label}'s styles.` };
  const appearance = v.appearance ?? 'auto';
  if (!MAP_APPEARANCES.includes(appearance as MapAppearance)) {
    return { ok: false, error: 'settings.basemap.appearance must be auto, light or dark.' };
  }
  // A light-only style has nothing to choose between.
  return { ok: true, value: { provider: provider.id, style: style.id, appearance: style.url.dark ? (appearance as MapAppearance) : 'auto' } };
}

/** A stored choice read tolerantly: a legacy id maps across, anything unknown reads as the default. */
export function readStoredBasemap(value: unknown): BasemapChoice {
  if (typeof value === 'string') return { ...(LEGACY_BASEMAPS[value] ?? DEFAULT_BASEMAP) };
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if (isMapProviderId(v.provider)) {
      const provider = mapProvider(v.provider);
      const style = (typeof v.style === 'string' && mapStyle(provider, v.style)) || provider.styles[0];
      const appearance = MAP_APPEARANCES.includes(v.appearance as MapAppearance) && style.url.dark ? (v.appearance as MapAppearance) : 'auto';
      return { provider: provider.id, style: style.id, appearance };
    }
  }
  return { ...DEFAULT_BASEMAP };
}

export function sameBasemap(a: BasemapChoice, b: BasemapChoice): boolean {
  return a.provider === b.provider && a.style === b.style && a.appearance === b.appearance;
}

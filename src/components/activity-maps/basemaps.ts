// ── Resolving a map's tiles ─────────────────────────────
//
// A map saves a provider, a style and an appearance (see
// lib/activity-maps/providers.ts); this turns that into the tile layer to draw
// and the tone the routes are coloured for. Auto follows the loaded theme on a
// style that has a dark rendering; a light-only style is always light. A
// provider whose key is not configured is still requested, without a key: it
// may serve tiles anyway, or refuse them ("API key required"), so the result
// flags the missing key for the map to say so.
//
// Tiles load straight from the provider into the browser, which tells the
// provider which area is on screen and, through the Referer, which site asked
// (see docs/privacy-and-security.md). Vital's pages send no Referer at all, so
// tile requests opt back in to the ORIGIN alone: OpenStreetMap's tile policy
// requires one, and a CARTO key can be restricted to a domain.
// Attribution is always shown: every provider requires it, and OpenTopoMap's
// CC-BY-SA licence also requires crediting the map style.

import {
  mapProvider,
  mapStyle,
  type BasemapChoice,
  type MapProvider,
} from '@/lib/activity-maps/providers';
import type { TileConfig } from '@/lib/activity-maps/tiles';
import type { Scheme } from './useColorScheme';

export const TILE_REFERRER_POLICY = 'strict-origin-when-cross-origin' as const;

export const MAX_ZOOM = 19;

export interface ResolvedTiles {
  url: string;
  subdomains: string;
  maxNativeZoom: number;
  attribution: string;
  /** The rendering drawn: picks the route colours and halos that read on it. */
  tone: Scheme;
  /** Set when the provider needs a key and none is configured: its tiles are requested without one. */
  missingKey: MapProvider | null;
}

/** True when the provider can draw: it needs no key, or its key is configured. */
export function providerReady(provider: MapProvider, keys: TileConfig['keys']): boolean {
  return provider.key === null || Boolean(keys[provider.id]);
}

export function resolveTiles(choice: BasemapChoice, keys: TileConfig['keys'], scheme: Scheme): ResolvedTiles {
  const provider = mapProvider(choice.provider);
  const style = mapStyle(provider, choice.style) ?? provider.styles[0];
  const tone: Scheme = style.url.dark ? (choice.appearance === 'auto' ? scheme : choice.appearance) : 'light';
  let url = tone === 'dark' && style.url.dark ? style.url.dark : style.url.light;
  const key = provider.key ? keys[provider.id] : undefined;
  if (provider.key && key) url += `${url.includes('?') ? '&' : '?'}${provider.key.param}=${encodeURIComponent(key)}`;
  return {
    url,
    subdomains: provider.subdomains,
    maxNativeZoom: provider.maxNativeZoom,
    attribution: provider.attribution,
    tone,
    missingKey: providerReady(provider, keys) ? null : provider,
  };
}

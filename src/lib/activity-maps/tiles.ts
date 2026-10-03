// ── Map tile keys ───────────────────────────────────────
//
// A tile provider that needs a key reads it from the server environment, like
// every other integration key (CARTO: MAP_TILES_CARTO_KEY, free for
// non-commercial use). A tile key is public by design (it travels in every tile
// URL the browser requests), so the maps page is sent it; it is still read at
// runtime rather than built into the bundle, so one image serves any deployment.
// The Settings page is sent only whether each key is configured, never the key.

import { MAP_PROVIDERS, type MapProviderId } from './providers';

/** What the maps page needs: the keys of the providers that have one configured. */
export interface TileConfig {
  keys: Partial<Record<MapProviderId, string>>;
}

/** One provider's configuration as Settings → Connections shows it. */
export interface MapProviderStatus {
  id: MapProviderId;
  needsKey: boolean;
  /** Ready to draw: needs no key, or its key is set and well formed. */
  configured: boolean;
  /** The variable the key is read from, for a provider that needs one. */
  envVar: string | null;
  /** The variable is set, but not to something that looks like a key. */
  invalid: boolean;
}

type Env = Record<string, string | undefined>;

function readKeys(env: Env) {
  return MAP_PROVIDERS.map(provider => {
    const raw = provider.key ? (env[provider.key.envVar] ?? '').trim() : '';
    const valid = provider.key ? provider.key.pattern.test(raw) : false;
    return { provider, raw, valid };
  });
}

export function readTileConfig(env: Env = process.env): TileConfig {
  const keys: TileConfig['keys'] = {};
  for (const { provider, raw, valid } of readKeys(env)) if (valid) keys[provider.id] = raw;
  return { keys };
}

export function readProviderStatus(env: Env = process.env): MapProviderStatus[] {
  return readKeys(env).map(({ provider, raw, valid }) => ({
    id: provider.id,
    needsKey: provider.key !== null,
    configured: provider.key === null || valid,
    envVar: provider.key?.envVar ?? null,
    invalid: provider.key !== null && raw.length > 0 && !valid,
  }));
}

import { describe, expect, it } from 'vitest';
import { readProviderStatus, readTileConfig } from './tiles';

const KEY = 'abc123DEF456';

describe('readTileConfig', () => {
  it('passes a well-formed key and drops a malformed one', () => {
    expect(readTileConfig({ MAP_TILES_CARTO_KEY: ` ${KEY} ` })).toEqual({ keys: { carto: KEY } });
    expect(readTileConfig({ MAP_TILES_CARTO_KEY: 'bad key!' })).toEqual({ keys: {} });
    expect(readTileConfig({})).toEqual({ keys: {} });
  });
});

describe('readProviderStatus', () => {
  const byId = (env: Record<string, string | undefined>) => Object.fromEntries(readProviderStatus(env).map(s => [s.id, s]));

  it('reports keyless providers as configured and never includes the key', () => {
    const status = byId({ MAP_TILES_CARTO_KEY: KEY });
    expect(status.osm).toMatchObject({ needsKey: false, configured: true, envVar: null });
    expect(status.carto).toMatchObject({ needsKey: true, configured: true, envVar: 'MAP_TILES_CARTO_KEY', invalid: false });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it('tells an unset key from a malformed one', () => {
    expect(byId({}).carto).toMatchObject({ configured: false, invalid: false });
    expect(byId({ MAP_TILES_CARTO_KEY: 'x' }).carto).toMatchObject({ configured: false, invalid: true });
  });
});

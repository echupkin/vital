import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASEMAP,
  MAP_PROVIDERS,
  hasDarkVariant,
  providerDefault,
  readStoredBasemap,
  validateBasemapChoice,
} from './providers';

describe('MAP_PROVIDERS', () => {
  it('gives every style a light rendering and https tile URLs', () => {
    for (const p of MAP_PROVIDERS) {
      expect(p.styles.length).toBeGreaterThan(0);
      for (const s of p.styles) {
        expect(s.url.light).toMatch(/^https:\/\/.*\{z\}\/\{x\}\/\{y\}/);
        if (s.url.dark) expect(s.url.dark).toMatch(/^https:\/\//);
      }
    }
  });

  it('names an environment variable for every provider that needs a key', () => {
    const carto = MAP_PROVIDERS.find(p => p.id === 'carto');
    expect(carto?.key?.envVar).toBe('MAP_TILES_CARTO_KEY');
    expect(MAP_PROVIDERS.filter(p => p.key === null).map(p => p.id)).toEqual(['osm', 'opentopomap']);
  });

  it('knows which styles have a dark rendering', () => {
    expect(hasDarkVariant(DEFAULT_BASEMAP)).toBe(true);
    expect(hasDarkVariant({ provider: 'carto', style: 'voyager', appearance: 'auto' })).toBe(false);
    expect(hasDarkVariant(providerDefault('osm'))).toBe(false);
  });
});

describe('validateBasemapChoice', () => {
  it('accepts a known provider, style and appearance', () => {
    expect(validateBasemapChoice({ provider: 'carto', style: 'positron-nolabels', appearance: 'dark' })).toEqual({
      ok: true,
      value: { provider: 'carto', style: 'positron-nolabels', appearance: 'dark' },
    });
  });

  it('stores a light-only style at auto: there is nothing to choose', () => {
    const r = validateBasemapChoice({ provider: 'carto', style: 'voyager', appearance: 'dark' });
    expect(r.ok && r.value.appearance).toBe('auto');
  });

  it('rejects a style from another provider', () => {
    expect(validateBasemapChoice({ provider: 'osm', style: 'positron', appearance: 'auto' }).ok).toBe(false);
  });
});

describe('readStoredBasemap', () => {
  it('maps the ids saved before providers existed', () => {
    expect(readStoredBasemap('street')).toEqual({ provider: 'carto', style: 'positron', appearance: 'auto' });
    expect(readStoredBasemap('topo')).toEqual({ provider: 'opentopomap', style: 'terrain', appearance: 'auto' });
  });

  it('reads an unknown provider as the default and an unknown style as the first', () => {
    expect(readStoredBasemap({ provider: 'mapbox' })).toEqual(DEFAULT_BASEMAP);
    expect(readStoredBasemap({ provider: 'carto', style: 'gone', appearance: 'dark' })).toEqual({
      provider: 'carto',
      style: 'positron',
      appearance: 'dark',
    });
    expect(readStoredBasemap(42)).toEqual(DEFAULT_BASEMAP);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveTiles } from './basemaps';

const KEYS = { carto: 'abc123DEF456' };

describe('resolveTiles', () => {
  it('appends the key and follows the theme under auto', () => {
    const light = resolveTiles({ provider: 'carto', style: 'positron', appearance: 'auto' }, KEYS, 'light');
    expect(light.url).toBe('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=abc123DEF456');
    expect(light.tone).toBe('light');
    expect(light.missingKey).toBeNull();
    const dark = resolveTiles({ provider: 'carto', style: 'positron', appearance: 'auto' }, KEYS, 'dark');
    expect(dark.url).toContain('/dark_all/');
    expect(dark.tone).toBe('dark');
  });

  it('holds an explicit appearance whatever the theme', () => {
    expect(resolveTiles({ provider: 'carto', style: 'positron', appearance: 'dark' }, KEYS, 'light').tone).toBe('dark');
    expect(resolveTiles({ provider: 'carto', style: 'positron', appearance: 'light' }, KEYS, 'dark').tone).toBe('light');
  });

  it('draws a light-only style light', () => {
    const r = resolveTiles({ provider: 'carto', style: 'voyager', appearance: 'dark' }, KEYS, 'dark');
    expect(r.tone).toBe('light');
    expect(r.url).toContain('/rastertiles/voyager/');
    expect(resolveTiles({ provider: 'opentopomap', style: 'terrain', appearance: 'auto' }, {}, 'dark').tone).toBe('light');
  });

  it('requests the provider without a key, and flags it, when the key is missing', () => {
    const r = resolveTiles({ provider: 'carto', style: 'positron', appearance: 'auto' }, {}, 'dark');
    expect(r.url).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
    expect(r.tone).toBe('dark');
    expect(r.missingKey?.id).toBe('carto');
  });

  it('keeps OpenStreetMap a choice of its own when a CARTO key is set', () => {
    const r = resolveTiles({ provider: 'osm', style: 'standard', appearance: 'auto' }, KEYS, 'light');
    expect(r.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(r.missingKey).toBeNull();
  });
});

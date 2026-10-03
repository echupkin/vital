import { describe, expect, it } from 'vitest';
import {
  bboxAround,
  bboxSizeMeters,
  parseLatLon,
  readStoredSettings,
  validateBBox,
  validateMapInput,
  validateMapSettings,
} from './types';

const BOX = bboxAround(37.77, -122.48, 4000);

describe('bboxAround / bboxSizeMeters', () => {
  it('round-trips a box size', () => {
    const { width, height } = bboxSizeMeters(BOX);
    expect(width).toBeCloseTo(4000, -1);
    expect(height).toBeCloseTo(4000, -1);
  });
});

describe('validateBBox', () => {
  it('accepts a sane box', () => {
    expect(validateBBox(BOX).ok).toBe(true);
  });

  it('rejects inverted, oversized, tiny, antimeridian-crossing and padded boxes', () => {
    expect(validateBBox({ ...BOX, south: BOX.north + 0.1 }).ok).toBe(false);
    expect(validateBBox(bboxAround(0, 0, 500_000)).ok).toBe(false);
    expect(validateBBox(bboxAround(0, 0, 50)).ok).toBe(false);
    expect(validateBBox({ south: 0, north: 1, west: 179.5, east: 180.5 }).ok).toBe(false);
    expect(validateBBox({ ...BOX, extra: 1 }).ok).toBe(false);
    expect(validateBBox({ ...BOX, south: '1' }).ok).toBe(false);
  });
});

describe('validateMapSettings', () => {
  it('fills defaults and de-duplicates types', () => {
    const r = validateMapSettings({ activityTypes: ['Walk', ' Walk '] });
    expect(r).toEqual({ ok: true, value: {
        activityTypes: ['Walk'],
        metric: 'frequency',
        basemap: { provider: 'carto', style: 'positron', appearance: 'auto' },
        range: 'all',
      },
    });
  });

  it('rejects unknown ids and fields on the way in', () => {
    expect(validateMapSettings({ metric: 'pace' }).ok).toBe(false);
    expect(validateMapSettings({ basemap: 'satellite' }).ok).toBe(false);
    expect(validateMapSettings({ basemap: { provider: 'mapbox', style: 'streets', appearance: 'auto' } }).ok).toBe(false);
    expect(validateMapSettings({ basemap: { provider: 'carto', style: 'terrain', appearance: 'auto' } }).ok).toBe(false);
    expect(validateMapSettings({ basemap: { provider: 'carto', style: 'positron', appearance: 'dim' } }).ok).toBe(false);
    expect(validateMapSettings({ basemap: { provider: 'osm', style: 'standard', appearance: 'auto', x: 1 } }).ok).toBe(false);
    expect(validateMapSettings({ range: 0 }).ok).toBe(false);
    expect(validateMapSettings({ range: 2.5 }).ok).toBe(false);
    expect(validateMapSettings({ colour: 'red' }).ok).toBe(false);
  });
});

describe('readStoredSettings', () => {
  it('reads an id this build no longer knows as the default, keeping the rest', () => {
    expect(readStoredSettings({ metric: 'pace', basemap: 'topo', range: 30, activityTypes: ['Walk'] })).toEqual({
      activityTypes: ['Walk'],
      metric: 'frequency',
      basemap: { provider: 'opentopomap', style: 'terrain', appearance: 'auto' },
      range: 30,
    });
    expect(readStoredSettings(null).metric).toBe('frequency');
    expect(readStoredSettings({ basemap: 'street' }).basemap).toEqual({ provider: 'carto', style: 'positron', appearance: 'auto' });
  });
});

describe('validateMapInput', () => {
  it('trims the name and defaults the settings', () => {
    const r = validateMapInput({ name: '  Home  ', bbox: BOX });
    expect(r.ok && r.value.name).toBe('Home');
    expect(r.ok && r.value.settings.metric).toBe('frequency');
  });

  it('rejects a missing name and an unknown field', () => {
    expect(validateMapInput({ name: ' ', bbox: BOX }).ok).toBe(false);
    expect(validateMapInput({ name: 'x', bbox: BOX, owner: 'me' }).ok).toBe(false);
  });
});

describe('parseLatLon', () => {
  it('reads comma, semicolon and space separated pairs', () => {
    expect(parseLatLon('37.7694, -122.4862')).toEqual({ lat: 37.7694, lon: -122.4862 });
    expect(parseLatLon('37.7694;-122.4862')).toEqual({ lat: 37.7694, lon: -122.4862 });
    expect(parseLatLon(' -33.9 151.2 ')).toEqual({ lat: -33.9, lon: 151.2 });
  });

  it('leaves addresses and out-of-range pairs for the geocoder or the error', () => {
    expect(parseLatLon('10 Downing Street')).toBeNull();
    expect(parseLatLon('95, 10')).toBeNull();
    expect(parseLatLon('10, 190')).toBeNull();
  });
});

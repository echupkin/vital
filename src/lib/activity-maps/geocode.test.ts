import { describe, expect, it } from 'vitest';
import { GeocodeError, geocode, geocoderUrl, parseNominatim } from './geocode';

describe('geocoderUrl', () => {
  it('defaults to Nominatim and can be turned off', () => {
    expect(geocoderUrl({} as NodeJS.ProcessEnv)).toContain('nominatim.openstreetmap.org');
    expect(geocoderUrl({ GEOCODER_URL: 'OFF' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(geocoderUrl({ GEOCODER_URL: 'http://geo.lan/search' } as unknown as NodeJS.ProcessEnv)).toBe('http://geo.lan/search');
  });
});

describe('parseNominatim', () => {
  it('reads coordinates and reorders the bounding box', () => {
    const out = parseNominatim([
      { lat: '37.77', lon: '-122.48', display_name: 'Somewhere, California', boundingbox: ['37.7', '37.8', '-122.5', '-122.4'] },
      { lat: 'x', lon: '1' },
    ]);
    expect(out).toEqual([
      { label: 'Somewhere, California', lat: 37.77, lon: -122.48, bbox: { south: 37.7, north: 37.8, west: -122.5, east: -122.4 } },
    ]);
  });

  it('refuses a body that is not a list', () => {
    expect(() => parseNominatim({ error: 'x' })).toThrow(GeocodeError);
  });
});

describe('geocode', () => {
  it('sends the query with an identifying agent and never searches when off', async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), ua: new Headers(init.headers).get('user-agent') });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;
    await geocode('Main St', { env: { GEOCODER_USER_AGENT: 'Vital test (me@example.org)' } as unknown as NodeJS.ProcessEnv, fetchImpl });
    expect(seen[0].url).toContain('q=Main+St');
    expect(seen[0].url).toContain('format=jsonv2');
    expect(seen[0].ua).toBe('Vital test (me@example.org)');

    await expect(geocode('x', { env: { GEOCODER_URL: 'off' } as unknown as NodeJS.ProcessEnv, fetchImpl })).rejects.toThrow(/turned off/);
    expect(seen).toHaveLength(1);
  });
});

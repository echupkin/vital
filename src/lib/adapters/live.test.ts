import { afterEach, describe, expect, it, vi } from 'vitest';
import samples from '@/data/hae-samples.json';
import {
  LiveHealthDataAdapter,
  LIVE_LOOKBACK_DAYS,
  fetchLiveDatasetUncached,
  loadLiveDataset,
  upstreamWindow,
  warmLiveDataset,
} from '@/lib/adapters/live';
import { HaeError, fetchMetricRecords, probeHae, readHaeConfig } from '@/lib/adapters/hae';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { resetToDemoDataset } from '@/lib/adapters/dataset';

const TOKEN = 'test-read-token-do-not-log';
const ENV = {
  HAE_API_URL: 'http://hae.test:3001',
  HAE_API_KEY: TOKEN,
  HAE_CACHE_TTL_SECONDS: '300',
  HAE_PROBE_METRIC: 'resting_heart_rate',
  VITAL_DATA_MODE: 'live',
} as unknown as NodeJS.ProcessEnv;

const NOW = new Date('2026-09-17T18:00:00.000Z');
const METRICS = samples.metrics as unknown as Record<string, unknown[]>;

/** Counts requests and serves the recorded samples, window-aware. */
function recordingFetch() {
  const calls: { url: string; apiKey: string | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, apiKey: headers['api-key'] });
    const body = payloadFor(url);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function payloadFor(url: string): unknown {
  if (url.includes('/api/workouts')) return samples.workouts;
  const match = /\/api\/metrics\/([^?]+)/.exec(url);
  const metric = match ? decodeURIComponent(match[1]) : '';
  return METRICS[metric] ?? [];
}

const DEPS = { env: ENV, fetchImpl: recordingFetch().impl, now: () => NOW, bypassCache: true };

/**
 * Serves the recorded samples, but can hold every response open behind a gate so
 * a test can observe a request that is *still* upstream.
 */
function gatedFetch() {
  const calls: string[] = [];
  let gated = false;
  let release!: () => void;
  let gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (gated) await gate;
    return { ok: true, status: 200, json: async () => payloadFor(url) } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    impl,
    calls,
    /** Hold every subsequent response open. */
    close() {
      gated = true;
      gate = new Promise<void>(resolve => {
        release = resolve;
      });
    },
    /** Let the held responses through. */
    open() {
      release();
    },
  };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  resetToDemoDataset();
  liveCache.clear();
  setCacheTtlForTests(null);
});

describe('HAE client (server-side only, SPEC §10 §11)', () => {
  it('reports not-configured without making a request', async () => {
    const { impl, calls } = recordingFetch();
    await expect(
      fetchMetricRecords('resting_heart_rate', {}, { env: {} as NodeJS.ProcessEnv, fetchImpl: impl })
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
    expect(readHaeConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('sends the read token in the api-key header and never in the URL', async () => {
    const { impl, calls } = recordingFetch();
    await fetchMetricRecords('resting_heart_rate', { from: '2026-09-01T00:00:00.000Z' }, { env: ENV, fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe(TOKEN);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).toContain('from=2026-09-01');
  });

  it('rejects a non-array payload instead of treating it as "no data"', async () => {
    const impl = (async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) })) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { env: ENV, fetchImpl: impl })).rejects.toBeInstanceOf(HaeError);
    await expect(fetchMetricRecords('vo2max', {}, { env: ENV, fetchImpl: impl })).rejects.toMatchObject({
      kind: 'invalid_payload',
    });
  });

  it('surfaces an HTTP error and a timeout as failures', async () => {
    const httpFail = (async () => ({ ok: false, status: 503, json: async () => [] })) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { env: ENV, fetchImpl: httpFail })).rejects.toMatchObject({
      kind: 'http_error',
      httpStatus: 503,
    });

    const abort = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { env: ENV, fetchImpl: abort })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('probes with a real request and counts the records it got back', async () => {
    const { impl } = recordingFetch();
    const probe = await probeHae({ env: ENV, fetchImpl: impl });
    expect(probe.outcome).toBe('ok');
    expect(probe.records).toBe(METRICS.resting_heart_rate.length);
    expect(probe.detail).toContain('/api/metrics/resting_heart_rate');
    expect(JSON.stringify(probe)).not.toContain(TOKEN);
  });
});

describe('live dataset assembly', () => {
  it('normalizes recorded API samples into the internal dataset shape', async () => {
    const result = await fetchLiveDatasetUncached(DEPS);
    expect(result.mode).toBe('live');
    expect(result.stats.recordsRead).toBeGreaterThan(100);
    expect(result.dataset.metrics['resting_heart_rate']).toBeDefined();
    expect(result.dataset.metrics['distance_walking_running']).toBeDefined();
    expect(result.dataset.coverage['resting_heart_rate'].observedDays).toBeGreaterThan(0);
    // The newest observation drives the freshness label.
    expect(Date.parse(result.asOf!)).toBeGreaterThan(Date.parse('2026-09-01T00:00:00.000Z'));
  });

  it('bounds every request by the lookback window', async () => {
    const { impl, calls } = recordingFetch();
    const window = upstreamWindow('2026-09-17', LIVE_LOOKBACK_DAYS);
    await fetchLiveDatasetUncached({ env: ENV, fetchImpl: impl, now: () => NOW });
    expect(calls.length).toBeGreaterThan(10);
    for (const call of calls) {
      expect(call.url).toContain(encodeURIComponent(window.from).slice(0, 10));
    }
    expect(calls.some(c => c.url.includes('/api/workouts?startDate='))).toBe(true);
  });

  it('never leaks the token into the dataset handed to the browser', async () => {
    const result = await fetchLiveDatasetUncached(DEPS);
    const serialized = JSON.stringify(result.dataset) + JSON.stringify(result.provenance) + JSON.stringify(result.sources);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('api-key');
  });

  it('throws rather than falling back to demo data when the source fails', async () => {
    const failing = (async () => ({ ok: false, status: 500, json: async () => [] })) as unknown as typeof fetch;
    await expect(
      fetchLiveDatasetUncached({ env: ENV, fetchImpl: failing, now: () => NOW, bypassCache: true })
    ).rejects.toBeInstanceOf(HaeError);
  });
});

describe('cache and single flight', () => {
  it('serves a second load from the in-process cache', async () => {
    setCacheTtlForTests(60_000);
    liveCache.clear();
    const { impl, calls } = recordingFetch();
    const deps = { env: ENV, fetchImpl: impl, now: () => NOW };
    await loadLiveDataset(deps);
    const afterFirst = calls.length;
    await loadLiveDataset(deps);
    expect(calls.length).toBe(afterFirst);
  });

  it('collapses concurrent page loads into one upstream pass', async () => {
    liveCache.clear();
    const { impl, calls } = recordingFetch();
    const deps = { env: ENV, fetchImpl: impl, now: () => NOW };
    const [a, b, c] = await Promise.all([loadLiveDataset(deps), loadLiveDataset(deps), loadLiveDataset(deps)]);
    const onePass = calls.length;
    expect(a.dataset).toEqual(b.dataset);
    expect(b.dataset).toEqual(c.dataset);
    // A second concurrent batch re-uses the cached entry: still one pass total.
    await Promise.all([loadLiveDataset(deps), loadLiveDataset(deps)]);
    expect(calls.length).toBe(onePass);
  });

  it('reports cache statistics for the pipeline panel', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    await loadLiveDataset({ ...DEPS, bypassCache: false });
    const stats = liveCache.stats();
    expect(stats.ttlMs).toBe(60_000);
    expect(stats.keys.some(k => k.startsWith('live-dataset:'))).toBe(true);
  });
});

describe('stale-while-revalidate (live dataset)', () => {
  it('serves the held dataset the moment the TTL lapses, refreshing upstream in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-09-17T18:00:00.000Z');
    vi.setSystemTime(t0);
    setCacheTtlForTests(300_000);
    liveCache.clear();

    const upstream = gatedFetch();
    const deps = { env: ENV, fetchImpl: upstream.impl, now: () => NOW };
    const priming = await loadLiveDataset(deps);
    const passesAfterPriming = upstream.calls.length;
    expect(passesAfterPriming).toBeGreaterThan(10);

    // The TTL lapses with no traffic in between, and every response is now held
    // open: the refresh cannot possibly have finished when the next read returns.
    vi.setSystemTime(new Date(t0.getTime() + 300_000 + 1_000));
    upstream.close();

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ env: ENV, fetchImpl: solo, now: () => NOW });
    const requestsPerPass = soloCalls.length;

    const before = liveCache.stats();
    const served = await loadLiveDataset(deps);
    expect(served).toBe(priming); // the exact cached object, served stale
    const startedByRefresh = upstream.calls.length - passesAfterPriming;
    expect(startedByRefresh).toBeGreaterThan(0); // the refresh really did start upstream
    expect(startedByRefresh).toBeLessThan(requestsPerPass); // and is still outstanding
    const during = liveCache.stats();
    expect(during.inFlight).toBe(1); // not awaited
    expect(during.revalidations - before.revalidations).toBe(1);

    upstream.open();
    await liveCache.awaitIdle();
    expect(liveCache.stats().inFlight).toBe(0);
    // Exactly one refresh pass ran in total, no more.
    expect(upstream.calls.length - passesAfterPriming).toBe(requestsPerPass);
    expect(liveCache.stats().staleHits - before.staleHits).toBe(1);
  });

  it('collapses concurrent TTL-lapsed requests into one background refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-09-17T18:00:00.000Z');
    vi.setSystemTime(t0);
    setCacheTtlForTests(300_000);
    liveCache.clear();

    const upstream = gatedFetch();
    const deps = { env: ENV, fetchImpl: upstream.impl, now: () => NOW };
    const priming = await loadLiveDataset(deps);
    const passesAfterPriming = upstream.calls.length;

    vi.setSystemTime(new Date(t0.getTime() + 300_000 + 1_000));
    upstream.close();

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ env: ENV, fetchImpl: solo, now: () => NOW });
    const requestsPerPass = soloCalls.length;

    const before = liveCache.stats();
    const served = await Promise.all([loadLiveDataset(deps), loadLiveDataset(deps), loadLiveDataset(deps)]);
    for (const result of served) expect(result).toBe(priming);
    const during = liveCache.stats();
    expect(during.inFlight).toBe(1);
    expect(during.revalidations - before.revalidations).toBe(1);

    upstream.open();
    await liveCache.awaitIdle();
    // Three stale readers, one upstream refresh pass.
    expect(upstream.calls.length - passesAfterPriming).toBe(requestsPerPass);
    expect(liveCache.stats().staleHits - before.staleHits).toBe(3);
    expect(liveCache.stats().revalidations - before.revalidations).toBe(1);
  });

  it('still blocks a genuinely cold process on exactly one upstream pass', async () => {
    liveCache.clear();
    setCacheTtlForTests(300_000);
    const upstream = gatedFetch();
    upstream.close();
    const deps = { env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ env: ENV, fetchImpl: solo, now: () => NOW });
    const requestsPerPass = soloCalls.length;

    let settled = false;
    const before = liveCache.stats();
    const all = [loadLiveDataset(deps), loadLiveDataset(deps)].map(p =>
      p.then(value => {
        settled = true;
        return value;
      })
    );
    await tick();
    expect(settled).toBe(false); // cold: the callers wait for upstream

    upstream.open();
    const [a, b] = await Promise.all(all);
    expect(a).toBe(b);
    // Both cold callers shared one pass — not two.
    expect(upstream.calls.length).toBe(requestsPerPass);
    expect(liveCache.stats().misses - before.misses).toBe(1);
  });
});

describe('boot warm-up', () => {
  it('does nothing in demo mode or when the API is not configured', () => {
    liveCache.clear();
    expect(warmLiveDataset({ env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(
      warmLiveDataset({
        env: { VITAL_DATA_MODE: 'demo', HAE_API_URL: 'http://hae.test:3001', HAE_API_KEY: TOKEN } as unknown as NodeJS.ProcessEnv,
      })
    ).toBeNull();
    expect(warmLiveDataset({ env: { VITAL_DATA_MODE: 'live' } as unknown as NodeJS.ProcessEnv })).toBeNull();
    expect(
      warmLiveDataset({
        env: { VITAL_DATA_MODE: 'live', HAE_API_URL: 'http://hae.test:3001' } as unknown as NodeJS.ProcessEnv,
      })
    ).toBeNull();
    expect(liveCache.stats().inFlight).toBe(0);
  });

  it('fills the cache without blocking, so the first page load after boot is a cache hit', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    const upstream = gatedFetch();
    const deps = { env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const warm = warmLiveDataset(deps);
    expect(warm).not.toBeNull();
    // Returned before the fill finished: the pass is under way in the background.
    expect(liveCache.stats().inFlight).toBe(1);

    upstream.open();
    await expect(warm!).resolves.toEqual({ ok: true });

    const passesAfterWarmUp = upstream.calls.length;
    const firstPaint = await loadLiveDataset(deps);
    expect(upstream.calls.length).toBe(passesAfterWarmUp); // no second upstream pass
    expect(firstPaint.stats.recordsRead).toBeGreaterThan(100);
  });

  it('joins a page load that got there first instead of opening a second pass', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    const upstream = gatedFetch();
    const deps = { env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ env: ENV, fetchImpl: solo, now: () => NOW });
    const requestsPerPass = soloCalls.length;

    const before = liveCache.stats();
    const page = loadLiveDataset(deps); // the visitor wins the race
    const warm = warmLiveDataset(deps); // the warm-up joins it
    upstream.open();
    const [served, outcome] = await Promise.all([page, warm!]);
    expect(outcome).toEqual({ ok: true });
    expect(served.stats.recordsRead).toBeGreaterThan(100);
    expect(upstream.calls.length).toBe(requestsPerPass);
    expect(liveCache.stats().misses - before.misses).toBe(1);
  });

  it('reports a failed warm-up as an outcome instead of throwing or caching anything', async () => {
    liveCache.clear();
    const failing = (async () => ({ ok: false, status: 500, json: async () => [] })) as unknown as typeof fetch;
    const warm = warmLiveDataset({ env: ENV, fetchImpl: failing, now: () => NOW });
    expect(warm).not.toBeNull();

    const outcome = await warm!;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('500');
      expect(outcome.reason).not.toContain(TOKEN);
    }
    // Nothing was cached: the next request retries and reports the real failure.
    expect(liveCache.stats().keys.filter(k => k.startsWith('live-dataset:'))).toHaveLength(0);
  });
});

describe('LiveHealthDataAdapter', () => {
  it('implements the HealthDataAdapter surface over the live source', async () => {
    setCacheTtlForTests(60_000);
    liveCache.clear();
    const adapter = new LiveHealthDataAdapter(DEPS);
    expect(adapter.isLive).toBe(true);

    const rhr = await adapter.getMetricData({ metricId: 'resting_heart_rate' });
    expect(rhr.length).toBeGreaterThan(0);

    const windowed = await adapter.getMetricData({
      metricId: 'resting_heart_rate',
      from: '2026-09-16',
      to: '2026-09-16',
    });
    expect(windowed.every(r => String(r.date) <= '2026-09-16')).toBe(true);
    expect(windowed.length).toBeLessThanOrEqual(rhr.length);

    const sleep = await adapter.getSleepData();
    expect(sleep.length).toBeGreaterThan(0);
    expect(sleep[0].asleepMinutes).toBeGreaterThan(0);

    const bp = await adapter.getBloodPressureData();
    expect(bp.every(r => r.units === 'mmHg')).toBe(true);

    const workouts = await adapter.getWorkouts();
    expect(workouts.length).toBe(samples.workouts.length);

    const coverage = await adapter.getCoverage('resting_heart_rate');
    expect(coverage?.sourceNames.length).toBeGreaterThan(0);

    const available = await adapter.getAvailableMetrics();
    expect(available).toContain('sleep_analysis');
    expect(available).not.toContain('vo2max');
  });
});

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import samples from '@/data/hae-samples.json';
import {
  LiveHealthDataAdapter,
  LIVE_LOOKBACK_DAYS,
  LiveSourcesFailedError,
  NoLiveSourceError,
  fetchLiveDatasetUncached,
  liveCacheKey,
  loadLiveDataset,
  ouraCacheKey,
  upstreamWindow,
  warmLiveDataset,
} from '@/lib/adapters/live';
import { HaeError, fetchMetricRecords, probeHae, buildHaeConfig, resolveHaeConfig } from '@/lib/adapters/hae';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { resetToDemoDataset, setActiveDataset } from '@/lib/adapters/dataset';
import { workoutDayKey } from '@/lib/analytics/workouts';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { PoolLike } from '@/lib/db/pool';
import type { SourceContext } from '@/lib/sources/registry';

const TOKEN = 'test-read-token-do-not-log';
const ENV = {
  HAE_CACHE_TTL_SECONDS: '300',
  HAE_PROBE_METRIC: 'resting_heart_rate',
  VITAL_DATA_MODE: 'live',
} as unknown as NodeJS.ProcessEnv;

// The connection is stored in Postgres, never read from the environment: tests inject it.
const HAE_CONFIG = buildHaeConfig('http://hae.test:3001', TOKEN, ENV);
const HAE_SOURCES: SourceContext = {
  env: ENV,
  hasCredential: async id => id === 'hae',
  labReportCount: async () => 0,
};
const HAE_DEPS = { haeConfig: HAE_CONFIG, sources: HAE_SOURCES };

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

const DEPS = { ...HAE_DEPS, env: ENV, fetchImpl: recordingFetch().impl, now: () => NOW, bypassCache: true };

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
      fetchMetricRecords('resting_heart_rate', {}, { env: {} as NodeJS.ProcessEnv, fetchImpl: impl, haeClient: null })
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
    expect(await resolveHaeConfig({ env: {} as NodeJS.ProcessEnv, haeClient: null })).toBeNull();
  });

  it('sends the read token in the api-key header and never in the URL', async () => {
    const { impl, calls } = recordingFetch();
    await fetchMetricRecords('resting_heart_rate', { from: '2026-09-01T00:00:00.000Z' }, { ...HAE_DEPS, env: ENV, fetchImpl: impl });
    expect(calls).toHaveLength(1);
    expect(calls[0].apiKey).toBe(TOKEN);
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).toContain('from=2026-09-01');
  });

  it('rejects a non-array payload instead of treating it as "no data"', async () => {
    const impl = (async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) })) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { ...HAE_DEPS, env: ENV, fetchImpl: impl })).rejects.toBeInstanceOf(HaeError);
    await expect(fetchMetricRecords('vo2max', {}, { ...HAE_DEPS, env: ENV, fetchImpl: impl })).rejects.toMatchObject({
      kind: 'invalid_payload',
    });
  });

  it('surfaces an HTTP error and a timeout as failures', async () => {
    const httpFail = (async () => ({ ok: false, status: 503, json: async () => [] })) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { ...HAE_DEPS, env: ENV, fetchImpl: httpFail })).rejects.toMatchObject({
      kind: 'http_error',
      httpStatus: 503,
    });

    const abort = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    await expect(fetchMetricRecords('vo2max', {}, { ...HAE_DEPS, env: ENV, fetchImpl: abort })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('probes with a real request and counts the records it got back', async () => {
    const { impl } = recordingFetch();
    const probe = await probeHae({ ...HAE_DEPS, env: ENV, fetchImpl: impl });
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
    await fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: impl, now: () => NOW });
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
      fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: failing, now: () => NOW, bypassCache: true })
    ).rejects.toBeInstanceOf(HaeError);
  });
});

describe('live dataset timezone', () => {
  // 02:00 UTC on Sep 18 is still the evening of Sep 17 in New York.
  const EVENING = new Date('2026-09-18T02:00:00.000Z');

  it("cuts the days in the caller's timezone, not UTC", async () => {
    const utc = await fetchLiveDatasetUncached({ ...DEPS, now: () => EVENING });
    const local = await fetchLiveDatasetUncached({ ...DEPS, now: () => EVENING, timezone: 'America/New_York' });
    expect(utc.timezone).toBe('UTC');
    expect(utc.referenceKey).toBe('2026-09-18');
    expect(local.timezone).toBe('America/New_York');
    expect(local.dataset.timezone).toBe('America/New_York');
    expect(local.referenceKey).toBe('2026-09-17');
  });

  it('puts an evening workout on its local day', async () => {
    const local = await fetchLiveDatasetUncached({ ...DEPS, timezone: 'America/New_York' });
    const evening = local.dataset.workouts.find(w => w.start_time === '2026-09-16T01:05:26.000Z');
    expect(evening).toBeDefined();
    setActiveDataset(local.dataset, { mode: 'live' });
    try {
      // 21:05 EDT on Sep 15 — the next day in UTC.
      expect(workoutDayKey(evening!)).toBe('2026-09-15');
    } finally {
      resetToDemoDataset();
    }
  });

  it('rebuilds on a timezone change and holds only the current zone', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    const { impl, calls } = recordingFetch();
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: impl, now: () => NOW };
    await loadLiveDataset({ ...deps, timezone: 'America/Chicago' });
    const onePass = calls.length;
    const moved = await loadLiveDataset({ ...deps, timezone: 'America/New_York' });
    expect(moved.timezone).toBe('America/New_York');
    expect(calls.length).toBe(onePass * 2);
    expect(liveCache.stats().keys).toEqual([liveCacheKey('America/New_York', 'hae')]);
  });
});

describe('cache and single flight', () => {
  it('serves a second load from the in-process cache', async () => {
    setCacheTtlForTests(60_000);
    liveCache.clear();
    const { impl, calls } = recordingFetch();
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: impl, now: () => NOW };
    await loadLiveDataset(deps);
    const afterFirst = calls.length;
    await loadLiveDataset(deps);
    expect(calls.length).toBe(afterFirst);
  });

  it('reads upstream again on a refresh ("Check again"), even inside the TTL, and caches the result', async () => {
    setCacheTtlForTests(60_000);
    liveCache.clear();
    const { impl, calls } = recordingFetch();
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: impl, now: () => NOW };
    await loadLiveDataset(deps);
    const onePass = calls.length;
    await loadLiveDataset({ ...deps, refresh: true });
    expect(calls.length).toBe(onePass * 2);
    await loadLiveDataset(deps);
    expect(calls.length).toBe(onePass * 2);
  });

  it('collapses concurrent page loads into one upstream pass', async () => {
    liveCache.clear();
    const { impl, calls } = recordingFetch();
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: impl, now: () => NOW };
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
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: upstream.impl, now: () => NOW };
    const priming = await loadLiveDataset(deps);
    const passesAfterPriming = upstream.calls.length;
    expect(passesAfterPriming).toBeGreaterThan(10);

    // The TTL lapses with no traffic in between, and every response is now held
    // open: the refresh cannot possibly have finished when the next read returns.
    vi.setSystemTime(new Date(t0.getTime() + 300_000 + 1_000));
    upstream.close();

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: solo, now: () => NOW });
    const requestsPerPass = soloCalls.length;

    const before = liveCache.stats();
    const served = await loadLiveDataset(deps);
    expect(served).toBe(priming); // the exact cached object, served stale
    // The refresh really did start upstream (after the source set is resolved)...
    await vi.waitFor(() => expect(upstream.calls.length - passesAfterPriming).toBeGreaterThan(0));
    const startedByRefresh = upstream.calls.length - passesAfterPriming;
    expect(startedByRefresh).toBeLessThan(requestsPerPass); // ...and is still outstanding
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
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: upstream.impl, now: () => NOW };
    const priming = await loadLiveDataset(deps);
    const passesAfterPriming = upstream.calls.length;

    vi.setSystemTime(new Date(t0.getTime() + 300_000 + 1_000));
    upstream.close();

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: solo, now: () => NOW });
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
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: solo, now: () => NOW });
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
  it('does nothing in demo mode, and reports when no live source is connected', async () => {
    liveCache.clear();
    expect(warmLiveDataset({ env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(
      warmLiveDataset({
        env: { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv,
        haeConfig: HAE_CONFIG,
      })
    ).toBeNull();
    // Live mode with nothing stored: an outcome, not a fill. The environment alone connects nothing.
    const outcome = await warmLiveDataset({
      env: { VITAL_DATA_MODE: 'live', HAE_API_URL: 'http://hae.test:3001', HAE_API_KEY: TOKEN } as unknown as NodeJS.ProcessEnv,
      haeClient: null,
    });
    expect(outcome).toEqual({ ok: false, reason: 'No live source is connected yet.' });
    expect(liveCache.stats().inFlight).toBe(0);
  });

  it('fills the cache without blocking, so the first page load after boot is a cache hit', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    const upstream = gatedFetch();
    upstream.close(); // hold the pass open so it can be seen under way
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const warm = warmLiveDataset(deps);
    expect(warm).not.toBeNull();
    // Returned before the fill finished: the pass is under way in the background.
    await vi.waitFor(() => expect(liveCache.stats().inFlight).toBe(1));

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
    const deps = { ...HAE_DEPS, env: ENV, fetchImpl: upstream.impl, now: () => NOW };

    const { impl: solo, calls: soloCalls } = recordingFetch();
    await fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl: solo, now: () => NOW });
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
    const warm = warmLiveDataset({ ...HAE_DEPS, env: ENV, fetchImpl: failing, now: () => NOW });
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

describe('HAE-only output is unchanged by the multi-source wiring', () => {
  it('serialises to the exact bytes the single-source version produced', async () => {
    // The data-quality job is a background task on the side, not part of the data.
    const { quality, ...result } = await fetchLiveDatasetUncached(DEPS);
    expect(quality?.state).toBeDefined();
    const text = JSON.stringify(result);
    expect({ bytes: text.length, sha256: createHash('sha256').update(text).digest('hex') }).toEqual({
      bytes: 20405,
      sha256: 'b773953a2b657c2a71111e5090a12acd0d7cb2fc0063e97e97c4c52c7509e739',
    });
  });
});

// ── Two sources: HAE and Oura (all synthetic) ───────────

const OURA_ACCESS = 'sample-oura-access-token';
const OURA_REFRESH = 'sample-oura-refresh-token';
const OURA_SECRET = 'sample-oura-client-secret';
const OURA_APP = {
  state: 'ok' as const,
  clientId: 'sample-client',
  clientSecret: OURA_SECRET,
  redirectUri: 'http://localhost:8080/api/sources/oura/callback',
  loginClientId: null,
};
const SECRET_KEY = Buffer.alloc(32, 7);
const OURA_ONLY_ENV = {
  VITAL_DATA_MODE: 'live',
  OURA_API_URL: 'http://oura.test',
  VITAL_SECRET_KEY: SECRET_KEY.toString('base64'),
} as unknown as NodeJS.ProcessEnv;
const BOTH_ENV = { ...ENV, ...OURA_ONLY_ENV } as NodeJS.ProcessEnv;

/** A Postgres stand-in that answers only the credential read, from an encrypted row. */
function credentialPool(scopes = 'daily heartrate workout spo2 heart_health'): PoolLike {
  const parts = encryptJson({ access_token: OURA_ACCESS, refresh_token: OURA_REFRESH }, SECRET_KEY);
  const row = {
    source_id: 'oura',
    ciphertext: parts.ciphertext,
    iv: parts.iv,
    auth_tag: parts.authTag,
    key_id: keyId(SECRET_KEY),
    scopes,
    access_expires_at: '2099-01-01T00:00:00.000Z',
    connected_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    revision: 1,
  };
  return { query: async () => ({ rows: [row] }) };
}

const HAE_ENVS = new Set<NodeJS.ProcessEnv>([ENV, BOTH_ENV]);

function sourcesCtx(env: NodeJS.ProcessEnv, connected: boolean): SourceContext {
  const hae = HAE_ENVS.has(env);
  return {
    env,
    hasCredential: async id => (connected && (id === 'oura' || id === 'oura-app')) || (hae && id === 'hae'),
    labReportCount: async () => 0,
  };
}

const OURA_DOCS: Record<string, unknown[]> = {
  sleep: [
    {
      id: 's1',
      day: '2026-09-17',
      type: 'long_sleep',
      bedtime_start: '2026-09-16T23:00:00+00:00',
      bedtime_end: '2026-09-17T06:30:00+00:00',
      time_in_bed: 27000,
      total_sleep_duration: 24000,
      deep_sleep_duration: 5000,
      light_sleep_duration: 14000,
      rem_sleep_duration: 5000,
      awake_time: 3000,
      average_breath: 14.5,
      average_hrv: 48,
      lowest_heart_rate: 51,
    },
  ],
  daily_activity: [{ day: '2026-09-16', steps: 8123, active_calories: 430 }],
  daily_readiness: [{ day: '2026-09-16', temperature_deviation: -0.2 }],
  workout: [
    {
      id: 'w1',
      activity: 'walking',
      start_datetime: '2026-09-16T17:45:00+00:00',
      end_datetime: '2026-09-16T18:20:00+00:00',
      calories: 90,
    },
  ],
};

/** Serves HAE's samples and a few synthetic Oura documents; can fail either side. */
function twoSourceFetch(opts: { hae?: 'ok' | 'fail'; oura?: 'ok' | 'fail'; ouraRefuses?: string } = {}) {
  const haeCalls: string[] = [];
  const ouraCalls: { url: string; auth: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://oura.test')) {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      ouraCalls.push({ url, auth });
      if (opts.oura === 'fail') return new Response('{}', { status: 500 });
      const name = /usercollection\/([^?]+)/.exec(url)?.[1] ?? '';
      if (name === opts.ouraRefuses) {
        return new Response(JSON.stringify({ detail: 'Token is not authorized access heart_health scope.' }), { status: 401 });
      }
      return new Response(JSON.stringify({ data: OURA_DOCS[name] ?? [], next_token: null }), { status: 200 });
    }
    haeCalls.push(url);
    if (opts.hae === 'fail') return { ok: false, status: 500, json: async () => [] } as unknown as Response;
    return { ok: true, status: 200, json: async () => payloadFor(url) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, haeCalls, ouraCalls };
}

function twoSourceDeps(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, connected = true) {
  return {
    env,
    fetchImpl,
    now: () => NOW,
    bypassCache: true,
    sources: sourcesCtx(env, connected),
    haeConfig: HAE_CONFIG,
    ouraClient: credentialPool(), ouraApp: OURA_APP,
  };
}

describe('live dataset from HAE and Oura', () => {
  it('works with Oura alone and makes no HAE request', async () => {
    const upstream = twoSourceFetch();
    const result = await fetchLiveDatasetUncached(twoSourceDeps(OURA_ONLY_ENV, upstream.impl));
    expect(upstream.haeCalls).toHaveLength(0);
    expect(upstream.ouraCalls.length).toBeGreaterThan(0);
    expect(result.sources).toEqual(['Oura Ring']);
    expect(result.dataset.metrics['hrv_rmssd_sleep']).toHaveLength(1);
    expect(result.dataset.metrics['sleep_analysis']).toHaveLength(1);
    expect(result.dataset.metrics['resting_heart_rate']).toBeUndefined();
    expect(result.dataset.workouts).toHaveLength(1);
    expect(result.dataset.timezone).toBe('UTC');
    expect(result.sourceErrors).toBeUndefined();
  });

  it('merges both sources under the stated rule and quotes it', async () => {
    const upstream = twoSourceFetch();
    const haeOnly = await fetchLiveDatasetUncached(twoSourceDeps(ENV, upstream.impl, false));
    const result = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl));
    expect(result.mergeRule).toContain('never added or averaged');
    // The ring is preferred for sleep by default, so its night wins that day.
    const night = (result.dataset.metrics['sleep_analysis'] as { date: string; source: string }[]).find(
      n => n.date === '2026-09-17'
    );
    expect(night?.source).toBe('Oura Ring');
    // A ring-only measure appears next to the watch's own.
    expect(result.dataset.metrics['hrv_rmssd_sleep']).toBeDefined();
    expect(result.dataset.metrics['heart_rate_variability']).toEqual(haeOnly.dataset.metrics['heart_rate_variability']);
    expect(result.sources).toContain('Oura Ring');
    for (const c of Object.values(result.dataset.coverage)) expect(c.expectedDays).toBe(result.dataset.days);
    expect(result.sourceErrors).toBeUndefined();
  });

  it('counts an HAE workout and an overlapping Oura workout as one', async () => {
    const upstream = twoSourceFetch();
    const haeOnly = await fetchLiveDatasetUncached(twoSourceDeps(ENV, upstream.impl, false));
    const result = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl));
    const overlapping = result.dataset.workouts.filter(
      w => w.start_time < '2026-09-16T18:22:17.000Z' && w.end_time > '2026-09-16T17:43:07.000Z'
    );
    expect(overlapping).toHaveLength(1);
    expect(result.dataset.workouts).toHaveLength(haeOnly.dataset.workouts.length);
  });

  it('serves HAE data plus a source error when Oura fails', async () => {
    const upstream = twoSourceFetch({ oura: 'fail' });
    const haeOnly = await fetchLiveDatasetUncached(twoSourceDeps(ENV, upstream.impl, false));
    const result = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl));
    expect(result.dataset.metrics['resting_heart_rate']).toEqual(haeOnly.dataset.metrics['resting_heart_rate']);
    expect(result.sourceErrors).toEqual([
      { sourceId: 'oura', kind: 'http_error', message: expect.stringContaining('HTTP 500') },
    ]);
    const text = JSON.stringify(result);
    for (const secret of [OURA_ACCESS, OURA_REFRESH, OURA_SECRET, TOKEN]) expect(text).not.toContain(secret);
  });

  it('serves Oura data plus a source error when HAE fails', async () => {
    const upstream = twoSourceFetch({ hae: 'fail' });
    const result = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl));
    expect(result.dataset.metrics['hrv_rmssd_sleep']).toBeDefined();
    expect(result.sourceErrors?.map(e => e.sourceId)).toEqual(['hae']);
  });

  it('throws, with both reasons, when every source fails', async () => {
    const upstream = twoSourceFetch({ hae: 'fail', oura: 'fail' });
    const error = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl)).catch(e => e);
    expect(error).toBeInstanceOf(LiveSourcesFailedError);
    expect((error as LiveSourcesFailedError).errors.map(e => e.sourceId).sort()).toEqual(['hae', 'oura']);
  });

  it('asks the reader to connect Oura when it is configured, not connected, and HAE is absent', async () => {
    const upstream = twoSourceFetch();
    const error = await fetchLiveDatasetUncached(twoSourceDeps(OURA_ONLY_ENV, upstream.impl, false)).catch(e => e);
    expect(error).toBeInstanceOf(NoLiveSourceError);
    expect((error as Error).message).toContain('Connect a data source in Settings');
    expect(upstream.ouraCalls).toHaveLength(0);
  });

  it('leaves ring records in HAE when Oura is configured but not connected', async () => {
    const upstream = twoSourceFetch();
    const result = await fetchLiveDatasetUncached(twoSourceDeps(BOTH_ENV, upstream.impl, false));
    const haeOnly = await fetchLiveDatasetUncached(twoSourceDeps(ENV, upstream.impl, false));
    expect(JSON.stringify(result)).toBe(JSON.stringify(haeOnly));
    expect(upstream.ouraCalls).toHaveLength(0);
  });

  it('keys the caches by the active source set and holds Oura under its own key', async () => {
    liveCache.clear();
    setCacheTtlForTests(60_000);
    const upstream = twoSourceFetch();
    const deps = { ...twoSourceDeps(BOTH_ENV, upstream.impl), bypassCache: false };
    await loadLiveDataset(deps);
    expect(liveCache.stats().keys.sort()).toEqual([liveCacheKey('UTC', 'hae+oura'), ouraCacheKey('UTC', LIVE_LOOKBACK_DAYS)].sort());
    const ouraBefore = upstream.ouraCalls.length;
    await loadLiveDataset(deps);
    expect(upstream.ouraCalls.length).toBe(ouraBefore);

    // Disconnecting changes the set: the old dataset is dropped, not served.
    await loadLiveDataset({ ...deps, sources: sourcesCtx(BOTH_ENV, false) });
    expect(liveCache.stats().keys.filter(k => k.startsWith('live-dataset:'))).toEqual([liveCacheKey('UTC', 'hae')]);
  });

  it('keeps every other collection when Oura refuses one for its scope', async () => {
    const upstream = twoSourceFetch({ ouraRefuses: 'vO2_max' });
    const dataset = await fetchLiveDatasetUncached({ ...twoSourceDeps(OURA_ONLY_ENV, upstream.impl) });
    expect(dataset).toBeTruthy();
    const asked = upstream.ouraCalls.map(c => /usercollection\/([^?]+)/.exec(c.url)?.[1]);
    expect(asked).toContain('sleep');
    expect(asked).toContain('daily_activity');
  });

  it('skips collections whose scope was not granted', async () => {
    const upstream = twoSourceFetch();
    await fetchLiveDatasetUncached({ ...twoSourceDeps(OURA_ONLY_ENV, upstream.impl), ouraClient: credentialPool('daily'), ouraApp: OURA_APP });
    const asked = upstream.ouraCalls.map(c => /usercollection\/([^?]+)/.exec(c.url)?.[1]).sort();
    expect(asked).toEqual(['daily_activity', 'daily_readiness', 'sleep']);
    for (const c of upstream.ouraCalls) expect(c.auth).toBe(`Bearer ${OURA_ACCESS}`);
  });
});

describe('data-quality corrections in the live load', () => {
  const DAY = '2026-09-10';
  const HOURS = [8, 9, 10, 12, 13, 15, 17, 18];
  /** Steps sample by sample plus the same hours as on-the-hour totals: the day counted twice. */
  const doubled = HOURS.flatMap(h => {
    const hh = String(h).padStart(2, '0');
    return [
      ...Array.from({ length: 12 }, (_, i) => ({ date: `${DAY}T${hh}:${String(i * 5).padStart(2, '0')}:07.000Z`, qty: 50, units: 'count', source: 'Apple Watch' })),
      { date: `${DAY}T${hh}:00:00.000Z`, qty: 600, units: 'count', source: 'Apple Watch' },
    ];
  });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/metrics/step_count') ? doubled : url.includes('/api/workouts') ? [] : [];
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  const load = (corrections: ReadonlySet<'overlapping-exports' | 'duplicate-readings'>) =>
    fetchLiveDatasetUncached({ ...HAE_DEPS, env: ENV, fetchImpl, now: () => NOW, bypassCache: true, corrections });
  const steps = (r: Awaited<ReturnType<typeof load>>) =>
    (r.dataset.metrics.step_count as { date: string; qty: number }[]).find(o => o.date === DAY)!.qty;

  it('counts the doubled day once and reports the check as corrected', async () => {
    const result = await load(new Set(['overlapping-exports', 'duplicate-readings']));
    expect(steps(result)).toBe(HOURS.length * 600);
    const report = await result.quality!.promise;
    expect(report!.checks.find(c => c.id === 'overlapping-exports')!.outcome).toBe('corrected');
    expect(report!.findings.find(f => f.check === 'overlapping-exports')).toBeUndefined();
    expect(result.provenance.find(p => p.metricId === 'step_count')!.dedupeRule).toMatch(/96 records that only repeat another/);
  });

  it('counts every record and reports a finding to fix with the correction off', async () => {
    const result = await load(new Set());
    expect(steps(result)).toBe(HOURS.length * 1200);
    const report = await result.quality!.promise;
    expect(report!.findings.find(f => f.check === 'overlapping-exports')!.correctable).toBe(true);
  });
});

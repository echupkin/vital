import { afterEach, describe, expect, it } from 'vitest';
import samples from '@/data/hae-samples.json';
import { PROBE_TIMEOUT_MS, readPipelineConfig, resolvePipelineStatus } from '@/lib/pipeline/status';
import { PIPELINE_ORDER, STAGE_STATUS_LABEL } from '@/lib/pipeline/types';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { resetToDemoDataset } from '@/lib/adapters/dataset';

const TOKEN = 'read-token-value';
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

const DEMO_CONFIGURED_ENV = {
  HAE_API_URL: 'http://localhost:3001',
  HAE_API_KEY: TOKEN,
} as unknown as NodeJS.ProcessEnv;

const LIVE_ENV = {
  VITAL_DATA_MODE: 'live',
  HAE_API_URL: 'http://localhost:3001',
  HAE_API_KEY: TOKEN,
  HAE_PROBE_METRIC: 'resting_heart_rate',
} as unknown as NodeJS.ProcessEnv;

const NOW = Date.parse('2026-09-17T18:00:00.000Z');

const METRICS = samples.metrics as unknown as Record<string, unknown[]>;

function sampleFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/workouts')) return { ok: true, status: 200, json: async () => samples.workouts } as unknown as Response;
    const match = /\/api\/metrics\/([^?]+)/.exec(url);
    const metric = match ? decodeURIComponent(match[1]) : '';
    return { ok: true, status: 200, json: async () => METRICS[metric] ?? [] } as unknown as Response;
  }) as unknown as typeof fetch;
}

function failingFetch(status = 500): typeof fetch {
  return (async () => ({ ok: false, status, json: async () => [] }) as unknown as Response) as unknown as typeof fetch;
}

afterEach(() => {
  resetToDemoDataset();
  liveCache.clear();
  setCacheTtlForTests(null);
});

describe('pipeline configuration reading (SPEC §10, §11)', () => {
  it('treats a missing URL or key as not configured', () => {
    const empty = readPipelineConfig(EMPTY_ENV);
    expect(empty.healthApiConfigured).toBe(false);
    expect(empty.healthApiHost).toBeNull();
    expect(empty.probeMetric).toBeNull();
    expect(readPipelineConfig({ HAE_API_URL: 'http://localhost:3001' } as unknown as NodeJS.ProcessEnv).healthApiConfigured).toBe(false);
    expect(readPipelineConfig({ HAE_API_KEY: 'x' } as unknown as NodeJS.ProcessEnv).healthApiConfigured).toBe(false);
  });

  it('reports the host and the probe metric but never the key', () => {
    const config = readPipelineConfig(DEMO_CONFIGURED_ENV);
    expect(config.healthApiConfigured).toBe(true);
    expect(config.healthApiHost).toBe('localhost:3001');
    expect(config.probeMetric).toBe('resting_heart_rate');
    expect(JSON.stringify(config)).not.toContain(TOKEN);
  });

  it('reports the configured probe metric when one is set', () => {
    expect(readPipelineConfig(LIVE_ENV).probeMetric).toBe('resting_heart_rate');
    expect(
      readPipelineConfig({ ...LIVE_ENV, HAE_PROBE_METRIC: 'step_count' } as unknown as NodeJS.ProcessEnv).probeMetric
    ).toBe('step_count');
  });
});

describe('stage derivation (SPEC §10)', () => {
  it('marks every upstream stage unknown or unconfigured in demo mode', async () => {
    const report = await resolvePipelineStatus({ env: EMPTY_ENV, now: () => NOW });
    expect(report.mode).toBe('demo');
    expect(report.stages.map(s => s.id)).toEqual(PIPELINE_ORDER);

    const byId = new Map(report.stages.map(s => [s.id, s]));
    expect(byId.get('health_auto_export')!.status).toBe('unconfigured');
    expect(byId.get('health_api')!.status).toBe('unconfigured');
    expect(byId.get('intelligence')!.status).toBe('healthy');
    expect(byId.get('dashboard')!.status).toBe('healthy');

    for (const stage of report.stages) expect(stage.derivedFrom.length).toBeGreaterThan(10);

    // The intelligence stage carries the real observation count of the demo set.
    expect(report.dataset.source).toBe('demo');
    expect(report.dataset.observationCount).toBeGreaterThan(1000);
    expect(byId.get('intelligence')!.observationCount).toBe(report.dataset.observationCount);
    expect(report.probe.attempted).toBe(false);
    expect(report.summary).toContain('Demo mode');
  });

  it('derives the live stages from a real, successful check', async () => {
    setCacheTtlForTests(0);
    const report = await resolvePipelineStatus({ env: LIVE_ENV, fetchImpl: sampleFetch(), now: () => NOW });

    expect(report.mode).toBe('live');
    const byId = new Map(report.stages.map(s => [s.id, s]));
    expect(byId.get('health_auto_export')!.status).toBe('healthy');
    expect(byId.get('health_api')!.status).toBe('healthy');
    expect(byId.get('intelligence')!.status).toBe('healthy');
    expect(byId.get('dashboard')!.status).toBe('healthy');

    // The probe reports the real number of records it received.
    expect(report.probe.attempted).toBe(true);
    expect(report.probe.outcome).toBe('ok');
    expect(report.probe.metric).toBe('resting_heart_rate');
    expect(report.probe.records).toBe(METRICS.resting_heart_rate.length);
    expect(report.probe.durationMs).not.toBeNull();

    // The dataset is the live one, with real counts and a real as-of time.
    expect(report.dataset.source).toBe('live');
    expect(report.dataset.observationCount).toBeGreaterThan(0);
    expect(report.dataset.lastObservationAt).toBeTruthy();
    expect(report.dataAsOf).toBe(report.dataset.lastObservationAt);
    expect(report.dataset.error).toBeNull();
    expect(report.cache.keys).toBeGreaterThan(0);
  });

  it('surfaces a failed live read instead of substituting demo data', async () => {
    setCacheTtlForTests(0);
    const report = await resolvePipelineStatus({ env: LIVE_ENV, fetchImpl: failingFetch(500), now: () => NOW });

    // The mode is still live: the app is not pretending to be in demo mode.
    expect(report.mode).toBe('live');
    const byId = new Map(report.stages.map(s => [s.id, s]));
    expect(byId.get('health_api')!.status).toBe('degraded');
    expect(byId.get('health_auto_export')!.status).toBe('degraded');
    expect(byId.get('intelligence')!.status).toBe('degraded');
    expect(report.dataset.source).toBe('live');
    expect(report.dataset.error).toContain('500');
    expect(report.summary).toContain('connection error rather than demo data');
    expect(byId.get('health_api')!.detail).toContain('500');
  });

  it('stays degraded when the API is unreachable, and times out rather than hanging', async () => {
    const abort = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    setCacheTtlForTests(0);
    const report = await resolvePipelineStatus({ env: LIVE_ENV, fetchImpl: abort, now: () => NOW });
    expect(report.probe.outcome).toBe('timeout');
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    const healthApi = report.stages.find(s => s.id === 'health_api')!;
    expect(healthApi.status).toBe('degraded');
    expect(healthApi.detail).toContain('did not answer');
  });

  it('never exposes a credential in the report', async () => {
    setCacheTtlForTests(0);
    const report = await resolvePipelineStatus({ env: LIVE_ENV, fetchImpl: sampleFetch(), now: () => NOW });
    expect(JSON.stringify(report)).not.toContain(TOKEN);
    expect(report.config.healthApiHost).toBe('localhost:3001');
  });

  it('labels every status word for display', () => {
    expect(STAGE_STATUS_LABEL).toEqual({
      healthy: 'Healthy',
      degraded: 'Degraded',
      unknown: 'Unknown',
      unconfigured: 'Not configured',
    });
  });

  it('is deterministic for a fixed clock', async () => {
    const a = await resolvePipelineStatus({ env: EMPTY_ENV, now: () => 0, skipDataset: true });
    const b = await resolvePipelineStatus({ env: EMPTY_ENV, now: () => 0, skipDataset: true });
    expect(a).toEqual(b);
    expect(a.checkedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('accepts a dataset summary from the caller without loading anything', async () => {
    const report = await resolvePipelineStatus({
      env: EMPTY_ENV,
      now: () => NOW,
      datasetSummary: {
        source: 'demo',
        observationCount: 42,
        metricCount: 3,
        workouts: 1,
        referenceKey: '2026-09-17',
        windowStartKey: '2026-03-21',
        timezone: 'America/Chicago',
        lastObservationAt: '2026-09-16T05:00:00.000Z',
        error: null,
      },
    });
    const intelligence = report.stages.find(s => s.id === 'intelligence')!;
    expect(intelligence.observationCount).toBe(42);
    expect(intelligence.lastObservationAt).toBe('2026-09-16T05:00:00.000Z');
    expect(report.dataAsOf).toBe('2026-09-16T05:00:00.000Z');
  });
});

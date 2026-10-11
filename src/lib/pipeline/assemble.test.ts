// ── The pipeline report, put together part by part ───────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { assembleReport } from '@/lib/pipeline/assemble';
import { resolveDatasetPart, resolvePipelineStatus, resolveSourcesPart, resolveWorkoutsPart } from '@/lib/pipeline/status';
import { PIPELINE_ORDER, type PipelineStage, type StageId } from '@/lib/pipeline/types';
import { buildHaeConfig } from '@/lib/adapters/hae';
import { liveCache, setCacheTtlForTests } from '@/lib/adapters/cache';
import { resetToDemoDataset } from '@/lib/adapters/dataset';
import { encryptJson, keyId } from '@/lib/secrets/crypto';
import type { StoredOuraApp } from '@/lib/adapters/oura/app-store';
import type { PoolLike } from '@/lib/db/pool';

const NOW = Date.parse('2026-09-17T18:00:00.000Z');
const DEPS = { env: {} as NodeJS.ProcessEnv, haeConfig: null, haeClient: null, now: () => NOW, skipDataset: true };
const statusOf = (stages: PipelineStage[]) => Object.fromEntries(stages.map(s => [s.id, s.status])) as Record<StageId, string>;

afterEach(() => {
  resetToDemoDataset();
  liveCache.clear();
  setCacheTtlForTests(null);
});

describe('assembleReport', () => {
  it('starts with every stage checking, before any part has answered', () => {
    const report = assembleReport({});
    expect(report.stages.map(s => s.id)).toEqual(PIPELINE_ORDER);
    expect(report.stages.every(s => s.status === 'checking' && s.derivedFrom === 'The check is still running.')).toBe(true);
    expect(report.stages.find(s => s.id === 'intelligence')!.detail).toMatch(/^Waiting for the health history to load/);
    expect(report.pending).toEqual(['sources', 'dataset', 'workouts']);
    expect(report.summary).toBe('Checking each stage…');
    expect(report.qualityState).toBe('computing');
  });

  it('fills in only the stages of the part that answered', async () => {
    const report = assembleReport({ sources: await resolveSourcesPart(DEPS) });
    expect(statusOf(report.stages)).toEqual({
      health_auto_export: 'unconfigured',
      health_api: 'unconfigured',
      oura_api: 'unconfigured',
      data_quality: 'checking',
      intelligence: 'checking',
      dashboard: 'healthy',
    });
    expect(report.pending).toEqual(['dataset', 'workouts']);
  });

  it('turns only a failed part’s stages to Unknown, with the reason', async () => {
    const report = assembleReport({
      sources: await resolveSourcesPart(DEPS),
      dataset: { error: 'the status endpoint answered HTTP 500.' },
      workouts: await resolveWorkoutsPart(DEPS),
    });
    const quality = report.stages.find(s => s.id === 'data_quality')!;
    expect(quality.status).toBe('unknown');
    expect(quality.detail).toBe('The check could not be read: the status endpoint answered HTTP 500.');
    expect(report.stages.find(s => s.id === 'intelligence')!.status).toBe('unknown');
    expect(report.stages.find(s => s.id === 'health_api')!.status).toBe('unconfigured');
    expect(report.qualityState).toBe('failed');
    expect(report.summary).toMatch(/^Part of the status could not be read \(dataset\)\./);
    expect(report.pending).toEqual([]);
  });

  it('is the full report once every part is in', async () => {
    const parts = {
      sources: await resolveSourcesPart(DEPS),
      dataset: await resolveDatasetPart(DEPS),
      workouts: await resolveWorkoutsPart(DEPS),
    };
    expect(assembleReport(parts)).toEqual(await resolvePipelineStatus(DEPS));
  });

  it('leaves parts that were not asked for out of pending', () => {
    expect(assembleReport({}, { requested: ['workouts'] }).pending).toEqual(['workouts']);
  });
});

describe('the probes run at once', () => {
  const KEY = Buffer.alloc(32, 3);
  const env = { VITAL_DATA_MODE: 'live', OURA_API_URL: 'http://oura.test', VITAL_SECRET_KEY: KEY.toString('base64') } as unknown as NodeJS.ProcessEnv;
  const app: StoredOuraApp = {
    state: 'ok', clientId: 'sample-client', clientSecret: 'sample-secret',
    redirectUri: 'http://localhost:8080/api/sources/oura/callback', loginClientId: null,
  };
  const parts = encryptJson({ access_token: 'sample-access', refresh_token: 'sample-refresh' }, KEY);
  const ouraPool: PoolLike = {
    query: async () => ({
      rows: [{
        source_id: 'oura', ciphertext: parts.ciphertext, iv: parts.iv, auth_tag: parts.authTag, key_id: keyId(KEY),
        scopes: 'daily', access_expires_at: '2099-01-01T00:00:00.000Z', connected_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z', revision: 1,
      }],
    }),
  };

  it('the export probe does not wait for Oura, nor Oura for it', async () => {
    // Each answers only once the other has been asked: run one after the other, the first would time out.
    let ouraAsked!: () => void;
    let haeAsked!: () => void;
    const ouraSeen = new Promise<void>(r => (ouraAsked = r));
    const haeSeen = new Promise<void>(r => (haeAsked = r));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://oura.test')) {
        ouraAsked();
        await haeSeen;
        return new Response(JSON.stringify({ data: [{ day: '2026-09-16' }] }), { status: 200 });
      }
      haeAsked();
      await ouraSeen;
      return new Response(JSON.stringify([{ date: '2026-09-17', qty: 60 }]), { status: 200 });
    }) as unknown as typeof fetch;

    const part = await resolveSourcesPart({
      env,
      fetchImpl,
      now: () => NOW,
      haeConfig: buildHaeConfig('http://localhost:3001', 'read-token-value', env),
      haeClient: { query: async () => ({ rows: [{ present: 1 }] }) },
      ouraClient: ouraPool,
      ouraApp: app,
    });
    expect(part.probe.outcome).toBe('ok');
    expect(part.ouraOk).toBe(true);
  });
});

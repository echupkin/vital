import { afterEach, describe, expect, it } from 'vitest';
import { heldSourceStatuses, loadExerciseTemplates, loadTrainingData, resetTrainingStoreForTests } from './store';
import { matchSession } from './match';

const LIVE = { VITAL_DATA_MODE: 'live' } as unknown as NodeJS.ProcessEnv;
const STORED = { state: 'ok', apiKey: 'hevy-key-for-tests', url: '' } as const;
const NOW = Date.parse('2026-09-18T12:00:00Z');

afterEach(() => resetTrainingStoreForTests());

function hevyFetch(opts: { failWorkouts?: boolean } = {}) {
  let workoutCalls = 0;
  const paths: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    let status = 200;
    let body: unknown;
    if (url.pathname === '/v1/exercise_templates') {
      body = { page: 1, page_count: 1, exercise_templates: [] };
    } else if (url.pathname === '/v1/workouts') {
      workoutCalls++;
      if (opts.failWorkouts) {
        status = 500;
        body = {};
      } else {
        body = {
          page: 1,
          page_count: 1,
          workouts: [
            {
              id: 'one',
              title: 'Upper',
              start_time: '2026-09-17T23:00:00Z',
              end_time: '2026-09-17T23:30:00Z',
              exercises: [{ title: 'Push Up', exercise_template_id: 'P', sets: [{ index: 0, type: 'normal', reps: 10 }] }],
            },
          ],
        };
      }
    } else {
      status = 404;
      body = {};
    }
    return { ok: status === 200, status, json: async () => body, text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, workoutCalls: () => workoutCalls, paths: () => paths };
}

describe('loadTrainingData', () => {
  it('serves the committed fixtures in demo mode without any request', async () => {
    const data = await loadTrainingData({ env: {} as NodeJS.ProcessEnv, fetchImpl: (() => { throw new Error('no network'); }) as unknown as typeof fetch });
    expect(data.origin).toBe('demo');
    expect(data.sessions.length).toBeGreaterThan(40);
    expect(data.statuses.find(s => s.id === 'hevy')?.origin).toBe('demo');
    // Oldest first.
    expect(data.sessions[0].startTime <= data.sessions[data.sessions.length - 1].startTime).toBe(true);
  });

  it('syncs a configured source once and serves the held sessions from the shared store', async () => {
    const fake = hevyFetch();
    const first = await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: fake.impl, now: () => NOW });
    expect(first.origin).toBe('live');
    expect(first.sessions.map(s => s.id)).toEqual(['hevy:one']);
    const status = first.statuses.find(s => s.id === 'hevy')!;
    expect(status).toMatchObject({ configured: true, origin: 'live', sessions: 1, lastError: null, host: 'api.hevyapp.com' });

    await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: fake.impl, now: () => NOW });
    expect(fake.workoutCalls()).toBe(1);
    expect((await heldSourceStatuses({ env: LIVE, hevyStored: STORED }))[0].sessions).toBe(1);
  });

  it('syncs again on a refresh ("Check again") instead of serving the held sync', async () => {
    const fake = hevyFetch();
    await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: fake.impl, now: () => NOW });
    const afterFirst = fake.paths().length;
    await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: fake.impl, now: () => NOW });
    expect(fake.paths().length).toBe(afterFirst);
    // The second sync is incremental (only what changed since the first), but it does ask Hevy again.
    await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: fake.impl, now: () => NOW, refresh: true });
    expect(fake.paths().length).toBeGreaterThan(afterFirst);
  });

  it('reports a failing source instead of throwing', async () => {
    const data = await loadTrainingData({ env: LIVE, hevyStored: STORED, fetchImpl: hevyFetch({ failWorkouts: true }).impl, now: () => NOW });
    expect(data.sessions).toEqual([]);
    expect(data.statuses[0].lastError).toMatch(/HTTP 500/);
  });

  it('reports an unconfigured source in live mode', async () => {
    const data = await loadTrainingData({ env: { VITAL_DATA_MODE: 'live' } as unknown as NodeJS.ProcessEnv, hevyStored: { state: 'none' } });
    expect(data.sessions).toEqual([]);
    expect(data.statuses[0]).toMatchObject({ configured: false, origin: 'none' });
  });

  it('exposes the demo exercise catalogue', async () => {
    const templates = await loadExerciseTemplates({ env: {} as NodeJS.ProcessEnv });
    expect(templates.some(t => t.name === 'Decline Push Up')).toBe(true);
  });
});

describe('matchSession', () => {
  const sessions = [
    { id: 'a', startTime: '2026-09-17T23:10:00Z', endTime: '2026-09-17T23:42:00Z' },
    { id: 'b', startTime: '2026-09-18T23:05:00Z', endTime: '2026-09-18T23:34:00Z' },
  ];

  it('pairs an Apple Health workout with the overlapping session', () => {
    const hit = matchSession({ start_time: '2026-09-17T23:11:00Z', end_time: '2026-09-17T23:45:00Z' }, sessions);
    expect(hit?.id).toBe('a');
  });

  it('returns null when nothing overlaps enough', () => {
    expect(matchSession({ start_time: '2026-09-17T20:00:00Z', end_time: '2026-09-17T21:00:00Z' }, sessions)).toBeNull();
  });
});

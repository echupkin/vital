// ── TTL cache: single-flight and stale-while-revalidate ─
//
// Deterministic and offline: no network, no real timers. Only `Date` is faked,
// so the TTL boundary can be crossed by moving the clock instead of waiting.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '@/lib/adapters/cache';

const T0 = new Date('2026-09-17T18:00:00.000Z');
const TTL_MS = 300_000;

/** A loader whose completion the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let microtasks and one macrotask turn run (setTimeout is not faked). */
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

function newCache() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  return new TtlCache(() => TTL_MS);
}

describe('cold path (no entry at all)', () => {
  it('blocks the caller on one loader and returns the loaded value', async () => {
    const cache = newCache();
    const d = deferred<string>();
    let calls = 0;

    const pending = cache.getOrLoad('cold', () => {
      calls += 1;
      return d.promise;
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await tick();
    expect(calls).toBe(1);
    expect(settled).toBe(false); // still waiting: the cold path is allowed to block

    d.resolve('v1');
    await expect(pending).resolves.toBe('v1');
    expect(settled).toBe(true);
    expect(cache.stats().misses).toBe(1);
  });

  it('collapses N concurrent cold requests into exactly one upstream pass', async () => {
    const cache = newCache();
    const d = deferred<number>();
    let calls = 0;
    const loader = () => {
      calls += 1;
      return d.promise;
    };

    const all = [1, 2, 3, 4].map(() => cache.getOrLoad('cold-many', loader));
    await tick();
    expect(calls).toBe(1);
    expect(cache.stats().inFlight).toBe(1);

    d.resolve(7);
    await expect(Promise.all(all)).resolves.toEqual([7, 7, 7, 7]);
    expect(calls).toBe(1);
    // Only the first caller counted a miss; the joiners are hits.
    expect(cache.stats().misses).toBe(1);
  });

  it('does not cache a failed load, so the next request retries', async () => {
    const cache = newCache();
    await expect(cache.getOrLoad('cold-fail', () => Promise.reject(new Error('upstream down')))).rejects.toThrow(
      'upstream down'
    );
    await tick();
    expect(cache.stats().inFlight).toBe(0);
    await expect(cache.getOrLoad('cold-fail', () => Promise.resolve('retried'))).resolves.toBe('retried');
  });
});

describe('fresh path', () => {
  it('serves a fresh entry without calling the loader again', async () => {
    const cache = newCache();
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.resolve(`v${calls}`);
    };

    expect(await cache.getOrLoad('fresh', loader)).toBe('v1');
    expect(cache.isFresh('fresh')).toBe(true);
    vi.setSystemTime(new Date(T0.getTime() + TTL_MS - 1));
    expect(await cache.getOrLoad('fresh', loader)).toBe('v1');
    expect(calls).toBe(1);
    expect(cache.stats().hits).toBe(1);
  });
});

describe('stale-while-revalidate (TTL lapsed, value still held)', () => {
  it('serves the stale value immediately and refreshes without the caller awaiting it', async () => {
    const cache = newCache();
    const first = deferred<string>();
    const priming = cache.getOrLoad('swr', () => first.promise);
    first.resolve('stale');
    expect(await priming).toBe('stale');

    // The TTL lapses with no request in between.
    vi.setSystemTime(new Date(T0.getTime() + TTL_MS + 1_000));

    const refresh = deferred<string>();
    let calls = 0;
    const served = await cache.getOrLoad('swr', () => {
      calls += 1;
      return refresh.promise;
    });

    // The value came back while the refresh is still unresolved.
    expect(served).toBe('stale');
    expect(calls).toBe(1);
    expect(cache.stats().staleHits).toBe(1);
    expect(cache.stats().revalidations).toBe(1);
    expect(cache.stats().inFlight).toBe(1);
    expect(cache.isFresh('swr')).toBe(false);

    // Finishing the refresh replaces the entry; the next read is a plain hit.
    refresh.resolve('fresh');
    await cache.awaitIdle();
    expect(cache.stats().inFlight).toBe(0);
    expect(cache.isFresh('swr')).toBe(true);
    expect(await cache.getOrLoad('swr', () => Promise.resolve('unused'))).toBe('fresh');
    expect(calls).toBe(1);
  });

  it('collapses concurrent stale readers into one background refresh', async () => {
    const cache = newCache();
    expect(await cache.getOrLoad('swr-many', () => Promise.resolve('stale'))).toBe('stale');
    vi.setSystemTime(new Date(T0.getTime() + TTL_MS + 1_000));

    const refresh = deferred<string>();
    let calls = 0;
    const loader = () => {
      calls += 1;
      return refresh.promise;
    };

    const served = await Promise.all([
      cache.getOrLoad('swr-many', loader),
      cache.getOrLoad('swr-many', loader),
      cache.getOrLoad('swr-many', loader),
    ]);
    expect(served).toEqual(['stale', 'stale', 'stale']);
    expect(calls).toBe(1);
    expect(cache.stats().revalidations).toBe(1);

    refresh.resolve('fresh');
    await cache.awaitIdle();
    expect(await cache.getOrLoad('swr-many', loader)).toBe('fresh');
    expect(calls).toBe(1);
  });

  it('keeps serving the stale value when the background refresh fails, without an unhandled rejection', async () => {
    const cache = newCache();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(await cache.getOrLoad('swr-fail', () => Promise.resolve('stale'))).toBe('stale');
      vi.setSystemTime(new Date(T0.getTime() + TTL_MS + 1_000));

      // The stale read succeeds even though the refresh rejects immediately.
      expect(await cache.getOrLoad('swr-fail', () => Promise.reject(new Error('upstream down')))).toBe('stale');
      await cache.awaitIdle();
      await tick();
      await tick();

      expect(unhandled).toEqual([]);
      expect(cache.stats().inFlight).toBe(0);
      // The failed refresh did not replace or expire what we hold.
      expect(await cache.getOrLoad('swr-fail', () => Promise.resolve('stale'))).toBe('stale');
      expect(cache.stats().staleHits).toBeGreaterThanOrEqual(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('waits for a running refresh rather than starting a second one', async () => {
    const cache = newCache();
    expect(await cache.getOrLoad('swr-race', () => Promise.resolve('stale'))).toBe('stale');
    vi.setSystemTime(new Date(T0.getTime() + TTL_MS + 1_000));

    const refresh = deferred<string>();
    let calls = 0;
    const loader = () => {
      calls += 1;
      return refresh.promise;
    };

    expect(await cache.getOrLoad('swr-race', loader)).toBe('stale');
    // A refresh is running: a further cold-shaped call (clear() the entry) joins
    // it instead of opening a second upstream pass.
    cache.clear('swr-race');
    const joined = cache.getOrLoad('swr-race', loader);
    await tick();
    expect(calls).toBe(1);

    refresh.resolve('fresh');
    await expect(joined).resolves.toBe('fresh');
    expect(calls).toBe(1);
  });
});

describe('statistics', () => {
  it('reports the real counters for the pipeline panel', async () => {
    const cache = newCache();
    expect(cache.stats()).toMatchObject({ keys: [], inFlight: 0, hits: 0, misses: 0, staleHits: 0, revalidations: 0, ttlMs: TTL_MS });
    await cache.getOrLoad('s', () => Promise.resolve('v'));
    vi.setSystemTime(new Date(T0.getTime() + TTL_MS + 1));
    await cache.getOrLoad('s', () => Promise.resolve('v2'));
    const stats = cache.stats();
    expect(stats.keys).toEqual(['s']);
    expect(stats.misses).toBe(1);
    expect(stats.staleHits).toBe(1);
    expect(stats.revalidations).toBe(1);
    expect(stats.ttlMs).toBe(TTL_MS);
  });
});

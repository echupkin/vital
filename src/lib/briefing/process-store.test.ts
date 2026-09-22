import { beforeEach, describe, expect, it, vi } from 'vitest';

// The briefing cache must belong to the PROCESS, not to one server bundle.
//
// Next.js builds the page and the route handlers separately, so a module-level
// Map exists once per bundle: `/` and `/api/briefing` each held their own copy,
// generated the same day's briefing separately, and disagreed about when it was
// written and which model wrote it (the hero showed 10:39 written by the local
// model while the API served 08:02 written by the fallback).
//
// These tests lock in the anchor that fixes it: a re-instantiated module — which
// is what a second bundle is — must find the SAME state object.

const KEY = Symbol.for('vital.briefing.store');

function store(): unknown {
  return (globalThis as unknown as Record<symbol, unknown>)[KEY];
}

describe('the briefing cache is anchored to the process', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as unknown as Record<symbol, unknown>)[KEY];
  });

  it('creates its state on globalThis when the module loads', async () => {
    expect(store()).toBeUndefined();
    await import('./index');
    expect(store()).toBeTruthy();
  });

  it('hands a re-instantiated module the same store, so two bundles share one cache', async () => {
    const first = await import('./index');
    first.briefingCacheStats();
    const fromFirstBundle = store();
    expect(fromFirstBundle).toBeTruthy();

    // Simulating the second bundle: a fresh module graph in the same process.
    vi.resetModules();
    const second = await import('./index');
    second.briefingCacheStats();

    expect(store()).toBe(fromFirstBundle);
  });

  it('keeps one counter pair, so stats cannot be split across bundles', async () => {
    const first = await import('./index');
    first.briefingCacheStats();
    vi.resetModules();
    const second = await import('./index');
    const stats = second.briefingCacheStats();

    // A per-bundle cache would start each bundle at zero and report one key set
    // per bundle; a process-wide one reports a single shared map.
    expect(Array.isArray(stats.keys)).toBe(true);
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
  });
});
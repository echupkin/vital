// ── In-process TTL cache with single-flight + stale-while-revalidate ────
//
// Page loads must not re-fetch the whole upstream history, and several
// concurrent requests (a page plus the pipeline panel, say) must not each open
// their own upstream call. One entry per key, one in-flight loader per key.
//
// Latency rule: no page ever waits on a cold rebuild it does not have to.
//
//   * fresh entry            → served immediately (a hit).
//   * TTL lapsed, value held → the STALE value is served immediately and one
//                              background refresh is started (single-flight).
//                              The caller never awaits the refresh.
//   * no entry at all        → the caller blocks on one shared loader; this is
//                              the only path allowed to wait for upstream.
//
// The cache lives in the server process only. Nothing here is ever serialised to
// the browser.

export interface CacheStats {
  keys: string[];
  /** Age in ms of the oldest entry, or null when empty. */
  oldestAgeMs: number | null;
  inFlight: number;
  hits: number;
  misses: number;
  /** Served from a TTL-lapsed entry without waiting for its refresh. */
  staleHits: number;
  /** Background refreshes started because a stale entry was served. */
  revalidations: number;
  ttlMs: number;
}

interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
}

export class TtlCache {
  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;
  private staleHits = 0;
  private revalidations = 0;

  constructor(private readonly ttlMs: () => number) {}

  /**
   * Return the cached value, or load it once.
   *
   * Concurrent callers for the same key share a single loader invocation. A
   * TTL-lapsed entry is served immediately and refreshed in the background; only
   * a key with no entry at all makes the caller wait for upstream.
   */
  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) {
      this.hits += 1;
      return hit.value as T;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      // Single-flight: join the call that is already running. A stale value, if
      // one is held, still beats waiting for that refresh to land.
      this.hits += 1;
      if (hit) {
        this.staleHits += 1;
        return hit.value as T;
      }
      return pending as Promise<T>;
    }

    if (hit) {
      // Stale-while-revalidate: hand back the value we hold right now and start
      // the refresh without awaiting it. Concurrent stale readers collapse into
      // that same single refresh.
      this.staleHits += 1;
      this.revalidations += 1;
      this.start(key, loader);
      return hit.value as T;
    }

    // Genuinely cold (no entry): block on one shared upstream pass.
    this.misses += 1;
    return (await this.start(key, loader)) as T;
  }

  /**
   * Start the one loader for a key, or join the one already running. The entry
   * is replaced only when the load succeeds, so a failed refresh leaves any
   * stale value in place to keep serving.
   */
  private start(key: string, loader: () => Promise<unknown>): Promise<unknown> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const value = await loader();
      const storedAt = Date.now();
      this.entries.set(key, {
        value,
        storedAt,
        expiresAt: storedAt + this.ttlMs(),
      });
      return value;
    })();

    this.inFlight.set(key, promise);
    const settle = () => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    };
    // A background refresh may reject with nobody awaiting it: attach the
    // settle handler to both outcomes so it is never an unhandled rejection.
    promise.then(settle, settle);
    return promise;
  }

  /** True when a value is held and still inside its TTL. */
  isFresh(key: string): boolean {
    const hit = this.entries.get(key);
    return Boolean(hit && hit.expiresAt > Date.now());
  }

  /**
   * The value held for a key — fresh or stale — without starting any load.
   *
   * `getOrLoad` deliberately blocks on a genuinely cold key (that is the right
   * behaviour for a dataset a page cannot render without). A caller that has a
   * local fallback must not block, though: it peeks, and on a cold key serves
   * its fallback while `prefetch` fills the entry in the background.
   */
  peek<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  /**
   * Start (or join) the load for a key without awaiting it.
   *
   * Used by stale-while-revalidate callers and for a cold fill whose caller has
   * something else to render. The outcome is delivered through the cache, never
   * through a rejection: a failed background load leaves any previous value in
   * place and is reported to the caller of `getOrLoad` on a later request.
   */
  prefetch(key: string, loader: () => Promise<unknown>): void {
    // `start` already attaches a settle handler to both outcomes, so a rejected
    // background load is never an unhandled rejection.
    void this.start(key, loader);
  }

  /** Resolve once nothing is in flight — how tests await a background refresh. */
  async awaitIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  /** Drop everything. Used by tests and by an explicit refresh. */
  clear(key?: string): void {
    if (key) this.entries.delete(key);
    else this.entries.clear();
  }

  stats(): CacheStats {
    const now = Date.now();
    const stored = [...this.entries.values()].map(e => e.storedAt);
    return {
      keys: [...this.entries.keys()],
      oldestAgeMs: stored.length > 0 ? now - Math.min(...stored) : null,
      inFlight: this.inFlight.size,
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      revalidations: this.revalidations,
      ttlMs: this.ttlMs(),
    };
  }
}

/** The process-wide cache used by the live adapter. */
export const liveCache = new TtlCache(() => liveCacheTtlMs());

let ttlOverrideMs: number | null = null;

/** Tests set a TTL explicitly; production reads HAE_CACHE_TTL_SECONDS. */
export function setCacheTtlForTests(ms: number | null): void {
  ttlOverrideMs = ms;
}

export function liveCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  if (ttlOverrideMs != null) return ttlOverrideMs;
  const raw = Number(env.HAE_CACHE_TTL_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw * 1000);
  return 300_000;
}

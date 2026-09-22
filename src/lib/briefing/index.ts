// ── Today's briefing: read path, day schedule and attribution ───
//
// The single server-side entry point for the hero. It never awaits a model:
//
//   * a briefing already written for the current day → served as-is;
//   * nothing written yet, at/after the profile's briefing hour → the computed
//     briefing is served now and one generation runs behind it (single-flight);
//   * before the briefing hour → the PREVIOUS day's briefing stays on screen,
//     labelled with the day it covers. Today's briefing is deliberately not
//     generated yet.
//
// Generation happens ONCE PER LOCAL CALENDAR DAY, and the cache key says so:
//
//     briefing:v<contextVersion>:<day>:<profileFingerprint>:<unit system>
//
// The key carries no dataset identity. Health Auto Export lands new observations
// all day long, and a briefing that regenerated whenever one arrived would be a
// per-observation model call. A briefing describes the last seven days against
// the seven before them and the previous month, none of which changes within a
// day — so new data arriving mid-day must not replace a briefing already written
// for that day.
//
// There is no scheduler and no background job. A new day's briefing is written
// lazily, by the first request at/after `briefingHour`; that is a read-through
// fill, not a job, and the panel's honesty about having no ingestion job stays
// intact. The boot warm-up obeys the same rule: it primes only when the hour has
// already passed and the day is not yet cached.
//
// `Regenerate` is the one explicit control: it drops the current day's entry and
// writes it again, once, so a failed or unwanted day is not stuck until
// tomorrow.
//
// Attribution is mandatory and is decided by who actually wrote the text:
//   model    → `Written by <model>`
//   computed → `Computed from your data — analyst model offline`
// The computed text can never be labelled as model output, and vice versa.

import { buildBriefing } from '../analytics/narrative';
import { REFERENCE_KEY } from '../adapters/dataset';
import type { UnitSystem } from '../prefs';
import { ageInYears, defaultProfile, type VitalProfile } from '../profile/types';
import { briefingSchedule, briefingTimeLabel, type BriefingSchedule } from './schedule';
import {
  BRIEFING_CONTEXT_VERSION,
  buildBriefingContext,
  estimateContextTokens,
  type BriefingContext,
} from './context';
import {
  BriefingEngineError,
  generateBriefingText,
  resolveBriefingEngine,
  type BriefingEngine,
  type EngineDeps,
} from './engine';
import type {
  BriefingEngineKind,
  BriefingPayload,
  BriefingTraceability,
  BriefingView,
} from './types';
import { COMPUTED_ATTRIBUTION, modelAttribution } from './attribution';

export type { BriefingEngineKind, BriefingPayload, BriefingTraceability, BriefingView };
export { COMPUTED_ATTRIBUTION, modelAttribution };

export interface BriefingDeps {
  system?: UnitSystem;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Test seam: the clock the day schedule is computed against. */
  now?: () => Date;
  /** Test seam: an explicit profile instead of the one on disk. */
  profile?: VitalProfile;
  /**
   * Test seam: produce the model text for a context without any network. Left
   * undefined in production, where the resolved engine is used.
   */
  generate?: (context: BriefingContext, engine: BriefingEngine) => Promise<BriefingModelTextLike>;
}

/** What a generator hands back (structurally `BriefingModelText`). */
export interface BriefingModelTextLike {
  headline: string;
  body: string;
  recommendations: string[];
  model: string | null;
  latencyMs: number;
  traceability: BriefingTraceability;
  adjustments: string[];
  engineKind?: BriefingEngineKind;
  engineDetail?: string;
  provider?: string | null;
  destination?: string | null;
}

// ── The day schedule ────────────────────────────────────
// (Defined in ./schedule so the client can label the hero with the same rule.)

export { briefingSchedule, briefingTimeLabel };
export type { BriefingSchedule };

// ── Cache ───────────────────────────────────────────────
//
// A plain day-keyed map plus single-flight. There is deliberately NO TTL: the
// day key is authoritative and an entry lives until the day rolls over (which
// changes the key) or an explicit regenerate clears it. A TTL knob on top of a
// day key would be a second, weaker answer to the same question.

/** How long a failed generation suppresses another attempt for the same day. */
export const BRIEFING_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

interface CachedBriefing {
  payload: BriefingPayload;
  storedAt: number;
}

interface FailureRecord {
  at: number;
  reason: string;
}

// ── One cache per PROCESS, not one per bundle ────────────
//
// Next.js builds the page and the route handlers as separate server bundles, so
// a module-level Map in this file exists once per bundle: `/` and `/api/briefing`
// each held their own copy, generated the same day's briefing separately, and
// disagreed about when it was written and which model wrote it (observed: the
// API served 08:02 written by the fallback, while the hero showed 10:39 written
// by the local model — the same module-graph trap `instrumentation.ts` warns
// about). `globalThis` is per process, so anchoring the state there gives every
// bundle one cache, one in-flight fill and one failure record.
interface BriefingStore {
  entries: Map<string, CachedBriefing>;
  inFlight: Map<string, Promise<BriefingPayload>>;
  failures: Map<string, FailureRecord>;
  hits: number;
  misses: number;
}

const BRIEFING_STORE_KEY = Symbol.for('vital.briefing.store');

function processStore(): BriefingStore {
  const g = globalThis as unknown as Record<symbol, BriefingStore | undefined>;
  if (!g[BRIEFING_STORE_KEY]) {
    g[BRIEFING_STORE_KEY] = {
      entries: new Map(),
      inFlight: new Map(),
      failures: new Map(),
      hits: 0,
      misses: 0,
    };
  }
  return g[BRIEFING_STORE_KEY] as BriefingStore;
}

const state = processStore();

function peekPayload(key: string): BriefingPayload | undefined {
  return state.entries.get(key)?.payload;
}

function startLoad(key: string, loader: () => Promise<BriefingPayload>): Promise<BriefingPayload> {
  const existing = state.inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const payload = await loader();
    state.entries.set(key, { payload, storedAt: Date.now() });
    return payload;
  })();
  state.inFlight.set(key, promise);
  const settle = () => {
    if (state.inFlight.get(key) === promise) state.inFlight.delete(key);
  };
  // A background fill may reject with nobody awaiting it: attach the settle
  // handler to both outcomes so it is never an unhandled rejection.
  promise.then(settle, settle);
  return promise;
}

/** Start (or join) a day's generation without awaiting it. */
function prefetch(key: string, loader: () => Promise<BriefingPayload>): void {
  void startLoad(key, loader);
}

export function clearBriefingCache(): void {
  state.entries.clear();
  state.inFlight.clear();
  state.failures.clear();
}

export function briefingCacheStats(): { keys: string[]; inFlight: number; hits: number; misses: number } {
  return { keys: [...state.entries.keys()], inFlight: state.inFlight.size, hits: state.hits, misses: state.misses };
}

/** Resolve once no briefing generation is in flight (tests, and the warm-up). */
export function awaitBriefingIdle(): Promise<void> {
  return (async () => {
    while (state.inFlight.size > 0) {
      await Promise.allSettled([...state.inFlight.values()]);
    }
  })();
}

/** The last recorded generation failure for a key, or null when there is none. */
export function lastBriefingFailure(key: string): FailureRecord | null {
  return state.failures.get(key) ?? null;
}

// ── Cache key ───────────────────────────────────────────

/** A short, stable fingerprint of the profile fields that reach the prompt. */
function profileFingerprint(profile: VitalProfile | null | undefined): string {
  if (!profile) return 'p-';
  const material = JSON.stringify([profile.name, ageInYears(profile.dateOfBirth), profile.notes, profile.timezone]);
  // FNV-1a, 32 bit, rendered as 8 hex characters. Enough to notice a change,
  // short enough to read in a cache key, and it contains none of the text.
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `p${hash.toString(16).padStart(8, '0')}`;
}

/**
 * The cache key: the local calendar day the briefing is for, the profile fields
 * that reach the prompt, and the unit system.
 *
 * Deliberately day-granular and deliberately free of any dataset identity:
 * Health Auto Export lands new observations all day long, and regenerating on
 * every one of them would make the briefing a per-observation model call.
 */
export function briefingCacheKey(
  schedule: BriefingSchedule,
  system: UnitSystem = 'metric',
  profile?: VitalProfile | null
): string {
  return `briefing:v${BRIEFING_CONTEXT_VERSION}:${schedule.coversDay}:${profileFingerprint(profile)}:${system}`;
}

// ── Fallback ────────────────────────────────────────────

/** The deterministic briefing the app has always shown, as a payload. */
export function computedBriefing(
  context: BriefingContext,
  schedule: BriefingSchedule,
  options: { reason?: string | null; engineDetail?: string | null; adjustments?: string[] } = {}
): BriefingPayload {
  const briefing = buildBriefing(REFERENCE_KEY);
  return {
    kind: 'computed',
    headline: briefing.headline,
    body: briefing.body,
    // The computed path names no model and therefore recommends nothing: the
    // recommendation list is model-authored copy, and inventing a deterministic
    // stand-in would blur the line the attribution line exists to draw.
    recommendations: [],
    attribution: COMPUTED_ATTRIBUTION,
    model: null,
    provider: null,
    destination: null,
    engine: null,
    engineDetail: options.engineDetail ?? null,
    generatedAt: new Date().toISOString(),
    latencyMs: null,
    traceability: { checked: 0, unmatched: [] },
    // Repairs are normally empty here. The one case that fills them is a
    // guard-rejected model reply: the computed text replaced it, and the path
    // taken (rejected, retried with the fallback, still rejected) is stated
    // rather than left to the reader to infer.
    adjustments: options.adjustments ?? [],
    reason: options.reason ?? null,
    contextVersion: context.contextVersion,
    contextTokens: estimateContextTokens(context),
    asOf: context.asOf,
    coversDay: schedule.coversDay,
    scheduledHour: schedule.hour,
  };
}

// ── Generation ──────────────────────────────────────────

function payloadFromModel(
  text: BriefingModelTextLike,
  engine: BriefingEngine,
  context: BriefingContext,
  schedule: BriefingSchedule
): BriefingPayload {
  const model = text.model ?? engine.model;
  return {
    kind: 'model',
    headline: text.headline,
    body: text.body,
    recommendations: text.recommendations,
    attribution: modelAttribution(model),
    model,
    provider: text.provider ?? engine.label,
    destination: text.destination ?? engine.destination,
    engine: text.engineKind ?? engine.kind,
    engineDetail: text.engineDetail ?? engine.detail,
    generatedAt: new Date().toISOString(),
    latencyMs: text.latencyMs,
    traceability: text.traceability,
    adjustments: text.adjustments,
    reason: null,
    contextVersion: context.contextVersion,
    contextTokens: estimateContextTokens(context),
    asOf: context.asOf,
    coversDay: schedule.coversDay,
    scheduledHour: schedule.hour,
  };
}

/**
 * Run one generation for a day. Throws on any failure — the cache keeps whatever
 * it already held, so a failed attempt can never blank the hero.
 */
async function generateFor(
  key: string,
  context: BriefingContext,
  deps: BriefingDeps,
  schedule: BriefingSchedule
): Promise<BriefingPayload> {
  const engine = await resolveBriefingEngine(deps as EngineDeps);
  try {
    const text = deps.generate
      ? await deps.generate(context, engine)
      : await generateBriefingText(context, deps as EngineDeps, engine);
    state.failures.delete(key);
    return payloadFromModel(text, engine, context, schedule);
  } catch (error) {
    const reason = error instanceof BriefingEngineError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'The briefing model could not be reached.';
    state.failures.set(key, { at: Date.now(), reason });
    throw error;
  }
}

/** Start today's generation unless one is running or a recent failure is in cooldown. */
function startGeneration(
  key: string,
  context: BriefingContext,
  deps: BriefingDeps,
  schedule: BriefingSchedule
): void {
  if (state.inFlight.has(key)) return;
  const last = state.failures.get(key);
  if (last && Date.now() - last.at < BRIEFING_FAILURE_COOLDOWN_MS) return;
  prefetch(key, () => generateFor(key, context, deps, schedule));
}

// ── Resolution helpers ──────────────────────────────────

interface Resolved {
  system: UnitSystem;
  profile: VitalProfile;
  schedule: BriefingSchedule;
  key: string;
  context: BriefingContext;
}

function resolve(deps: BriefingDeps): Resolved {
  const now = deps.now ? deps.now() : new Date();
  // The stored profile is read ONCE per request by the caller and injected (it
  // may live in Postgres, and this path is deliberately synchronous so the hero
  // is never blocked on I/O). A caller that omits it gets the documented
  // defaults — never a second, possibly stale, read from another source.
  const profile = deps.profile ?? defaultProfile();
  const system: UnitSystem = deps.system === 'imperial' ? 'imperial' : 'metric';
  const schedule = briefingSchedule(profile, now);
  return {
    system,
    profile,
    schedule,
    key: briefingCacheKey(schedule, system, profile),
    context: buildBriefingContext(system, { profile }),
  };
}

// ── Read path ───────────────────────────────────────────

/**
 * Read the briefing that is current right now. Synchronous by design: the hero
 * is never blocked on a model call, and every path returns a complete,
 * attributed payload.
 */
export function readBriefing(deps: BriefingDeps = {}): BriefingView {
  const { schedule, key, context } = resolve(deps);

  const cached = peekPayload(key);
  if (cached) {
    state.hits += 1;
    return { ...cached, pending: state.inFlight.size > 0, cached: true };
  }
  state.misses += 1;

  // Before the hour there is nothing to write: the previous day's briefing is
  // what stays on screen, and if the process has none it says so honestly.
  if (schedule.allowed) startGeneration(key, context, deps, schedule);
  const failure = lastBriefingFailure(key);
  return {
    ...computedBriefing(context, schedule, { reason: failure?.reason ?? null }),
    pending: state.inFlight.size > 0,
    cached: false,
  };
}

// ── Manual regeneration ─────────────────────────────────

/**
 * Write the current day's briefing again, once, and return it.
 *
 * The one explicit control: it drops the day's entry (and any recorded failure)
 * and generates a replacement, so a failed or unwanted day is not stuck until
 * tomorrow. It is a single awaited generation — never a loop.
 */
export async function regenerateBriefing(deps: BriefingDeps = {}): Promise<BriefingView> {
  const { schedule, key, context } = resolve(deps);
  state.entries.delete(key);
  state.failures.delete(key);
  const payload = await startLoad(key, () => generateFor(key, context, deps, schedule));
  return { ...payload, pending: state.inFlight.size > 0, cached: false };
}

// ── Warm-up ─────────────────────────────────────────────

export type BriefingWarmOutcome =
  | { ok: true; model: string | null; engine: BriefingEngineKind; latencyMs: number | null }
  | { ok: false; reason: string };

/**
 * Fill today's briefing cache once, at process start.
 *
 * It primes ONLY when the profile's briefing hour has already passed today and
 * the day is not yet cached; otherwise it does nothing at all and says why. The
 * caller may ignore the promise: this is a read-only cache fill like the live
 * dataset warm-up, with no timer and no schedule. A failure is returned as an
 * outcome, never thrown.
 */
export async function warmBriefing(deps: BriefingDeps = {}): Promise<BriefingWarmOutcome> {
  const { schedule, key, context } = resolve(deps);

  if (!schedule.allowed) {
    return {
      ok: false,
      reason: `It is ${String(schedule.hourNow).padStart(2, '0')}:00 local, before the briefing hour (${String(
        schedule.hour
      ).padStart(2, '0')}:00). Today's briefing is not written yet; yesterday's stays on screen.`,
    };
  }

  const existing = peekPayload(key);
  if (existing) {
    return { ok: true, model: existing.model, engine: existing.engine ?? 'none', latencyMs: existing.latencyMs };
  }

  const engine = await resolveBriefingEngine(deps as EngineDeps);
  if (engine.kind === 'none' && !deps.generate) {
    return { ok: false, reason: engine.detail };
  }
  try {
    const payload = await startLoad(key, () => generateFor(key, context, deps, schedule));
    return { ok: true, model: payload.model, engine: payload.engine ?? engine.kind, latencyMs: payload.latencyMs };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The briefing warm-up failed.' };
  }
}

/** Resolve (without generating) which engine would write the briefing. */
export async function describeBriefingEngine(deps: BriefingDeps = {}): Promise<BriefingEngine> {
  return resolveBriefingEngine(deps as EngineDeps);
}

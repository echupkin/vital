// ── Workout sources: shared vocabulary ──────────────────
//
// Apple Health (through Health Auto Export) records a workout as a type, a
// duration and some calories. It never records what was actually done — which
// exercises, how many sets, the reps, the load or how hard it felt. A *workout
// source* is a plugin that fills that gap by reading a training app's own API.
//
// Every plugin normalizes into the same small model below, so nothing past
// `src/lib/workout-sources/<plugin>/` knows which app a session came from. The
// routine engine (src/lib/routine) and the analyst only ever see
// `TrainingSession`.
//
// Like the HAE dataset, sessions live in the server process only. They are health
// data, so they are never written to Postgres (see db/migrations/0001-init.sql).
//
// This module imports types only, so browser code may use it.

import type { PoolLike } from '../db/pool';

export type TrainingSetKind = 'normal' | 'warmup' | 'dropset' | 'failure';

export interface TrainingSet {
  index: number;
  kind: TrainingSetKind;
  reps?: number;
  /** Load in kilograms. For an assisted exercise this is the assistance, see `TrainingExercise.loadMeaning`. */
  weightKg?: number;
  durationS?: number;
  distanceM?: number;
  /** Rating of perceived exertion, 6–10. */
  rpe?: number;
}

/**
 * What a set's `weightKg` means for this exercise.
 *
 *   added       external load (barbell, dumbbell, weighted vest)
 *   assistance  load that *helps* (band or machine assisted pull-up) — less is harder
 *   none        bodyweight, timed or distance work with no load
 */
export type LoadMeaning = 'added' | 'assistance' | 'none';

export interface TrainingExercise {
  /** The source's own exercise id (a Hevy exercise template id), when it has one. */
  sourceTemplateId: string | null;
  name: string;
  loadMeaning: LoadMeaning;
  primaryMuscle?: string;
  secondaryMuscles?: string[];
  notes?: string;
  sets: TrainingSet[];
}

export interface TrainingSession {
  /** Unique across sources: `<sourceId>:<source's id>`. */
  id: string;
  sourceId: string;
  title: string;
  startTime: string;
  endTime: string;
  notes?: string;
  exercises: TrainingExercise[];
}

/** An exercise the source knows about (for the analyst's exercise search). */
export interface ExerciseTemplateInfo {
  sourceId: string;
  id: string;
  name: string;
  loadMeaning: LoadMeaning;
  kind: string;
  primaryMuscle?: string;
  secondaryMuscles?: string[];
  equipment?: string;
  custom: boolean;
}

// ── Plugin contract ─────────────────────────────────────

export interface SourceRequestDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Sync every source now instead of serving the cached sync ("Check again"). */
  refresh?: boolean;
  /** Tests pass a no-op so rate-limit backoff does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Replaces the process Postgres pool when reading a stored connection (tests). `null` means no database. */
  hevyClient?: PoolLike | null;
  /** Replaces the stored connection itself (tests). `null` means none is stored. */
  hevyStored?: ({ state: 'ok'; apiKey: string; url: string } | { state: 'none' | 'needs_reentry' }) | null;
}

/** Where a plugin left off, so the next sync can be incremental. */
export interface SourceSyncState {
  /** Sessions currently held, keyed by `TrainingSession.id`. */
  sessions: Record<string, TrainingSession>;
  /** Instant the last successful sync started (the next `since`). */
  syncedAt: string | null;
  /** Oldest start time the backfill covered. */
  coveredFrom: string | null;
  /** The source's exercise catalogue, keyed by template id, when it has one. */
  templates?: Record<string, ExerciseTemplateInfo>;
}

export interface SourceSyncResult {
  state: SourceSyncState;
  mode: 'full' | 'incremental';
  /** Upstream items read (sessions or events). */
  read: number;
}

export interface SourceProbeResult {
  ok: boolean;
  durationMs: number;
  detail: string;
  httpStatus: number | null;
}

export interface WorkoutSourcePlugin<C = unknown> {
  id: string;
  displayName: string;
  /**
   * Resolve the plugin's configuration: the connection stored in Postgres, plus
   * admin tuning from the environment.
   *
   * Returns null when the plugin is not connected. Never throws and never puts a
   * credential anywhere but the returned object.
   */
  readConfig(deps: SourceRequestDeps): Promise<C | null>;
  /** Display-safe host of the configured API (never a key). */
  host(config: C): string | null;
  /** Cache lifetime for this source, in ms. */
  ttlMs(config: C): number;
  /** A bounded, read-only request that proves the credentials work. */
  probe(config: C, deps: SourceRequestDeps): Promise<SourceProbeResult>;
  /**
   * Bring `previous` up to date. A null or empty state means a full backfill of
   * `lookbackDays`; otherwise the plugin may sync incrementally.
   */
  sync(config: C, previous: SourceSyncState | null, lookbackDays: number, deps: SourceRequestDeps): Promise<SourceSyncResult>;
  listExerciseTemplates?(config: C, deps: SourceRequestDeps): Promise<ExerciseTemplateInfo[]>;
}

/** Status of one source, for the pipeline panel and the routine page. */
export interface WorkoutSourceStatus {
  id: string;
  displayName: string;
  configured: boolean;
  host: string | null;
  /** 'demo' when the committed training fixtures are being served instead. */
  origin: 'live' | 'demo' | 'none';
  sessions: number;
  lastSyncAt: string | null;
  newestSessionAt: string | null;
  lastError: string | null;
}

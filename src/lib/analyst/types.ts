// ── Analyst service boundary: types (SPEC §8) ───────────
//
// The analyst is a server-side service with a typed provider interface. A
// provider receives a *retrieval bundle* (only the summaries the question needs)
// and returns a structured answer. With no provider configured the demo
// provider computes answers from the shared dataset and is labelled
// "Demo analyst" everywhere it appears.

import type { UnitSystem } from '../prefs';
import type { ComparisonResult } from '../analytics/stats';
import type { DayWindow } from '../analytics/windows';
import type { ResolvedInterval, ResultStatus, StatusTone } from '../lab/status';
import type { PanelSpecimen } from '../lab/panel';

// ── Answers ────────────────────────────────────────────

export interface AnalystEvidence {
  metricId: string;
  metricName: string;
  /** The exact date window the figure was computed over. */
  windowLabel: string;
  /** How the value was aggregated. */
  aggregation: string;
  /** Sample count or coverage. */
  sampleCount: string;
  /** Route that opens the underlying chart or records. */
  href: string;
}

export interface AnalystChart {
  metricId: string;
  caption: string;
  points: { key: string; value: number }[];
}

export interface AnalystAnswer {
  id: string;
  title: string;
  /**
   * The three required sections, always present and always in this order:
   * what was measured, what it may mean, and what is uncertain or missing.
   */
  observed: string[];
  interpretation: string[];
  uncertainty: string[];
  evidence: AnalystEvidence[];
  charts: AnalystChart[];
  followUps: string[];
  /** Concise educational-information notice. */
  boundaryNote: string;
}

// ── Retrieval ──────────────────────────────────────────

export interface RetrievedSummary {
  metricId: string;
  metricName: string;
  aggregation: string;
  accumulating: boolean;
  window: DayWindow;
  baselineWindow: DayWindow;
  lengthLabel: string;
  exclusionNote: string | null;
  comparison: ComparisonResult;
  counts: { evaluated: number; baseline: number };
  coverage: string;
  /** Bounded series: never the whole record set. */
  points: { key: string; value: number }[];
  /** True when the series was cut at MAX_POINTS_PER_SERIES. */
  truncated: boolean;
  aggregate: { mean: number; median: number; min: number; max: number; stddev: number };
}

export interface RetrievedPairGroup {
  label: string;
  /** Paired days in this group. */
  days: number;
  xMean: number;
  yMean: number;
}

export interface RetrievedPair {
  xMetricId: string;
  yMetricId: string;
  alignment: 'same-day' | 'lagged';
  lagDays: number;
  coefficient: number | null;
  pairedCount: number;
  xCount: number;
  yCount: number;
  valid: boolean;
  reason: string | null;
  window: DayWindow;
  /** Optional split of the paired days by the median of X. */
  split: { medianX: number; low: RetrievedPairGroup; high: RetrievedPairGroup } | null;
}

export interface RetrievedWorkouts {
  window: DayWindow;
  sessions: number;
  sessionsPerWeek: number;
  minutes: number;
  calories: number;
  byType: { type: string; count: number; minutes: number }[];
  /** Sessions in the final 30 days and the 30 before that. */
  recent: number;
  prior: number;
}

export interface RetrievalBundle {
  handlerId: string;
  refKey: string;
  /** Only the summaries this question needs. */
  summaries: RetrievedSummary[];
  pairs: RetrievedPair[];
  workouts: RetrievedWorkouts | null;
  /**
   * The bounded lab snapshot (see labSnapshot.ts). Present on every analyst
   * context — the owner's lab observations were invisible to the model before
   * this gate — and `null`/`available: false` when there is no lab data or no
   * database, which the block states rather than omitting silently.
   *
   * Optional so a bundle assembled by hand (a test double, an older caller)
   * stays valid; nothing here is ever read by a handler that does not check it.
   */
  lab?: LabContextSnapshot | null;
  /** How many records were read out of the dataset for this question. */
  recordsRead: number;
  /** Human sentence describing what was selected. */
  note: string;
}

// ── Lab context ────────────────────────────────────────

/**
 * One lab observation as the context block states it. Every figure carries its
 * unit and its own observation date; nothing is derived except the interval and
 * the verdict, which come from the same status engine the Lab page renders.
 */
export interface LabSnapshotReading {
  /** ISO date the observation belongs to. */
  on: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  /** The reference cell exactly as the document printed it, or null. */
  printedRefText: string | null;
  /** The interval the value was scored against, as shown (e.g. "<200 mg/dL"). */
  intervalText: string | null;
  /** Where that interval came from, in the words the Lab page uses. */
  intervalBasis: string;
  status: ResultStatus;
  statusLabel: string;
  tone: StatusTone;
  /** Resolved interval, kept for the grounding audit and for callers. */
  interval: ResolvedInterval;
}

/** One lab series (analyte + specimen) as the context block states it. */
export interface LabSnapshotSeries {
  /** The series id the Lab page links with (`<key>` or `<key>~urine`). */
  seriesKey: string;
  /** The series' display name, qualified (blood)/(urine) only where both exist. */
  displayName: string;
  specimen: PanelSpecimen;
  registered: boolean;
  unit: string | null;
  /** Observations stored for this series, before the block's own bound. */
  observations: number;
  /** Observations actually placed in the block (latest/previous or the history). */
  shownPoints: number;
  /** True when the series holds more observations than the block carries. */
  truncated: boolean;
  latest: LabSnapshotReading | null;
  previous: LabSnapshotReading | null;
  /** Bounded history — filled only when the question named this analyte. */
  history: LabSnapshotReading[];
  /** The strings the model is told to quote verbatim, and the audit accepts. */
  display: Record<string, string>;
}

/**
 * The bounded lab block. It states its own totals and its own bound, so the
 * model can be honest about coverage: which series are shown, how many exist,
 * how many documents and observations were read.
 */
export interface LabContextSnapshot {
  available: boolean;
  /** Why no lab data is in the context. Null when available. */
  reason: string | null;
  documents: number;
  totalObservations: number;
  totalSeries: number;
  collisions: number;
  selection: 'overview' | 'analyte';
  /** The analyte key the question named, when it named one. */
  requestedAnalyte: string | null;
  /** The analyte name the question used, as displayed. */
  requestedName: string | null;
  /** True when a named analyte exists in the data; false means "say it is absent". */
  found: boolean;
  /** How many series the block actually carries, out of `totalSeries`. */
  shownSeries: number;
  /** The block's stated bound, in words. Never silent truncation. */
  note: string;
  series: LabSnapshotSeries[];
}

// ── Requests and responses ─────────────────────────────

export interface AnalystRequest {
  query: string;
  /** Imported user content. Treated as untrusted data, never as instructions. */
  notes?: string;
  system?: UnitSystem;
  /**
   * The conversation's earlier turns, oldest first. Bounded by
   * `boundedHistory` before it is used (see memory.ts): at most
   * MAX_MEMORY_TURNS turns and MAX_MEMORY_CHARS characters, oldest dropped
   * first. A new conversation passes none.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export type AnalystStatus =
  | 'ok'
  | 'unsupported'
  | 'misconfigured'
  | 'error';

export interface AnalystProviderContext {
  refKey: string;
  system: UnitSystem;
  bundle: RetrievalBundle;
  /** The user's actual question, sent to the model. */
  question: string;
  /** The resolved system prompt (built-in or configured). */
  prompt: string;
  /** Imported notes, already sanitized: untrusted data, never instructions. */
  notes?: string;
  /**
   * Already-bounded earlier turns of this conversation (memory.ts), oldest
   * first. Empty for a new conversation. Carried as untrusted DATA too.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

/**
 * What a provider hands back.
 *
 * The demo provider computes a finished answer. A model provider hands back the
 * model's *text* only: parsing, validation, evidence filtering and the grounding
 * check all happen in the service, so a provider can never smuggle an
 * unvalidated claim into a response by returning a shaped object.
 */
export type AnalystProviderResult =
  | { kind: 'answer'; answer: AnalystAnswer }
  | { kind: 'text'; text: string; model: string | null };

export interface AnalystProvider {
  readonly id: 'demo' | 'openai' | 'anthropic';
  /** Human label, e.g. "OpenAI-compatible". Never a key. */
  readonly label: string;
  readonly configured: boolean;
  /** Categories of data the provider receives. Empty for demo. */
  readonly sendingCategories: string[];
  answer(context: AnalystProviderContext): Promise<AnalystProviderResult | null>;
}

/** Numeric-claim audit of an answer against the retrieval bundle. */
export interface AnalystGrounding {
  /** How many numeric tokens were examined in observed + interpretation. */
  checked: number;
  /** Tokens that were not found in the selected context. Never silently dropped. */
  unmatched: string[];
}

export interface AnalystResponse {
  status: AnalystStatus;
  /** 'Demo analyst' whenever no provider is configured. */
  label: string;
  provider: 'demo' | 'openai' | 'anthropic';
  providerLabel: string;
  /** Display name of the provider, e.g. "OpenAI-compatible". Never a key. */
  providerDisplayName: string;
  /** Model id used, or null for the demo provider. */
  model: string | null;
  providerConfigured: boolean;
  /** 'built-in' when the analyst is using its own prompt, 'custom' when configured. */
  systemPromptSource: 'built-in' | 'custom';
  /** Why the configured provider cannot be used, or null when it can. */
  misconfiguredReason: string | null;
  handlerId: string;
  answer: AnalystAnswer | null;
  /** Explanation shown when there is no answer. */
  message: string | null;
  /** Prompts the analyst can answer with the demo handlers. */
  suggested: string[];
  notice: string;
  retrieval: {
    recordsRead: number;
    note: string;
    metrics: { metricId: string; window: string; observations: number }[];
  };
  /** Audit of the numeric claims in the answer against the selected context. */
  grounding: AnalystGrounding;
  /** Untrusted notes received with the request (echoed, never obeyed). */
  untrustedNotes: { received: boolean; characters: number; note: string };
}

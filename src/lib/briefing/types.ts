// ── Today's briefing: shared types ───────────────────────
//
// The browser needs the *shape* of a briefing (the hero renders it) without ever
// importing the module that builds one: that module reads provider configuration
// and holds the credentials path. Keeping the shape here — a file with no
// imports beyond nothing at all — is what lets `useBriefing` do
// `import type { BriefingView } from '@/lib/briefing/types'` and pull in
// nothing else.

/**
 * Which stack wrote (or would write) the briefing.
 *
 * `fallback` is the hosted provider a rejected primary reply is re-asked from
 * once (VITAL_LLM_FALLBACK_*). It is reported in the payload so a briefing that
 * exists only because the local model's reply failed the number guard is not
 * attributed to the local model.
 */
export type BriefingEngineKind = 'local' | 'analyst' | 'fallback' | 'none';

/** Numeric audit of generated text against the context it was written from. */
export interface BriefingTraceability {
  /** How many numeric tokens were examined across all three fields. */
  checked: number;
  /** Tokens that could not be traced to the context. Never silently dropped. */
  unmatched: string[];
}

export interface BriefingPayload {
  kind: 'model' | 'computed';
  headline: string;
  body: string;
  recommendations: string[];
  /**
   * Mandatory line stating who wrote this text:
   * `Written by <model>` or `Computed from your data — analyst model offline`.
   */
  attribution: string;
  model: string | null;
  /** Display label of the provider, e.g. "OpenAI-compatible". Never a key. */
  provider: string | null;
  /** Host only, never a URL that carried a credential. */
  destination: string | null;
  engine: BriefingEngineKind | null;
  /** Why that engine was chosen, or why there is none. Safe to display. */
  engineDetail: string | null;
  /** When this text was produced. */
  generatedAt: string;
  latencyMs: number | null;
  traceability: BriefingTraceability;
  /** Repairs applied to the model's reply, stated rather than silent. */
  adjustments: string[];
  /** Why the briefing is computed rather than written, when it is. */
  reason: string | null;
  contextVersion: number;
  contextTokens: number;
  /** Newest observation instant in the dataset the briefing describes. */
  asOf: string;
  /**
   * The local calendar day (profile timezone) this briefing is FOR — the day it
   * is labelled with. Before the profile's briefing hour this is the previous
   * day's key: today's briefing has not been written yet, and the previous
   * day's is what stays on screen.
   */
  coversDay: string;
  /** The profile hour at/after which a briefing for the current day is written. */
  scheduledHour: number;
}

export interface BriefingView extends BriefingPayload {
  /** A generation is running right now; asking again shortly may return it. */
  pending: boolean;
  /** This payload came from the cache rather than being built for this read. */
  cached: boolean;
}

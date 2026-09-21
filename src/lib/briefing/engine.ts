// ── Today's briefing: model engine (server-only) ─────────
//
// Which model, if any, writes the briefing. The precedence is the owner's, and
// it is resolved *per generation*, not per view:
//
//   1. VITAL_LLM_BASE_URL — a model server on this machine (LM Studio, llama.cpp,
//      vLLM, Ollama). It is probed with a short, bounded GET /models; when it
//      answers, its first advertised model id is used when VITAL_LLM_MODEL=auto.
//      A loopback endpoint needs no credential, and none is sent if none is set.
//   2. ANALYST_* — the same provider the analyst answers with, reusing
//      `readAnalystConfig` / `createProvider` rather than a second implementation.
//   3. Nothing usable — the caller renders the computed briefing and says so.
//
// The HTTP call itself is the analyst's shared `complete(system, user)` path
// (src/lib/analyst/provider.ts): JSON mode, the hard timeout, the rate-limit
// retry and the error scrubbing are literally the same code the analyst uses, so
// the two cannot drift.
//
// Nothing here logs or returns a credential. A failure is a thrown error with a
// message that is already safe to show.

import {
  REMOTE_SENDING_CATEGORIES,
  normalizeEndpoint,
  readAnalystConfig,
  type AnalystConfig,
} from '../analyst/config';
import { createProvider, supportsCompletion } from '../analyst/provider';
import type { BriefingContext } from './context';
import { BRIEFING_SYSTEM_PROMPT, buildBriefingUserMessage } from './prompt';
import type { BriefingEngineKind, BriefingTraceability } from './types';
import { parseBriefingReply } from './validate';

export type { BriefingEngineKind };

/** Bounded probe for the local seam. The owner asked for roughly two seconds. */
export const LOCAL_PROBE_TIMEOUT_MS = 2000;
export const DEFAULT_BRIEFING_TIMEOUT_MS = 60_000;
/**
 * Output budget for one briefing.
 *
 * Deliberately generous: a reasoning model spends `max_tokens` on its reasoning
 * *and* its reply, and the reply itself is only ~200 tokens. At 1200 the budget
 * was consumed by reasoning alone and the JSON arrived cut off mid-sentence —
 * which is a truncation, not a bad answer. 4000 leaves room for ~1000 reasoning
 * tokens plus the full briefing, and the provider still reports a hard stop at
 * the limit if it is ever reached.
 */
export const DEFAULT_BRIEFING_MAX_TOKENS = 4000;
export const DEFAULT_BRIEFING_TEMPERATURE = 0.3;
/**
 * How the briefing recovers from a reply the number guard rejects.
 *
 * The primary engine gets exactly one attempt. If its reply is received but
 * fails the guard, the configured fallback provider (VITAL_LLM_FALLBACK_*) gets
 * exactly one attempt, and if that also fails — or no fallback is configured —
 * the computed briefing is served instead. There is never a second roll at the
 * same provider: an attributed figure the guard refused must not be re-rolled
 * until it passes, and a transport/timeout failure still throws as before.
 */
export const BRIEFING_FALLBACK_ATTEMPTS = 1;

export interface BriefingEngine {
  kind: BriefingEngineKind;
  /** Human label shown next to the attribution. Never a key, never a full URL. */
  label: string;
  model: string | null;
  /** Host only. */
  destination: string | null;
  /** Why this engine was chosen, or why there is none. Safe to display. */
  detail: string;
  config: AnalystConfig | null;
}

/** Raised when a briefing could not be written. The message is safe to show. */
export class BriefingEngineError extends Error {
  constructor(message: string, readonly traceability: BriefingTraceability | null = null) {
    super(message);
    this.name = 'BriefingEngineError';
  }
}

export interface EngineDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

// ── Local seam ──────────────────────────────────────────

interface LocalProbe {
  ok: boolean;
  models: string[];
  detail: string;
}

function numberOr(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

/**
 * Ask the local model server for its model list, with a hard, short timeout.
 *
 * A probe that hangs would delay the fallback to ANALYST_*, so it is bounded at
 * LOCAL_PROBE_TIMEOUT_MS and any failure (refused, timed out, not JSON, no
 * models) is reported as unreachable rather than thrown.
 */
export async function probeLocalModelServer(baseUrl: string, deps: EngineDeps = {}): Promise<LocalProbe> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return { ok: false, models: [], detail: 'VITAL_LLM_BASE_URL is empty.' };

  const endpoint = normalizeEndpoint(trimmed, 'openai');
  if (!endpoint.url) {
    return { ok: false, models: [], detail: endpoint.reason ?? 'VITAL_LLM_BASE_URL is not a usable URL.' };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, models: [], detail: 'No fetch implementation is available in this runtime.' };
  }

  // The models list lives next to the chat endpoint: http://host:1234/v1/models
  const url = new URL(endpoint.url);
  url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);
  try {
    const apiKey = (deps.env ?? process.env).VITAL_LLM_API_KEY?.trim();
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, models: [], detail: `The local model server at ${url.host} answered HTTP ${response.status}.` };
    }
    const payload = (await response.json()) as { data?: unknown };
    const models = Array.isArray(payload?.data)
      ? payload.data
          .map(entry => (entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined))
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    if (models.length === 0) {
      return { ok: false, models: [], detail: `The local model server at ${url.host} advertised no model.` };
    }
    return { ok: true, models, detail: `The local model server at ${url.host} advertised ${models.length} model(s).` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      models: [],
      detail: aborted
        ? `The local model server did not answer within ${LOCAL_PROBE_TIMEOUT_MS} ms.`
        : 'The local model server could not be reached.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Configuration for a local OpenAI-compatible server, with the transient fields filled in. */
function localConfig(env: NodeJS.ProcessEnv, baseUrl: string, model: string): AnalystConfig | null {
  const endpoint = normalizeEndpoint(baseUrl, 'openai');
  if (!endpoint.url) return null;
  const apiKey = env.VITAL_LLM_API_KEY?.trim() || null;
  return {
    provider: 'openai',
    providerDisplayName: 'Local model',
    model,
    endpoint: endpoint.url,
    endpointHost: endpoint.host,
    endpointLoopback: endpoint.loopback,
    apiKey,
    hasKey: Boolean(apiKey),
    // The briefing never uses the analyst's prompt file: `complete()` is given the
    // briefing system prompt explicitly. These fields exist because the provider
    // is constructed from an AnalystConfig.
    systemPrompt: BRIEFING_SYSTEM_PROMPT,
    systemPromptSource: 'built-in',
    systemPromptFile: null,
    systemPromptWarning: null,
    maxTokens: numberOr(env, 'BRIEFING_MAX_TOKENS', DEFAULT_BRIEFING_MAX_TOKENS, 1, 200_000),
    temperature: numberOr(env, 'BRIEFING_TEMPERATURE', DEFAULT_BRIEFING_TEMPERATURE, 0, 2),
    timeoutMs: numberOr(env, 'BRIEFING_TIMEOUT_MS', DEFAULT_BRIEFING_TIMEOUT_MS, 100, 600_000),
    jsonMode: 'auto',
    sendingCategories: REMOTE_SENDING_CATEGORIES,
    misconfiguredReason: null,
  };
}

/**
 * Resolve the engine that should write the briefing.
 *
 * `VITAL_LLM_BASE_URL` is tried first and only wins when the probe succeeds:
 * a configured-but-down local server must fall through to ANALYST_*, not fail
 * the briefing.
 */
export async function resolveBriefingEngine(deps: EngineDeps = {}): Promise<BriefingEngine> {
  const env = deps.env ?? process.env;
  const localUrl = env.VITAL_LLM_BASE_URL?.trim();
  let localDetail = 'VITAL_LLM_BASE_URL is not set, so the local model seam was not probed.';

  if (localUrl) {
    const probe = await probeLocalModelServer(localUrl, deps);
    localDetail = probe.detail;
    if (probe.ok) {
      const configured = env.VITAL_LLM_MODEL?.trim();
      const wantsAuto = !configured || configured.toLowerCase() === 'auto';
      const model = wantsAuto ? probe.models[0] : configured;
      const config = model ? localConfig(env, localUrl, model) : null;
      if (config) {
        return {
          kind: 'local',
          label: 'local model',
          model,
          destination: config.endpointHost,
          detail: wantsAuto
            ? `${probe.detail} VITAL_LLM_MODEL=auto resolved to "${model}".`
            : `${probe.detail} Using the configured model "${model}".`,
          config,
        };
      }
      localDetail = `${probe.detail} Its endpoint could not be turned into a request URL.`;
    }
  }

  const analyst = readAnalystConfig(env);
  if (analyst.provider !== 'demo' && !analyst.misconfiguredReason) {
    return {
      kind: 'analyst',
      label: analyst.providerDisplayName,
      model: analyst.model,
      destination: analyst.endpointHost,
      detail: `${localDetail} Falling back to the configured analyst provider (${analyst.providerDisplayName}).`,
      config: {
        ...analyst,
        // The analyst's own budget is sized for an answer with several sections;
        // the briefing takes the briefing budget instead, because a reasoning
        // model spends max_tokens on its reasoning before it writes anything and
        // ANALYST_MAX_TOKENS=1200 truncates the reply mid-JSON.
        maxTokens: numberOr(env, 'BRIEFING_MAX_TOKENS', DEFAULT_BRIEFING_MAX_TOKENS, 1, 200_000),
        // The briefing runs in the background, so it also takes the shorter of
        // the two timeouts rather than holding a refresh open for a minute.
        timeoutMs: Math.min(
          analyst.timeoutMs,
          numberOr(env, 'BRIEFING_TIMEOUT_MS', DEFAULT_BRIEFING_TIMEOUT_MS, 100, 600_000)
        ),
      },
    };
  }

  return {
    kind: 'none',
    label: 'analyst model offline',
    model: null,
    destination: null,
    detail: analyst.misconfiguredReason
      ? `${localDetail} ${analyst.misconfiguredReason}`
      : `${localDetail} No analyst provider is configured either, so no model is available.`,
    config: null,
  };
}

// ── Fallback provider ───────────────────────────────────

/**
 * Resolve the configured fallback provider — the stronger hosted model in
 * `.env` (VITAL_LLM_FALLBACK_*) that a guard-rejected reply is re-asked from.
 *
 * It is deliberately separate from `resolveBriefingEngine`: it is never the
 * preferred engine, and it is only constructed when the primary reply has been
 * rejected. No probe is made (a probe would delay the recovery); an
 * unconfigured or unusable fallback is reported as such and the caller serves
 * the computed briefing. `kind: 'none'` means "no fallback available".
 */
export function resolveBriefingFallback(deps: EngineDeps = {}): BriefingEngine {
  const env = deps.env ?? process.env;
  const baseUrl = env.VITAL_LLM_FALLBACK_BASE_URL?.trim();
  const model = env.VITAL_LLM_FALLBACK_MODEL?.trim();
  const apiKey = env.VITAL_LLM_FALLBACK_API_KEY?.trim() || null;

  const unavailable = (detail: string): BriefingEngine => ({
    kind: 'none',
    label: 'no fallback provider',
    model: model ?? null,
    destination: null,
    detail,
    config: null,
  });

  if (!baseUrl) return unavailable('VITAL_LLM_FALLBACK_BASE_URL is not set, so there is no fallback provider.');
  if (!model) return unavailable('VITAL_LLM_FALLBACK_MODEL is not set, so there is no usable fallback provider.');

  const endpoint = normalizeEndpoint(baseUrl, 'openai');
  if (!endpoint.url) {
    return unavailable(endpoint.reason ?? 'VITAL_LLM_FALLBACK_BASE_URL is not a usable URL.');
  }
  if (!endpoint.loopback && !apiKey) {
    return unavailable('VITAL_LLM_FALLBACK_API_KEY is required because the fallback endpoint is not a loopback host.');
  }

  return {
    kind: 'fallback',
    label: 'fallback model',
    model,
    destination: endpoint.host,
    detail: `The fallback provider (${endpoint.host}) is available for a rejected reply.`,
    config: {
      provider: 'openai',
      providerDisplayName: 'Fallback model',
      model,
      endpoint: endpoint.url,
      endpointHost: endpoint.host,
      endpointLoopback: endpoint.loopback,
      apiKey,
      hasKey: Boolean(apiKey),
      systemPrompt: BRIEFING_SYSTEM_PROMPT,
      systemPromptSource: 'built-in',
      systemPromptFile: null,
      systemPromptWarning: null,
      maxTokens: numberOr(env, 'BRIEFING_MAX_TOKENS', DEFAULT_BRIEFING_MAX_TOKENS, 1, 200_000),
      temperature: numberOr(env, 'BRIEFING_TEMPERATURE', DEFAULT_BRIEFING_TEMPERATURE, 0, 2),
      timeoutMs: numberOr(env, 'BRIEFING_TIMEOUT_MS', DEFAULT_BRIEFING_TIMEOUT_MS, 100, 600_000),
      jsonMode: 'auto',
      sendingCategories: REMOTE_SENDING_CATEGORIES,
      misconfiguredReason: null,
    },
  };
}

// ── Generation ──────────────────────────────────────────

export interface BriefingModelText {
  headline: string;
  body: string;
  recommendations: string[];
  /** Model id the provider reported, or the configured one. */
  model: string | null;
  latencyMs: number;
  traceability: BriefingTraceability;
  adjustments: string[];
  /** Set only when the fallback provider wrote the text, so the payload says who did. */
  engineKind?: BriefingEngineKind;
  engineDetail?: string;
  provider?: string | null;
  destination?: string | null;
}

interface Completion {
  text: string;
  model: string | null;
  latencyMs: number;
}

/** Build a provider from an engine and take exactly one completion from it. */
async function completeWith(engine: BriefingEngine, system: string, user: string): Promise<Completion> {
  if (!engine.config) throw new BriefingEngineError(engine.detail);

  let provider;
  try {
    provider = createProvider(engine.config);
  } catch (error) {
    throw new BriefingEngineError(
      error instanceof Error ? error.message : 'The briefing provider could not be created.'
    );
  }
  if (!supportsCompletion(provider)) {
    throw new BriefingEngineError('The configured provider cannot be prompted for a briefing.');
  }

  const started = Date.now();
  const completion = await provider.complete(system, user);
  return { text: completion.text, model: completion.model ?? engine.model, latencyMs: Date.now() - started };
}

/**
 * Ask the resolved engine to write the briefing, then validate its text.
 *
 * One primary attempt. If the reply is received but the number guard rejects it
 * — an unreadable reply, forbidden vocabulary, a fabricated figure, or (the
 * case this exists for) a figure the context records under a different metric —
 * the configured fallback provider is asked once. If that reply also fails, or
 * no fallback is configured, this throws `BriefingEngineError` so the caller
 * renders the computed briefing and states why. A transport or timeout failure
 * on the primary is not retried: it throws, as before.
 */
export async function generateBriefingText(
  context: BriefingContext,
  deps: EngineDeps = {},
  engine?: BriefingEngine
): Promise<BriefingModelText> {
  const resolved = engine ?? (await resolveBriefingEngine(deps));
  if (resolved.kind === 'none' || !resolved.config) {
    throw new BriefingEngineError(resolved.detail);
  }

  const system = BRIEFING_SYSTEM_PROMPT;
  const user = buildBriefingUserMessage({ context });

  const primary = await completeWith(resolved, system, user);
  const first = parseBriefingReply(primary.text, context);
  if (first.ok && first.text) {
    return {
      headline: first.text.headline,
      body: first.text.body,
      recommendations: first.text.recommendations,
      model: primary.model,
      latencyMs: primary.latencyMs,
      traceability: first.traceability,
      adjustments: first.adjustments,
    };
  }

  // The reply arrived but was rejected. It is not displayed, and it is not
  // re-rolled at the same provider: the fallback gets one attempt.
  const rejection = new BriefingEngineError(
    first.reason ?? "The model's briefing could not be read.",
    first.traceability
  );
  const fallback = resolveBriefingFallback(deps);
  if (fallback.kind !== 'fallback' || !fallback.config) {
    throw new BriefingEngineError(
      `${rejection.message} No fallback provider is available, so the computed briefing is shown instead. ${fallback.detail}`,
      first.traceability
    );
  }

  let secondary: Completion;
  try {
    secondary = await completeWith(fallback, system, user);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The fallback provider could not be reached.';
    throw new BriefingEngineError(
      `${rejection.message} The fallback provider could not be reached, so the computed briefing is shown instead. ${detail}`,
      first.traceability
    );
  }

  const second = parseBriefingReply(secondary.text, context);
  if (second.ok && second.text) {
    const destination = fallback.destination ?? 'fallback';
    return {
      headline: second.text.headline,
      body: second.text.body,
      recommendations: second.text.recommendations,
      model: secondary.model ?? fallback.model,
      latencyMs: primary.latencyMs + secondary.latencyMs,
      traceability: second.traceability,
      adjustments: [
        ...second.adjustments,
        `discarded the ${resolved.label}'s reply — ${rejection.message}`,
        `the fallback provider (${destination}) rewrote it after the number guard rejected the first reply`,
      ],
      engineKind: 'fallback',
      engineDetail: `The ${resolved.label}'s reply was discarded by the number guard; the fallback provider (${destination}) rewrote it.`,
      provider: fallback.label,
      destination: fallback.destination,
    };
  }

  throw new BriefingEngineError(
    `${rejection.message} The fallback provider's reply failed the same check, so the computed briefing is shown instead.`,
    second.traceability
  );
}
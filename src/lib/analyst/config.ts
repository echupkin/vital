// ── Analyst configuration (SPEC §8, §11) ────────────────
//
// The single place where the five configurable things — provider, model,
// endpoint, credential and system prompt — are resolved from the *server*
// environment.
//
// Why it is written this way:
//   * every value is injected. `readAnalystConfig(env)` takes the environment as
//     an argument, so tests never read or mutate the real process env.
//   * nothing here throws. A bad value becomes a stated `misconfiguredReason`
//     that the UI can show, never a crash.
//   * nothing here returns a credential. The key is reduced to `apiKey` (handed
//     straight to fetch()) plus a `hasKey` boolean; the API surface exposes only
//     the boolean.
//   * the system prompt file is re-read when its mtime changes, so editing a
//     mounted prompt takes effect on the next request without a restart.

import { statSync, readFileSync } from 'node:fs';
import { DEFAULT_ANALYST_SYSTEM_PROMPT } from './systemPrompt';

export type AnalystProviderId = 'demo' | 'openai' | 'anthropic';
export type SystemPromptSource = 'built-in' | 'custom';
export type JsonMode = 'auto' | 'off';

/** Provider default request path, appended when the configured URL omits it. */
export const PROVIDER_DEFAULT_PATHS: Record<Exclude<AnalystProviderId, 'demo'>, string> = {
  openai: '/chat/completions',
  anthropic: '/v1/messages',
};

/** Human label shown in the UI. Never contains a key or a model id. */
export const PROVIDER_DISPLAY_NAMES: Record<AnalystProviderId, string> = {
  demo: 'Demo analyst',
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
};

/**
 * Hosts that are considered to stay on this machine. A local model server
 * (LM Studio, llama.cpp, Ollama, vLLM) is reachable over one of these and needs
 * no credential. `host.docker.internal` is included because from inside a
 * container it resolves to the host, not the internet.
 */
export const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  'host.docker.internal',
]);

export const DEFAULT_MAX_TOKENS = 1200;
export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_TIMEOUT_MS = 60000;

/** Categories of health context a remote provider receives. */
export const REMOTE_SENDING_CATEGORIES = [
  'Metric summaries (averages, medians, totals, comparison deltas and observation counts)',
  'Bounded record windows (at most 90 points per metric)',
  'Date windows, coverage statements and the text of your question',
];

export interface AnalystConfig {
  /** Resolved provider id. An unrecognised name resolves to 'demo' but is still reported as misconfigured. */
  provider: AnalystProviderId;
  /** Display label. For an unrecognised provider this is the raw configured name. */
  providerDisplayName: string;
  model: string | null;
  /** Normalized absolute request URL (provider default path appended when missing). */
  endpoint: string | null;
  /** Host only, for display. Never the full URL if it carried credentials. */
  endpointHost: string | null;
  endpointLoopback: boolean;
  /** Server-only credential. Never serialized into a response or a log. */
  apiKey: string | null;
  hasKey: boolean;
  systemPrompt: string;
  systemPromptSource: SystemPromptSource;
  systemPromptFile: string | null;
  /** Set when a configured prompt file could not be read; the built-in prompt is used instead. */
  systemPromptWarning: string | null;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonMode: JsonMode;
  sendingCategories: string[];
  /** Human explanation of why this configuration cannot be used, or null when it is usable. */
  misconfiguredReason: string | null;
}

// ── Endpoint handling ───────────────────────────────────

/** True when a hostname stays on this machine (see LOOPBACK_HOSTS). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export interface NormalizedEndpoint {
  url: string | null;
  host: string | null;
  loopback: boolean;
  reason: string | null;
}

/**
 * Turn ANALYST_API_URL into a request URL.
 *
 * A base URL (`https://openrouter.ai/api/v1`) gets the provider's default path
 * appended; a full endpoint that already ends in that path is used as-is. An
 * unparseable value, or a scheme that is not http(s), yields a reason instead of
 * throwing.
 */
export function normalizeEndpoint(raw: string, provider: Exclude<AnalystProviderId, 'demo'>): NormalizedEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, host: null, loopback: false, reason: 'ANALYST_API_URL is required for a remote provider.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, host: null, loopback: false, reason: 'ANALYST_API_URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, host: null, loopback: false, reason: 'ANALYST_API_URL must use http or https.' };
  }

  const defaultPath = PROVIDER_DEFAULT_PATHS[provider];
  const bare = parsed.pathname.replace(/\/+$/, '');
  const full = bare.endsWith(defaultPath)
    ? bare
    : // Anthropic's default path is /v1/messages; a base URL that already carries
      // /v1 (https://api.anthropic.com/v1) must not become /v1/v1/messages.
      provider === 'anthropic' && bare.endsWith('/v1')
      ? `${bare}/messages`
      : `${bare}${defaultPath}`;
  parsed.pathname = full || defaultPath;
  parsed.search = '';
  parsed.hash = '';

  return {
    url: parsed.toString(),
    host: parsed.host,
    loopback: isLoopbackHost(parsed.hostname),
    reason: null,
  };
}

// ── System prompt resolution ────────────────────────────

interface PromptFileCacheEntry {
  mtimeMs: number;
  size: number;
  text: string;
}

/** Per-path cache so a mounted prompt file is only re-read when it changes. */
const promptFileCache = new Map<string, PromptFileCacheEntry>();

/**
 * Read a prompt file, re-reading it only when its mtime or size changed.
 * Returns an error string instead of throwing when the file cannot be read.
 */
export function readSystemPromptFile(path: string): { text: string | null; error: string | null } {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { text: null, error: `ANALYST_SYSTEM_PROMPT_FILE points at ${path}, which is not a file.` };
    const cached = promptFileCache.get(path);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { text: cached.text, error: null };
    }
    const text = readFileSync(path, 'utf8');
    promptFileCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return { text, error: null };
  } catch {
    // The message deliberately carries the path only: the file may be missing,
    // unreadable or outside the mount, and none of that should crash a request.
    return { text: null, error: `ANALYST_SYSTEM_PROMPT_FILE (${path}) could not be read, so the built-in prompt is in use.` };
  }
}

/** Test/ops helper: forget the cached contents of every prompt file. */
export function clearPromptFileCache(): void {
  promptFileCache.clear();
}

export interface SystemPromptResolution {
  prompt: string;
  source: SystemPromptSource;
  file: string | null;
  warning: string | null;
}

/**
 * Resolve the system prompt. Precedence: file > inline > built-in.
 * A configured-but-unreadable file falls back to the inline prompt (or the
 * built-in one) and reports why — it never silently becomes the built-in prompt
 * without a warning.
 */
export function resolveSystemPrompt(env: NodeJS.ProcessEnv): SystemPromptResolution {
  const file = env.ANALYST_SYSTEM_PROMPT_FILE?.trim();
  const inline = env.ANALYST_SYSTEM_PROMPT?.trim();

  if (file) {
    const read = readSystemPromptFile(file);
    if (read.text !== null && read.text.trim().length > 0) {
      return { prompt: read.text.trim(), source: 'custom', file, warning: null };
    }
    if (inline) return { prompt: inline, source: 'custom', file, warning: read.error };
    return { prompt: DEFAULT_ANALYST_SYSTEM_PROMPT, source: 'built-in', file, warning: read.error };
  }

  if (inline) return { prompt: inline, source: 'custom', file: null, warning: null };
  return { prompt: DEFAULT_ANALYST_SYSTEM_PROMPT, source: 'built-in', file: null, warning: null };
}

// ── Scalar parsing ──────────────────────────────────────

function numberOr(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

// ── Main resolver ───────────────────────────────────────

function demoConfig(env: NodeJS.ProcessEnv, prompt: SystemPromptResolution): AnalystConfig {
  return {
    provider: 'demo',
    providerDisplayName: PROVIDER_DISPLAY_NAMES.demo,
    model: env.ANALYST_MODEL?.trim() || null,
    endpoint: null,
    endpointHost: null,
    endpointLoopback: false,
    apiKey: null,
    hasKey: Boolean(env.ANALYST_API_KEY?.trim()),
    systemPrompt: prompt.prompt,
    systemPromptSource: prompt.source,
    systemPromptFile: prompt.file,
    systemPromptWarning: prompt.warning,
    maxTokens: numberOr(env, 'ANALYST_MAX_TOKENS', DEFAULT_MAX_TOKENS, 1, 200000),
    temperature: numberOr(env, 'ANALYST_TEMPERATURE', DEFAULT_TEMPERATURE, 0, 2),
    timeoutMs: numberOr(env, 'ANALYST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100, 600000),
    jsonMode: env.ANALYST_JSON_MODE?.trim().toLowerCase() === 'off' ? 'off' : 'auto',
    sendingCategories: [],
    misconfiguredReason: null,
  };
}

/**
 * Resolve the analyst configuration.
 *
 * With `ANALYST_PROVIDER` unset, `demo` or `none` this returns the demo
 * configuration and never touches the network. With a remote provider it
 * validates the endpoint, the model and (for non-loopback hosts) the key, and
 * states the first problem it finds as `misconfiguredReason`.
 */
export function readAnalystConfig(env: NodeJS.ProcessEnv = process.env): AnalystConfig {
  const rawProvider = env.ANALYST_PROVIDER?.trim().toLowerCase() ?? '';
  const prompt = resolveSystemPrompt(env);

  if (!rawProvider || rawProvider === 'demo' || rawProvider === 'none') {
    return demoConfig(env, prompt);
  }

  const base: AnalystConfig = {
    provider: 'demo',
    providerDisplayName: env.ANALYST_PROVIDER!.trim(),
    model: env.ANALYST_MODEL?.trim() || null,
    endpoint: null,
    endpointHost: null,
    endpointLoopback: false,
    apiKey: env.ANALYST_API_KEY?.trim() || null,
    hasKey: Boolean(env.ANALYST_API_KEY?.trim()),
    systemPrompt: prompt.prompt,
    systemPromptSource: prompt.source,
    systemPromptFile: prompt.file,
    systemPromptWarning: prompt.warning,
    maxTokens: numberOr(env, 'ANALYST_MAX_TOKENS', DEFAULT_MAX_TOKENS, 1, 200000),
    temperature: numberOr(env, 'ANALYST_TEMPERATURE', DEFAULT_TEMPERATURE, 0, 2),
    timeoutMs: numberOr(env, 'ANALYST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100, 600000),
    jsonMode: env.ANALYST_JSON_MODE?.trim().toLowerCase() === 'off' ? 'off' : 'auto',
    sendingCategories: REMOTE_SENDING_CATEGORIES,
    misconfiguredReason: null,
  };

  if (rawProvider !== 'openai' && rawProvider !== 'anthropic') {
    return {
      ...base,
      misconfiguredReason: `ANALYST_PROVIDER "${env.ANALYST_PROVIDER!.trim()}" is not one of demo, openai or anthropic.`,
    };
  }

  const provider = rawProvider;
  const endpoint = normalizeEndpoint(env.ANALYST_API_URL ?? '', provider);

  const reason =
    endpoint.reason ??
    (!base.model ? 'ANALYST_MODEL is required when a remote provider is configured.' : null) ??
    (!endpoint.loopback && !base.hasKey
      ? 'ANALYST_API_KEY is required because the configured endpoint is not a loopback host.'
      : null);

  return {
    ...base,
    provider,
    providerDisplayName: PROVIDER_DISPLAY_NAMES[provider],
    endpoint: endpoint.url,
    endpointHost: endpoint.host,
    endpointLoopback: endpoint.loopback,
    misconfiguredReason: reason,
  };
}

/** Configuration state safe to return to a browser: never a key, never a full URL with credentials. */
export interface AnalystConfigState {
  configured: boolean;
  misconfigured: boolean;
  misconfiguredReason: string | null;
  provider: AnalystProviderId;
  providerDisplayName: string;
  model: string | null;
  destination: string | null;
  hasKey: boolean;
  endpointIsLoopback: boolean;
  sendingCategories: string[];
  systemPromptSource: SystemPromptSource;
  systemPromptWarning: string | null;
}

/** Reduce a resolved configuration to the fields the client may see. */
export function publicConfigState(config: AnalystConfig): AnalystConfigState {
  const configured = config.provider !== 'demo' && config.misconfiguredReason === null;
  return {
    configured,
    misconfigured: config.misconfiguredReason !== null,
    misconfiguredReason: config.misconfiguredReason,
    provider: config.provider,
    providerDisplayName: config.providerDisplayName,
    model: config.model,
    destination: config.endpointHost,
    hasKey: config.hasKey,
    endpointIsLoopback: config.endpointLoopback,
    sendingCategories: config.provider === 'demo' ? [] : config.sendingCategories,
    systemPromptSource: configured ? config.systemPromptSource : 'built-in',
    systemPromptWarning: config.systemPromptWarning,
  };
}
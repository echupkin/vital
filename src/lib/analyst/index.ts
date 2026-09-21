// ── Analyst service boundary ────────────────────────────
//
// Server-side only. Import this from a route handler, never from a component:
// it reads provider configuration from the server environment. A browser module
// should import `./prompts` (for the supported question list) or `./types`
// (for the response shape) directly, not this barrel.

export * from './types';

export {
  askAnalyst,
  supportedPrompts,
  validateQuery,
  sanitizeUntrustedNotes,
  selectedMetricNames,
  EDUCATIONAL_NOTICE,
  QUERY_MAX_CHARS,
  NOTES_MAX_CHARS,
} from './service';

export {
  HANDLERS,
  selectHandler,
  selectHandlerStrict,
  handlerIds,
  unsupportedHandlerIds,
  BOUNDARY_NOTE,
} from './handlers';

export {
  SUPPORTED_PROMPTS,
  SUPPORTED_QUESTIONS,
} from './prompts';

export {
  DEFAULT_ANALYST_SYSTEM_PROMPT,
  UNTRUSTED_START,
  UNTRUSTED_END,
  buildAnalystUserMessage,
  buildContextPayload,
  collectDisplayStrings,
  displayUnitLabel,
} from './systemPrompt';

export {
  RETRIEVAL_SPECS,
  MAX_POINTS_PER_SERIES,
  GENERAL_HANDLER_ID,
  GENERAL_RETRIEVAL_DAYS,
  GENERAL_RETRIEVAL_METRICS,
  retrieve,
  retrieveGeneral,
  summaryOf,
  pairOf,
  everySummary,
  AnalysisNotAvailable,
} from './retrieval';

export {
  DEMO_LABEL,
  OPENAI_LABEL,
  ANTHROPIC_LABEL,
  DemoAnalystProvider,
  OpenAICompatibleProvider,
  AnthropicProvider,
  AnalystProviderError,
  RATE_LIMIT_RETRIES,
  createProvider,
  resolveProvider,
} from './provider';

export {
  readAnalystConfig,
  publicConfigState,
  normalizeEndpoint,
  isLoopbackHost,
  resolveSystemPrompt,
  readSystemPromptFile,
  clearPromptFileCache,
  PROVIDER_DEFAULT_PATHS,
  PROVIDER_DISPLAY_NAMES,
  LOOPBACK_HOSTS,
  REMOTE_SENDING_CATEGORIES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  type AnalystConfig,
  type AnalystConfigState,
  type AnalystProviderId,
  type SystemPromptSource,
  type JsonMode,
} from './config';

export {
  parseAnalystReply,
  checkGrounding,
  extractJsonObject,
  extractNumericTokens,
  citableMetricIds,
  collectBundleNumbers,
  normalizeCitation,
  MAX_TITLE_CHARS,
  MAX_LINE_CHARS,
  MAX_EVIDENCE,
  MAX_FOLLOWUPS,
} from './validate';

export { scrubText, safeExcerpt, hostOf, REDACTED } from './scrub';

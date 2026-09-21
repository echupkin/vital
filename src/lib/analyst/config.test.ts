import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  clearPromptFileCache,
  isLoopbackHost,
  normalizeEndpoint,
  publicConfigState,
  readAnalystConfig,
} from '@/lib/analyst/config';
import { SUPPORTED_PROMPTS } from '@/lib/analyst/prompts';
import { DEFAULT_ANALYST_SYSTEM_PROMPT } from '@/lib/analyst/systemPrompt';

const KEY = 'sk-secret-value-that-must-never-leak';

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as unknown as NodeJS.ProcessEnv;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vital-analyst-'));
  tempDirs.push(dir);
  return dir;
}

describe('analyst configuration resolution (SPEC §8, §11)', () => {
  it('defaults to the demo analyst with the built-in prompt and no key', () => {
    const config = readAnalystConfig(env({}));
    expect(config.provider).toBe('demo');
    expect(config.providerDisplayName).toBe('Demo analyst');
    expect(config.misconfiguredReason).toBeNull();
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPrompt).toBe(DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(config.hasKey).toBe(false);
    expect(config.model).toBeNull();
  });

  it('treats demo and none as the demo analyst', () => {
    for (const value of ['demo', 'none', '  demo  ', 'DEMO']) {
      const config = readAnalystConfig(env({ ANALYST_PROVIDER: value }));
      expect(config.provider).toBe('demo');
      expect(config.misconfiguredReason).toBeNull();
    }
  });

  it('applies documented defaults for the request parameters', () => {
    const config = readAnalystConfig(env({}));
    expect(config.maxTokens).toBe(1200);
    expect(config.temperature).toBe(0.2);
    expect(config.timeoutMs).toBe(60000);
    expect(config.jsonMode).toBe('auto');
  });

  it('reads overrides and ignores nonsense values', () => {
    const config = readAnalystConfig(
      env({ ANALYST_MAX_TOKENS: '4000', ANALYST_TEMPERATURE: '0.7', ANALYST_TIMEOUT_MS: '15000', ANALYST_JSON_MODE: 'off' })
    );
    expect(config.maxTokens).toBe(4000);
    expect(config.temperature).toBe(0.7);
    expect(config.timeoutMs).toBe(15000);
    expect(config.jsonMode).toBe('off');

    const bad = readAnalystConfig(env({ ANALYST_MAX_TOKENS: 'lots', ANALYST_TEMPERATURE: '9', ANALYST_TIMEOUT_MS: '-4' }));
    expect(bad.maxTokens).toBe(1200);
    expect(bad.temperature).toBe(0.2);
    expect(bad.timeoutMs).toBe(60000);
  });

  it('resolves the OpenAI-compatible provider and normalizes a base URL', () => {
    const config = readAnalystConfig(
      env({
        ANALYST_PROVIDER: 'openai',
        ANALYST_API_URL: 'https://openrouter.ai/api/v1',
        ANALYST_MODEL: 'test/model',
        ANALYST_API_KEY: KEY,
      })
    );
    expect(config.provider).toBe('openai');
    expect(config.providerDisplayName).toBe('OpenAI-compatible');
    expect(config.misconfiguredReason).toBeNull();
    expect(config.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(config.endpointHost).toBe('openrouter.ai');
    expect(config.endpointLoopback).toBe(false);
    expect(config.hasKey).toBe(true);
    expect(config.sendingCategories.length).toBeGreaterThan(0);
  });

  it('uses a full endpoint as-is, with or without a trailing slash', () => {
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions', 'openai').url
    ).toBe('https://api.example.com/v1/chat/completions');
    expect(
      normalizeEndpoint('https://api.example.com/v1/chat/completions/', 'openai').url
    ).toBe('https://api.example.com/v1/chat/completions');
    expect(normalizeEndpoint('https://api.anthropic.com/v1/messages', 'anthropic').url).toBe(
      'https://api.anthropic.com/v1/messages'
    );
  });

  it('appends the provider default path for the Anthropic provider', () => {
    expect(normalizeEndpoint('https://api.anthropic.com', 'anthropic').url).toBe('https://api.anthropic.com/v1/messages');
    expect(normalizeEndpoint('http://host.docker.internal:11434', 'anthropic').url).toBe(
      'http://host.docker.internal:11434/v1/messages'
    );
  });

  it('reports an invalid URL as a misconfiguration instead of throwing', () => {
    const config = readAnalystConfig(
      env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'not a url', ANALYST_MODEL: 'm', ANALYST_API_KEY: KEY })
    );
    expect(config.misconfiguredReason).toContain('not a valid URL');
    expect(config.endpoint).toBeNull();
    const bad = readAnalystConfig(
      env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'ftp://example.com', ANALYST_MODEL: 'm', ANALYST_API_KEY: KEY })
    );
    expect(bad.misconfiguredReason).toContain('http or https');
  });

  it('reports an unknown provider name as a misconfiguration', () => {
    const config = readAnalystConfig(
      env({ ANALYST_PROVIDER: 'mystery', ANALYST_API_URL: 'https://example.com/v1', ANALYST_API_KEY: KEY })
    );
    expect(config.misconfiguredReason).toContain('mystery');
    expect(config.providerDisplayName).toBe('mystery');
  });

  it('requires a model when a remote provider is set', () => {
    const config = readAnalystConfig(
      env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'https://example.com/v1', ANALYST_API_KEY: KEY })
    );
    expect(config.misconfiguredReason).toContain('ANALYST_MODEL');
  });

  it('requires a key for a non-loopback endpoint and not for a loopback one', () => {
    const remote = readAnalystConfig(
      env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'https://api.openai.com/v1', ANALYST_MODEL: 'm' })
    );
    expect(remote.misconfiguredReason).toContain('ANALYST_API_KEY');

    for (const host of ['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']) {
      const local = readAnalystConfig(
        env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: `http://${host}:1234/v1`, ANALYST_MODEL: 'local-model' })
      );
      expect(local.misconfiguredReason).toBeNull();
      expect(local.endpointLoopback).toBe(true);
      expect(local.hasKey).toBe(false);
      // A local model server still receives the selected summaries.
      expect(local.sendingCategories.length).toBeGreaterThan(0);
    }
  });

  it('classifies loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('host.docker.internal')).toBe(true);
    expect(isLoopbackHost('api.openai.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
  });

  it('never puts the key or a credential-bearing URL in the public state', () => {
    const config = readAnalystConfig(
      env({
        ANALYST_PROVIDER: 'openai',
        ANALYST_API_URL: 'https://user:pass@api.example.com/v1',
        ANALYST_MODEL: 'm',
        ANALYST_API_KEY: KEY,
      })
    );
    expect(config.apiKey).toBe(KEY);
    const state = publicConfigState(config);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('user:pass');
    expect(state.destination).toBe('api.example.com');
    expect(state.hasKey).toBe(true);
    expect(state.configured).toBe(true);
  });

  it('reports a misconfigured provider as unconfigured in the public state', () => {
    const state = publicConfigState(
      readAnalystConfig(env({ ANALYST_PROVIDER: 'openai', ANALYST_API_URL: 'https://example.com/v1', ANALYST_MODEL: 'm' }))
    );
    expect(state.configured).toBe(false);
    expect(state.misconfigured).toBe(true);
    expect(state.misconfiguredReason).toContain('ANALYST_API_KEY');
  });
});

describe('system prompt precedence: file > inline > built-in (SPEC §8)', () => {
  it('uses the built-in prompt by default', () => {
    const config = readAnalystConfig(env({}));
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPrompt).toContain('never diagnose');
  });

  it('uses the inline prompt when set', () => {
    const config = readAnalystConfig(env({ ANALYST_SYSTEM_PROMPT: 'Answer as a laconic intern.' }));
    expect(config.systemPromptSource).toBe('custom');
    expect(config.systemPrompt).toBe('Answer as a laconic intern.');
  });

  it('lets the file win over the inline prompt, and re-reads it when it changes', () => {
    clearPromptFileCache();
    const dir = tempDir();
    const file = path.join(dir, 'prompt.md');
    writeFileSync(file, 'FILE PROMPT ONE');
    const envWith = env({
      ANALYST_SYSTEM_PROMPT: 'inline prompt',
      ANALYST_SYSTEM_PROMPT_FILE: file,
    });

    const first = readAnalystConfig(envWith);
    expect(first.systemPromptSource).toBe('custom');
    expect(first.systemPrompt).toBe('FILE PROMPT ONE');
    expect(first.systemPromptFile).toBe(file);
    expect(first.systemPromptWarning).toBeNull();

    // Rewrite and move the mtime forward so the cache is invalidated.
    writeFileSync(file, 'FILE PROMPT TWO');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    const second = readAnalystConfig(envWith);
    expect(second.systemPrompt).toBe('FILE PROMPT TWO');
  });

  it('falls back with a stated warning when the prompt file cannot be read', () => {
    clearPromptFileCache();
    const missing = path.join(tempDir(), 'nope.md');
    const config = readAnalystConfig(env({ ANALYST_SYSTEM_PROMPT_FILE: missing }));
    expect(config.systemPrompt).toBe(DEFAULT_ANALYST_SYSTEM_PROMPT);
    expect(config.systemPromptSource).toBe('built-in');
    expect(config.systemPromptWarning).toContain(missing);
    // A missing prompt file does not make the provider unusable.
    expect(config.misconfiguredReason).toBeNull();

    const withInline = readAnalystConfig(
      env({ ANALYST_SYSTEM_PROMPT_FILE: missing, ANALYST_SYSTEM_PROMPT: 'inline fallback' })
    );
    expect(withInline.systemPrompt).toBe('inline fallback');
    expect(withInline.systemPromptSource).toBe('custom');
    expect(withInline.systemPromptWarning).toContain(missing);
  });

  it('keeps the supported demo question list intact', () => {
    expect(SUPPORTED_PROMPTS.length).toBeGreaterThanOrEqual(8);
  });
});

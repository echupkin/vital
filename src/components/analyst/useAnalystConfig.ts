'use client';

// ── Analyst configuration hook (SPEC §8, §11) ───────────
//
// The browser cannot read the analyst's environment, so it asks the server for
// the configuration *state* instead: provider, model, destination host, whether
// a credential is present and the prompt source. The key itself is never part of
// this payload — the route reduces it to a boolean.

import { useEffect, useState } from 'react';
// Type-only import: nothing from the server module (node:fs, prompts) is pulled
// into the client bundle by this.
import type { AnalystConfigState } from '@/lib/analyst/config';

export interface AnalystConfigWithPrompts extends AnalystConfigState {
  prompts: string[];
}

export interface AnalystConfigHook {
  state: AnalystConfigWithPrompts | null;
  error: string | null;
}

/** Read the analyst configuration state once on mount. */
export function useAnalystConfig(): AnalystConfigHook {
  const [state, setState] = useState<AnalystConfigWithPrompts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/analyst', { cache: 'no-store' });
        if (!res.ok) throw new Error(`The analyst configuration endpoint answered HTTP ${res.status}.`);
        const data = (await res.json()) as AnalystConfigWithPrompts;
        if (!cancelled) setState(data);
      } catch (e) {
        // Nothing is assumed in its place: an unknown state stays unknown rather
        // than being reported as "no provider configured".
        if (!cancelled) setError(e instanceof Error ? e.message : 'The analyst configuration could not be read.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, error };
}

/** Badge text for the current state. Never contains a key. */
export function providerBadge(state: AnalystConfigWithPrompts | null): string {
  if (!state || (!state.configured && !state.misconfigured)) return 'Demo analyst';
  if (state.misconfigured) return `${state.providerDisplayName} · misconfigured`;
  return state.model ? `${state.providerDisplayName} · ${state.model}` : state.providerDisplayName;
}
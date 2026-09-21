'use client';

// ── Today's briefing hook (SPEC §5B) ─────────────────────
//
// The hero renders the computed briefing on the server and on first paint; this
// hook asks the server for the day's written briefing in the background and
// swaps it in when it arrives. Nothing here blocks a render, and nothing here is
// guessed: until the server answers, the component shows the computed briefing
// labelled as computed.
//
// A cold cache answers with the computed briefing plus `pending: true` and the
// generation runs behind it, so the hook asks again a bounded number of times —
// that is how a first-ever load fills in without a manual reload, and it stops
// as soon as the server says nothing is in flight.
//
// `regenerate` is the explicit control: one POST, which replaces the current
// day's briefing once and returns the replacement (or an error explaining why
// the model could not write it). It never loops.
//
// Type-only import: the shape lives in its own module so no server code
// (provider configuration, cache, credentials path) is pulled into the bundle.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BriefingView } from '@/lib/briefing/types';
import type { UnitSystem } from '@/lib/prefs';

/** How many follow-up reads a cold load may make while a generation runs. */
export const BRIEFING_POLL_ATTEMPTS = 10;
/**
 * Delay before the first follow-up read; it doubles each time.
 *
 * A cold first load has to outlast one generation, and a reasoning model can
 * take well over a minute for it. Ten passes, doubling from 5 s, cover about
 * 100 s of a genuinely cold start without hammering the endpoint: each pass is a
 * cache read, and the generation itself is single-flight on the server.
 */
export const BRIEFING_POLL_BASE_MS = 5000;

export interface BriefingHook {
  /** The latest briefing the server returned, or null before the first answer. */
  briefing: BriefingView | null;
  /** True while the server is generating a written briefing. */
  pending: boolean;
  /** Set only when the endpoint could not be read at all. */
  error: string | null;
  /** True while an explicit regeneration is in flight. */
  regenerating: boolean;
  /**
   * Replace the current day's briefing, once. Resolves with the replacement, or
   * throws with the server's reason (the computed briefing then stays on screen).
   */
  regenerate: () => Promise<void>;
}

/**
 * Poll cadence for the follow-up reads. Extracted so a test can assert the
 * schedule rather than the wall clock.
 */
export function briefingPollDelayMs(attempt: number): number {
  return BRIEFING_POLL_BASE_MS * 2 ** Math.max(0, attempt);
}

export function useBriefing(system: UnitSystem): BriefingHook {
  const [briefing, setBriefing] = useState<BriefingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // One timer at a time, always cancelled on unmount or on a new unit system.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clear = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const read = async (attempt: number): Promise<void> => {
      try {
        const res = await fetch(`/api/briefing?system=${system}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`The briefing endpoint answered HTTP ${res.status}.`);
        const data = (await res.json()) as BriefingView;
        if (cancelled) return;
        setBriefing(data);
        setError(null);
        const more = data.pending && attempt + 1 < BRIEFING_POLL_ATTEMPTS;
        setPending(more);
        if (more) {
          timer.current = setTimeout(() => void read(attempt + 1), briefingPollDelayMs(attempt));
        }
      } catch (e) {
        if (cancelled) return;
        // The computed briefing stays on screen: a failed read is reported, not
        // papered over with placeholder prose.
        setError(e instanceof Error ? e.message : 'The briefing could not be read.');
        setPending(false);
      }
    };

    setBriefing(null);
    setPending(true);
    void read(0);

    return () => {
      cancelled = true;
      clear();
    };
    // Re-read when the unit system changes: the server formats the text in it.
  }, [system]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/briefing?system=${system}`, { method: 'POST', cache: 'no-store' });
      const payload = (await res.json()) as BriefingView & { error?: string };
      if (!res.ok) throw new Error(payload?.error ?? `The briefing endpoint answered HTTP ${res.status}.`);
      setBriefing(payload);
      setError(null);
      setPending(false);
    } catch (e) {
      // The computed briefing remains: the failure is reported, never hidden.
      setError(e instanceof Error ? e.message : 'The briefing could not be regenerated.');
    } finally {
      setRegenerating(false);
    }
  }, [system]);

  return { briefing, pending, error, regenerating, regenerate };
}

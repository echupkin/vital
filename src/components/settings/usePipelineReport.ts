'use client';

// The pipeline status report, read part by part from /api/pipeline/status?part=…
// Shared by the Connections tab (every stage), the Sources tab (workout sources
// only) and the data freshness dialog.
//
// The report exists from the first render: every requested part starts as
// "Checking…" and is filled in as its own request answers, so a cold dataset
// load holds up only the stages that depend on it. A part whose request fails
// turns its stages to Unknown with the reason; the others are unaffected.
//
// `load({ fresh: true })` is "Check again": the dataset is read from the
// sources afresh and the workout sources synced, instead of reporting on the
// cached copies, and once the new dataset is in the app's pages are refreshed
// so they show it too.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { assembleReport, isPartFailure } from '@/lib/pipeline/assemble';
import { PIPELINE_PARTS, type PipelinePart, type PipelineParts } from '@/lib/pipeline/types';

export function usePipelineReport({ parts = PIPELINE_PARTS, enabled = true }: { parts?: PipelinePart[]; enabled?: boolean } = {}) {
  const [received, setReceived] = useState<PipelineParts>({});
  /** Counts full reloads ("Check again"), never a part arriving: a key for anything to restart then. */
  const [loads, setLoads] = useState(0);
  // One counter per part: an answer to a superseded request is dropped.
  const generation = useRef<Partial<Record<PipelinePart, number>>>({});
  // Parts with a request on its way, which a quiet refresh must not supersede (it may be a fresh read).
  const inFlight = useRef(new Set<PipelinePart>());
  const router = useRouter();
  const key = parts.join(',');
  const requested = useMemo(() => key.split(',') as PipelinePart[], [key]);

  const fetchPart = useCallback(async (part: PipelinePart, followQuality = true, fresh = false): Promise<void> => {
    const gen = (generation.current[part] = (generation.current[part] ?? 0) + 1);
    let value: PipelineParts[PipelinePart];
    inFlight.current.add(part);
    try {
      // The probes always run live; only the dataset and the workout sources have caches to bypass.
      const query = fresh && part !== 'sources' ? `part=${part}&fresh=1` : `part=${part}`;
      const res = await fetch(`/api/pipeline/status?${query}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`the status endpoint answered HTTP ${res.status}.`);
      value = await res.json();
    } catch (e) {
      value = { error: e instanceof Error ? e.message : 'the request failed.' };
    }
    if (generation.current[part] !== gen) return;
    inFlight.current.delete(part);
    setReceived(r => ({ ...r, [part]: value }));
    // A fresh dataset is now what the server holds: have the pages pick it up too.
    if (fresh && part === 'dataset' && !isPartFailure(value)) router.refresh();
    // The data-quality checks run on after the dataset loads: wait for them
    // (the quality route holds the request until they finish), then read the
    // dataset part once more so its stage leaves "Checking…". Once only.
    if (part === 'dataset' && followQuality && value && 'qualityState' in value && value.qualityState === 'computing') {
      try {
        await fetch('/api/pipeline/quality', { cache: 'no-store' });
      } catch {
        // The stage stays "Checking…"; "Check again" asks afresh.
      }
      if (generation.current[part] === gen) await fetchPart('dataset', false);
    }
  }, [router]);

  /**
   * Check every requested part again; the stages go back to "Checking…".
   * `fresh` reads the data afresh instead of reporting on the cached copy.
   */
  const load = useCallback(
    ({ fresh = false }: { fresh?: boolean } = {}) => {
      setReceived({});
      setLoads(n => n + 1);
      for (const part of requested) void fetchPart(part, true, fresh);
    },
    [requested, fetchPart]
  );

  /**
   * Fetch these parts (default: all requested) again in place, without blanking
   * them. A part already being fetched is left to that request, which answers
   * with the newer state anyway.
   */
  const refreshQuietly = useCallback(
    (only?: PipelinePart[]) => {
      for (const part of only ?? requested) {
        if (requested.includes(part) && !inFlight.current.has(part)) void fetchPart(part);
      }
    },
    [requested, fetchPart]
  );

  // Checked once, when first enabled (the freshness dialog enables it on opening).
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    load();
  }, [enabled, load]);

  const report = useMemo(() => assembleReport(received, { requested }), [received, requested]);
  // Only when nothing at all could be read is the report itself an error.
  const failed = requested.map(p => received[p]).filter(isPartFailure);
  const error = failed.length === requested.length ? `The status could not be read: ${failed[0].error}` : null;
  return { report, error, load, refreshQuietly, loads };
}

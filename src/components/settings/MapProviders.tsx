'use client';

// ── Settings → Connections → Maps ───────────────────────
//
// The tile providers Activity → Maps can draw on, and whether each is ready: it
// needs no key, or its key is set in the server environment. Read-only, like the
// workout sources above it: keys are configured by environment variable, and
// the key itself is never sent here.

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { Badge, Button, DataStateNote, ErrorState, Skeleton } from '@/components/ui/primitives';
import { MAP_PROVIDERS, mapProvider } from '@/lib/activity-maps/providers';
import type { MapProviderStatus } from '@/lib/activity-maps/tiles';

function statusBadge(status: MapProviderStatus) {
  if (!status.needsKey) return <Badge variant="success">Available</Badge>;
  if (status.configured) return <Badge variant="success">Configured</Badge>;
  if (status.invalid) return <Badge variant="warning">Invalid key</Badge>;
  return <Badge variant="warning">Needs an API key</Badge>;
}

function statusDetail(status: MapProviderStatus): React.ReactNode {
  const env = status.envVar ? <code className="text-[11px]">{status.envVar}</code> : null;
  if (!status.needsKey) return 'No key needed.';
  if (status.configured) return <>Key read from {env}.</>;
  if (status.invalid) return <>{env} is set, but not to something that looks like a key. Its tiles are requested without a key until it is fixed, and may not load.</>;
  return <>Set {env} on the server to use it. Until then its tiles are requested without a key and may not load.</>;
}

export function MapProvidersCard({ heading }: { heading: (icon: React.ReactNode, title: string) => React.ReactNode }) {
  const [providers, setProviders] = useState<MapProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setProviders(null);
    try {
      const res = await fetch('/api/map-providers', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The map providers endpoint answered HTTP ${res.status}.`);
      setProviders(((await res.json()) as { providers: MapProviderStatus[] }).providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The map providers could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {heading(<MapIcon size={18} className="text-text-secondary" />, 'Maps')}
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          Check again
        </Button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-text-secondary">
        The tile providers Activity → Maps can draw on. Each map chooses its provider, style and light or dark rendering
        in its edit dialog.
      </p>

      {error && <ErrorState title="The map providers could not be read" message={error} onRetry={() => void load()} />}
      {!providers && !error && (
        <div role="status" aria-live="polite" className="space-y-2">
          <span className="sr-only">Checking the map providers</span>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}

      {providers && (
        <ul className="m-0 list-none p-0">
          {providers
            .filter(s => MAP_PROVIDERS.some(p => p.id === s.id))
            .map(status => {
              const p = mapProvider(status.id);
              return (
                <li key={p.id} className="border-b border-border py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">{p.label}</span>
                    {statusBadge(status)}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{p.description}</p>
                  <p className={`mt-0.5 text-xs leading-relaxed ${status.configured ? 'text-text-secondary' : 'text-category-attention'}`}>
                    {statusDetail(status)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {p.key && !status.configured && (
                      <a href={p.key.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                        Get a key <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                    <a href={p.policyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-secondary underline">
                      Terms and usage policy <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  </p>
                </li>
              );
            })}
        </ul>
      )}

      <div className="mt-4">
        <DataStateNote>
          Map provider keys are read from the server environment and are never shown here. A tile key travels with every
          tile your browser requests, so the provider sees it, along with the area on screen; your routes are drawn in the
          browser and never sent to it.
        </DataStateNote>
      </div>
    </>
  );
}

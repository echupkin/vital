'use client';

// ── Dataset provider ────────────────────────────────────
//
// Installs the dataset the pages read, then renders them.
//
// The data layer (`@/lib/adapters/dataset`) keeps the active dataset in module
// scope so that every existing page and component keeps working unchanged — the
// product's internal shape was not redesigned for the live source. This provider
// is the one place that swaps it:
//
//   * live mode  — the server fetched, normalized and cached the Health Auto
//                  Export history and passed it here as a prop. The browser never
//                  talks to the health API and never sees the token.
//   * demo mode  — nothing is passed: the client bundle already contains the
//                  committed fixtures, so the demo path stays exactly as it was.
//
// The install happens during render, before children render, which is what makes
// the server-rendered HTML and the hydrated client agree. It is idempotent.

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { HealthFixtures } from '@/lib/metrics/types';
import {
  datasetMeta,
  resetToDemoDataset,
  setActiveDataset,
  type DataMode,
} from '@/lib/adapters/dataset';
import type { ClientDatasetMeta } from '@/lib/adapters/meta';
import { FALLBACK_CLIENT_META } from './fallback-meta';

const FALLBACK_META = FALLBACK_CLIENT_META;

const DatasetMetaContext = createContext<ClientDatasetMeta>(FALLBACK_META);

export interface DatasetProviderProps {
  mode: DataMode;
  /** Present only in live mode. */
  dataset: HealthFixtures | null;
  meta: ClientDatasetMeta | null;
  children: ReactNode;
}

export function DatasetProvider({ mode, dataset, meta, children }: DatasetProviderProps) {
  const value = useMemo<ClientDatasetMeta>(() => {
    if (meta) return meta;
    const server = datasetMeta();
    return { ...FALLBACK_META, mode: server.mode, live: server.live, referenceKey: server.referenceKey };
  }, [meta]);

  if (mode === 'live' && dataset) {
    setActiveDataset(dataset, {
      mode: 'live',
      dataAsOf: meta?.dataAsOf ?? dataset.windowEnd,
      generatedAt: meta?.generatedAt,
    });
  } else {
    resetToDemoDataset();
  }

  return <DatasetMetaContext.Provider value={value}>{children}</DatasetMetaContext.Provider>;
}

/** What the active dataset is, how fresh it is, and where it came from. */
export function useDatasetMeta(): ClientDatasetMeta {
  return useContext(DatasetMetaContext);
}

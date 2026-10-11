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
//
// `pending` is for the one page that renders before the dataset has arrived
// (Settings, see `DatasetStream`): nothing is installed, and `useDatasetReady`
// tells the parts of it that read the data to wait.

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

export const DatasetMetaContext = createContext<ClientDatasetMeta>(FALLBACK_META);
const DatasetReadyContext = createContext(true);

export interface DatasetProviderProps {
  mode: DataMode;
  /** Present only in live mode. */
  dataset: HealthFixtures | null;
  meta: ClientDatasetMeta | null;
  /** The dataset has not arrived yet: install nothing, and report not ready. */
  pending?: boolean;
  children: ReactNode;
}

export function DatasetProvider({ mode, dataset, meta, pending = false, children }: DatasetProviderProps) {
  const value = useMemo<ClientDatasetMeta>(() => {
    if (meta) return meta;
    const server = datasetMeta();
    return { ...FALLBACK_META, mode: server.mode, live: server.live, referenceKey: server.referenceKey };
  }, [meta]);

  if (pending) {
    // Leave the data layer as it is until the dataset arrives.
  } else if (mode === 'live' && dataset) {
    setActiveDataset(dataset, {
      mode: 'live',
      dataAsOf: meta?.dataAsOf ?? dataset.windowEnd,
      generatedAt: meta?.generatedAt,
    });
  } else {
    resetToDemoDataset();
  }

  return (
    <DatasetReadyContext.Provider value={!pending}>
      <DatasetMetaContext.Provider value={value}>{children}</DatasetMetaContext.Provider>
    </DatasetReadyContext.Provider>
  );
}

/** False while the dataset is still on its way (Settings renders before it); every other page only renders once it is here. */
export function useDatasetReady(): boolean {
  return useContext(DatasetReadyContext);
}

/** What the active dataset is, how fresh it is, and where it came from. */
export function useDatasetMeta(): ClientDatasetMeta {
  return useContext(DatasetMetaContext);
}

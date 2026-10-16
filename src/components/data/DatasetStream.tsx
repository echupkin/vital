'use client';

// ── The app shell, painted before the dataset arrives ───
//
// A cold start reads the whole history from the live source, which takes
// seconds. The layout no longer waits for it: it hands the load over as a
// promise, the shell (sidebar, top bar) paints at once, and the page streams in
// when the data is here, with a "Loading your health data…" state meanwhile.
//
// Settings is the exception: most of it does not read the data, and it is where
// a broken connection is fixed, so it renders at once with the dataset
// pending; its Data & coverage tab waits on `useDatasetReady`. When the data
// arrives Settings re-renders in place (nothing remounts, so nothing typed is
// lost).
//
// Setup mode (no navigation, Settings only) is known up front when no source
// is connected; a connected source that cannot be read is known only once the
// load fails, and the shell switches to setup mode then.

import { Suspense, use, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { HealthFixtures } from '@/lib/metrics/types';
import type { DataMode } from '@/lib/adapters/dataset';
import type { ClientDatasetMeta } from '@/lib/adapters/meta';
import type { VitalProfile } from '@/lib/profile/types';
import type { InitialPrefs } from '@/components/ui/UnitsProvider';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, BadgeSpinner, Skeleton } from '@/components/ui/primitives';
import { DatasetProvider } from './DatasetProvider';
import { LiveGate, isSettingsPath } from './LiveGate';
import type { SetupFailure } from './setup-mode';

/** What the layout's dataset load settles to. */
export interface LayoutData {
  mode: DataMode;
  dataset: HealthFixtures | null;
  meta: ClientDatasetMeta | null;
  /** Set when live mode has no readable source: the app is in setup mode. */
  failure: SetupFailure | null;
}

export interface DatasetStreamProps {
  data: Promise<LayoutData>;
  /** Setup mode as far as it is known before the load: live mode with no source connected. */
  initialSetupMode: boolean;
  profile: VitalProfile;
  profileStored: boolean;
  initialPrefs: InitialPrefs | null;
  children: ReactNode;
}

/** The load, once it has settled; null while it is on its way. A failed load is thrown to the error page, as before. */
function useSettled(data: Promise<LayoutData>): LayoutData | null {
  const [settled, setSettled] = useState<{ data: Promise<LayoutData>; value: LayoutData } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let current = true;
    data.then(
      value => current && setSettled({ data, value }),
      reason => current && setError(reason ?? new Error('The data could not be loaded.'))
    );
    return () => {
      current = false;
    };
  }, [data]);
  if (error) throw error;
  // A refresh brings a new load; the previous value serves until it settles.
  return settled?.value ?? null;
}

export function DatasetStream({ data, initialSetupMode, profile, profileStored, initialPrefs, children }: DatasetStreamProps) {
  const settled = useSettled(data);
  const setupMode = settled ? settled.failure !== null : initialSetupMode;
  return (
    <AppShell profile={profile} profileStored={profileStored} initialPrefs={initialPrefs} setupMode={setupMode}>
      <Suspense fallback={<DataLoading />}>
        <DatasetGate data={data} settled={settled}>
          {children}
        </DatasetGate>
      </Suspense>
    </AppShell>
  );
}

function DatasetGate({ data, settled, children }: { data: Promise<LayoutData>; settled: LayoutData | null; children: ReactNode }) {
  const pathname = usePathname();
  // Settings never waits: it renders with the dataset pending and fills in when it lands.
  if (isSettingsPath(pathname) && !settled) {
    return (
      <DatasetProvider mode="live" dataset={null} meta={null} pending>
        <LiveGate failure={null}>{children}</LiveGate>
      </DatasetProvider>
    );
  }
  // Every other page suspends until the data is here (on the server too, so it streams in).
  const value = settled ?? use(data);
  return (
    <DatasetProvider mode={value.mode} dataset={value.dataset} meta={value.meta}>
      <LiveGate failure={value.failure}>{children}</LiveGate>
    </DatasetProvider>
  );
}

/** The page area while the data loads. */
export function DataLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <Badge variant="default" className="text-[10px]">
        <BadgeSpinner />
        Loading your health data…
      </Badge>
      <Skeleton height={28} width="40%" />
      <Skeleton height={160} />
      <Skeleton height={120} />
    </div>
  );
}

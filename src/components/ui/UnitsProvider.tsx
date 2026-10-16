'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPreferencesState, loadPreferences, PREFERENCES_EVENT, type UnitSystem, type ThemeMode } from '@/lib/prefs';
import { useProfile } from '@/components/profile/ProfileProvider';

interface UnitsContextValue {
  units: UnitSystem;
  theme: ThemeMode;
  /** The profile's timezone — the app's single source of truth for day keys. */
  timezone: string;
}

const UnitsContext = createContext<UnitsContextValue>({
  units: 'metric',
  theme: 'system',
  timezone: 'UTC',
});

export type InitialPrefs = Omit<UnitsContextValue, 'timezone'>;

/**
 * Exposes the persisted unit / theme preferences to every page so that unit
 * conversions are applied consistently rather than per-component.
 *
 * `initial` is the stored record, read on the server for this request. With it,
 * the first render already has the reader's units, and the device's cache is not
 * consulted until the sync engine has read the server: before then, the cache
 * (or, on a new device, the defaults) could disagree for a moment, and every
 * page that fetches by unit system would fetch twice. Without it (the store
 * could not be read), the cache decides, as before.
 *
 * The timezone is deliberately NOT a device preference: it comes from the
 * profile, which the server owns and which also cuts the server's calendar days.
 * A value stored in localStorage could disagree with the briefing's day
 * boundary, and two answers to "what day is it" is one too many.
 */
export function UnitsProvider({ children, initial = null }: { children: ReactNode; initial?: InitialPrefs | null }) {
  const { profile } = useProfile();
  const [prefs, setPrefs] = useState<InitialPrefs>(initial ?? { units: 'metric', theme: 'system' });
  const seeded = initial !== null;

  useEffect(() => {
    const sync = () => {
      // Seeded from the server: wait for the engine's own server read (or for it
      // to fail, when the device's value is all there is).
      if (seeded) {
        const engine = getPreferencesState();
        if (engine.revision < 0 && engine.status !== 'unsynced') return;
      }
      const p = loadPreferences();
      setPrefs(prev => (prev.units === p.units && prev.theme === p.theme ? prev : { units: p.units, theme: p.theme }));
    };
    sync();
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, [seeded]);

  return (
    <UnitsContext.Provider value={{ ...prefs, timezone: profile.timezone }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits(): UnitsSystem {
  const ctx = useContext(UnitsContext);
  return {
    units: ctx.units,
    theme: ctx.theme,
    timezone: ctx.timezone,
  };
}

export interface UnitsSystem {
  units: UnitSystem;
  theme: ThemeMode;
  timezone: string;
}

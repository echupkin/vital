'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadPreferences, PREFERENCES_EVENT, type UnitSystem, type ThemeMode } from '@/lib/prefs';
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

/**
 * Exposes the persisted unit / theme preferences to every page so that unit
 * conversions are applied consistently rather than per-component.
 *
 * The timezone is deliberately NOT a device preference: it comes from the
 * profile, which the server owns and which also cuts the server's calendar days.
 * A value stored in localStorage could disagree with the briefing's day
 * boundary, and two answers to "what day is it" is one too many.
 */
export function UnitsProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const [prefs, setPrefs] = useState<Omit<UnitsContextValue, 'timezone'>>({
    units: 'metric',
    theme: 'system',
  });

  useEffect(() => {
    const sync = () => {
      const p = loadPreferences();
      setPrefs({ units: p.units, theme: p.theme });
    };
    sync();
    window.addEventListener(PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(PREFERENCES_EVENT, sync);
  }, []);

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

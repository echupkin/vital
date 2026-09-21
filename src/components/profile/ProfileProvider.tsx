'use client';

// ── Profile provider (client) ───────────────────────────
//
// The server owns the profile; this provider is the browser's read of it.
//
// The initial value arrives from the server layout, so the avatar and any other
// server-rendered surface are correct in the first HTML — there is no
// "Loading…" flash and no hydration mismatch. A save goes through the profile
// route and adopts exactly what the server stored, so the client can never hold
// a value the server rejected.
//
// Type-only import of the shape: no store, no filesystem, nothing server-side
// reaches the bundle.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { defaultProfile, type VitalProfile } from '@/lib/profile/types';

interface ProfileContextValue {
  profile: VitalProfile;
  /** True while a save is in flight. */
  saving: boolean;
  /** The last save error, or null. */
  error: string | null;
  /** Replace the whole profile through the server route. Throws on rejection. */
  save: (next: VitalProfile) => Promise<void>;
  /** Re-read the profile from the server. */
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: defaultProfile(),
  saving: false,
  error: null,
  save: async () => {},
  refresh: async () => {},
});

export function ProfileProvider({
  initialProfile,
  children,
}: {
  initialProfile: VitalProfile;
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<VitalProfile>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A server refresh (router.refresh(), or a fresh navigation) hands down a new
  // object; adopt it so a change made elsewhere is not shadowed by stale state.
  useEffect(() => {
    setProfile(initialProfile);
  }, [initialProfile]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/profile', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The profile endpoint answered HTTP ${res.status}.`);
      setProfile((await res.json()) as VitalProfile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The profile could not be read.');
    }
  }, []);

  const save = useCallback(async (next: VitalProfile) => {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
        cache: 'no-store',
      });
      const payload = (await res.json()) as VitalProfile & { error?: string };
      if (!res.ok) throw new Error(payload?.error ?? `The profile endpoint answered HTTP ${res.status}.`);
      // Adopt the server's copy, never the local draft: what is stored is what
      // is shown.
      setProfile({ ...payload });
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The profile could not be saved.';
      setError(message);
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, saving, error, save, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}

'use client';

// ── Timezone default (client) ───────────────────────────
//
// On first run no profile is stored, so the server falls back to a default zone
// that may not be where the person is. This component stores the browser's zone
// as the profile's timezone in that case — once — and refreshes the server
// render so the dataset is cut in it.
//
// It is a default, never an override: once a profile is stored its timezone is
// the person's choice, made in Settings, and this component leaves it alone.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from './ProfileProvider';
import { browserTimezoneToAdopt, runtimeTimezone } from '@/lib/profile/types';

export function TimezoneDefault() {
  const { profile, stored, save } = useProfile();
  const router = useRouter();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    const timezone = browserTimezoneToAdopt(stored, profile.timezone, runtimeTimezone());
    if (!timezone) return;
    attempted.current = true;
    // A failed save stays in the provider's error state; it is not retried here.
    save({ ...profile, timezone }).then(() => router.refresh(), () => {});
  }, [stored, profile, save, router]);

  return null;
}

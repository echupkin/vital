'use client';

import { Fragment, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { BreadcrumbProvider, Breadcrumbs } from './Breadcrumbs';
import { CommandPaletteProvider } from '@/components/ui/CommandPalette';
import { UnitsProvider } from '@/components/ui/UnitsProvider';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import { TimezoneDefault } from '@/components/profile/TimezoneDefault';
import { DiscussProvider } from '@/components/analyst/DiscussDialog';
import type { VitalProfile } from '@/lib/profile/types';
import type { InitialPrefs } from '@/components/ui/UnitsProvider';

interface AppShellProps {
  children: ReactNode;
  /**
   * The profile, read on the server for this request, so the avatar (and every
   * other server-rendered surface) is right in the first HTML.
   */
  profile: VitalProfile;
  /** True when the profile was read from storage rather than defaulted. */
  profileStored: boolean;
  /** The stored units and theme, read on the server; null when unreadable. */
  initialPrefs?: InitialPrefs | null;
  /**
   * Setup mode (live mode, nothing readable yet): no sidebar, mobile navigation,
   * breadcrumbs, search or links, so the only way forward is Settings → Sources.
   */
  setupMode?: boolean;
}

export function AppShell({
  children,
  profile,
  profileStored,
  initialPrefs = null,
  setupMode = false,
}: AppShellProps) {
  // The palette is the one other way around the shell (Cmd+K, and its page list),
  // so setup mode leaves its provider out: the shortcut then does nothing.
  const Palette = setupMode ? Fragment : CommandPaletteProvider;
  return (
    <ProfileProvider initialProfile={profile} initialStored={profileStored}>
      <TimezoneDefault />
      <UnitsProvider initial={initialPrefs}>
        <Palette>
          <DiscussProvider>
            <BreadcrumbProvider>
              <div className="min-h-screen bg-page overflow-x-hidden">
                {/* Desktop sidebar */}
                {!setupMode && (
                  <div className="hidden md:block">
                    <Sidebar />
                  </div>
                )}

                {/* Main content area */}
                <div className={`${setupMode ? '' : 'md:ml-sidebar '}flex flex-col min-h-screen min-w-0`}>
                  <TopBar minimal={setupMode} />

                  <main className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-content mx-auto w-full min-w-0">
                    {!setupMode && <Breadcrumbs />}
                    {children}
                  </main>

                  {/* Footer spacer for mobile nav */}
                  {!setupMode && <div className="h-16 md:h-0" />}
                </div>

                {/* Mobile bottom nav */}
                {!setupMode && <MobileNav />}
              </div>
            </BreadcrumbProvider>
          </DiscussProvider>
        </Palette>
      </UnitsProvider>
    </ProfileProvider>
  );
}

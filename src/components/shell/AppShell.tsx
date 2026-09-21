'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { CommandPaletteProvider } from '@/components/ui/CommandPalette';
import { UnitsProvider } from '@/components/ui/UnitsProvider';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import type { VitalProfile } from '@/lib/profile/types';

interface AppShellProps {
  children: ReactNode;
  /**
   * The profile, read on the server for this request, so the avatar (and every
   * other server-rendered surface) is right in the first HTML.
   */
  profile: VitalProfile;
}

export function AppShell({ children, profile }: AppShellProps) {
  return (
    <ProfileProvider initialProfile={profile}>
      <UnitsProvider>
        <CommandPaletteProvider>
          <div className="min-h-screen bg-page overflow-x-hidden">
            {/* Desktop sidebar */}
            <div className="hidden md:block">
              <Sidebar />
            </div>

            {/* Main content area */}
            <div className="md:ml-sidebar flex flex-col min-h-screen min-w-0">
              <TopBar />

              <main className="flex-1 px-4 md:px-8 py-6 md:py-8 max-w-content mx-auto w-full min-w-0">
                {children}
              </main>

              {/* Footer spacer for mobile nav */}
              <div className="h-16 md:h-0" />
            </div>

            {/* Mobile bottom nav */}
            <MobileNav />
          </div>
        </CommandPaletteProvider>
      </UnitsProvider>
    </ProfileProvider>
  );
}

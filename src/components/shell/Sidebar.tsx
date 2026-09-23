'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Heart, FlaskConical, Activity, Moon, Weight,
  UtensilsCrossed, Dumbbell, Lightbulb, Bot, Settings, ChevronRight,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  isAnalyst?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: <LayoutDashboard size={17} /> },
  { label: 'Trends', href: '/trends', icon: <TrendingUp size={17} /> },
  { label: 'Health', href: '/health', icon: <Heart size={17} /> },
  { label: 'Lab', href: '/lab', icon: <FlaskConical size={17} /> },
  { label: 'Activity', href: '/activity', icon: <Activity size={17} /> },
  { label: 'Sleep', href: '/sleep', icon: <Moon size={17} /> },
  { label: 'Body', href: '/body', icon: <Weight size={17} /> },
  { label: 'Nutrition', href: '/nutrition', icon: <UtensilsCrossed size={17} /> },
  { label: 'Workouts', href: '/workouts', icon: <Dumbbell size={17} /> },
  { label: 'Insights', href: '/insights', icon: <Lightbulb size={17} /> },
  { label: 'AI Analyst', href: '/analyst', icon: <Bot size={17} />, isAnalyst: true },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-sidebar bg-surface border-r border-border flex flex-col z-30"
      aria-label="Main navigation"
    >
      {/* Wordmark */}
      <Link href="/" className="flex items-center gap-2.5 px-5 h-14 shrink-0 border-b border-border">
        <VitalIcon />
        <span className="text-lg font-semibold tracking-tight text-text-primary">Vital</span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors min-h-[40px] ${
              isActive(item.href)
                ? 'bg-accent-tint text-primary font-medium'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted'
            } ${item.isAnalyst ? 'opacity-90 hover:opacity-100' : ''}`}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {isActive(item.href) && (
              <ChevronRight size={14} className="opacity-50" />
            )}
          </Link>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2.5 pb-3 space-y-0.5 border-t border-border pt-2">
        <ThemeToggle />
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors min-h-[40px] ${
            pathname.startsWith('/settings')
              ? 'bg-accent-tint text-primary font-medium'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-muted'
          }`}
        >
          <Settings size={17} />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}

// ── Original Vital Icon (abstract SVG, no cliche heart/pulse) ──
function VitalIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-primary"
    >
      {/* Two intersecting organic curves suggesting health/life */}
      <path
        d="M4 14C6 10 9 7 12 12C15 17 18 14 20 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 10C6 14 9 17 12 12C15 7 18 10 20 14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </svg>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard, TrendingUp, Lightbulb, Bot, Menu,
  Heart, FlaskConical, Activity, Moon, Weight, UtensilsCrossed, Dumbbell, Settings, X,
} from 'lucide-react';
import { Dialog } from '@/components/ui/primitives';

const PRIMARY = [
  { label: 'Overview', href: '/', icon: <LayoutDashboard size={20} /> },
  { label: 'Trends', href: '/trends', icon: <TrendingUp size={20} /> },
  { label: 'Insights', href: '/insights', icon: <Lightbulb size={20} /> },
  { label: 'AI', href: '/analyst', icon: <Bot size={20} /> },
];

const MORE = [
  { label: 'Health', href: '/health', icon: <Heart size={18} /> },
  { label: 'Lab', href: '/lab', icon: <FlaskConical size={18} /> },
  { label: 'Activity', href: '/activity', icon: <Activity size={18} /> },
  { label: 'Sleep', href: '/sleep', icon: <Moon size={18} /> },
  { label: 'Body', href: '/body', icon: <Weight size={18} /> },
  { label: 'Nutrition', href: '/nutrition', icon: <UtensilsCrossed size={18} /> },
  { label: 'Workouts', href: '/workouts', icon: <Dumbbell size={18} /> },
  { label: 'Settings', href: '/settings', icon: <Settings size={18} /> },
];

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border flex items-center justify-around h-16 z-30 md:hidden"
        aria-label="Mobile navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {PRIMARY.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px] min-h-[44px] ${
              isActive(item.href) ? 'text-primary' : 'text-text-secondary'
            }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[56px] min-h-[44px] ${
            MORE.some(m => isActive(m.href)) ? 'text-primary' : 'text-text-secondary'
          }`}
        >
          <Menu size={20} aria-hidden="true" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="All destinations">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-secondary">Every page in Vital</p>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="p-1.5 rounded-md hover:bg-surface-muted text-text-secondary"
            aria-label="Close destinations"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="list-none p-0 m-0 grid grid-cols-2 gap-2">
          {MORE.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-3 rounded-control text-sm min-h-[44px] ${
                  isActive(item.href)
                    ? 'bg-accent-tint text-primary font-medium'
                    : 'bg-surface-muted text-text-primary'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
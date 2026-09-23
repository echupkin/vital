'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X, Search, Command } from 'lucide-react';
import { searchMetrics, getMetric } from '@/lib/metrics';
import { searchLabAnalytes } from '@/lib/lab/search';
import type { MetricDefinition } from '@/lib/metrics/types';

interface SearchItem {
  id: string;
  label: string;
  description: string;
  href: string;
  type: 'metric' | 'page' | 'query' | 'lab';
}

const NAV_ITEMS: SearchItem[] = [
  { id: 'overview', label: 'Overview', description: 'Daily health briefing', href: '/', type: 'page' },
  { id: 'trends', label: 'Trends', description: 'What changed over time', href: '/trends', type: 'page' },
  { id: 'health', label: 'Health', description: 'Cardiovascular summary', href: '/health', type: 'page' },
  { id: 'lab', label: 'Lab', description: 'Lab results imported from PDFs', href: '/lab', type: 'page' },
  { id: 'activity', label: 'Activity', description: 'Steps, exercise, calories', href: '/activity', type: 'page' },
  { id: 'sleep', label: 'Sleep', description: 'Sleep analysis', href: '/sleep', type: 'page' },
  { id: 'body', label: 'Body', description: 'Weight and body metrics', href: '/body', type: 'page' },
  { id: 'nutrition', label: 'Nutrition', description: 'Dietary intake', href: '/nutrition', type: 'page' },
  { id: 'workouts', label: 'Workouts', description: 'Workout history', href: '/workouts', type: 'page' },
  { id: 'insights', label: 'Insights', description: 'Discovered patterns', href: '/insights', type: 'page' },
  { id: 'analyst', label: 'AI Analyst', description: 'Ask about your health', href: '/analyst', type: 'page' },
  { id: 'settings', label: 'Settings', description: 'Preferences and configuration', href: '/settings', type: 'page' },
];

interface CommandPaletteContextType {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextType>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // ⌘K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, close, isOpen }}>
      {children}
      {isOpen && <CommandPaletteModal onClose={close} />}
    </CommandPaletteContext.Provider>
  );
}

function CommandPaletteModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build search results
  const results: SearchItem[] = (() => {
    if (!query.trim()) return NAV_ITEMS.slice(0, 8);
    const q = query.toLowerCase().trim();

    // Check if it looks like a time query
    const timePatterns = [
      { re: /sleep (last|this) (month|week)/i, label: 'Sleep last month', id: 'q-sleep' },
      { re: /(steps|step count) (last|this) (month|week)/i, label: 'Steps this week', id: 'q-steps' },
      { re: /(heart rate|hrv|rhr) (last|this) (month|week)/i, label: 'Heart rate trends', id: 'q-hr' },
    ];
    for (const tp of timePatterns) {
      if (tp.re.test(q)) {
        return [{ id: tp.id, label: tp.label, description: 'View in AI Analyst', href: `/analyst?q=${encodeURIComponent(q)}`, type: 'query' }];
      }
    }

    // If long, route to analyst
    if (q.length > 40) {
      return [{ id: 'q-analyst', label: query, description: 'Ask AI Analyst', href: `/analyst?q=${encodeURIComponent(query)}`, type: 'query' }];
    }

    const matches: SearchItem[] = [];

    // Search metrics by name + aliases
    const metricMatches = searchMetrics(q);
    for (const m of metricMatches) {
      matches.push({
        id: `m-${m.id}`,
        label: m.displayName,
        description: `${m.canonicalUnit}`,
        href: `/metric/${m.id}`,
        type: 'metric',
      });
    }

    // Search the lab analyte registry, so a name the Lab page renders is never
    // reported as missing here.
    for (const destination of searchLabAnalytes(q)) {
      matches.push(destination);
    }

    // Search nav pages
    for (const item of NAV_ITEMS) {
      if (item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)) {
        if (!matches.find(m => m.href === item.href)) {
          matches.push(item);
        }
      }
    }

    return matches.slice(0, 10);
  })();

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        window.location.href = results[selectedIndex].href;
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[560px] bg-surface border border-border rounded-card shadow-lg overflow-hidden" style={{ borderRadius: '16px' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={18} className="text-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search your health data…"
            className="flex-1 bg-transparent border-none outline-none text-text-primary text-[15px] placeholder:text-text-secondary"
            aria-label="Search"
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-muted text-text-secondary transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-text-secondary text-sm">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((item, i) => (
              <a
                key={item.id}
                href={item.href}
                onClick={e => {
                  e.preventDefault();
                  window.location.href = item.href;
                  onClose();
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-accent-tint text-primary'
                    : 'hover:bg-surface-muted text-text-primary'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{item.label}</div>
                  <div className={`text-xs ${i === selectedIndex ? 'opacity-80' : 'text-text-secondary'}`}>
                    {item.description}
                  </div>
                </div>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  item.type === 'metric' ? 'bg-surface-muted' :
                  item.type === 'query' ? 'bg-accent-tint text-primary' :
                  item.type === 'lab' ? 'bg-accent-tint text-primary' :
                  'bg-surface-muted'
                }`}>
                  {item.type}
                </span>
              </a>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-text-secondary">
          <span className="flex items-center gap-1"><Command size={12} />K Open</span>
          <span className="flex items-center gap-1">↑↓ Navigate</span>
          <span className="flex items-center gap-1">↵ Open</span>
          <span className="flex items-center gap-1 ml-auto">Esc Close</span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, loadPreferences, savePreferences, type ThemeMode } from '@/lib/prefs';

/**
 * Compact theme control for the sidebar footer (SPEC §4).
 * Persists through the same preference store used by the Settings page.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>('system');

  useEffect(() => {
    setTheme(loadPreferences().theme);
  }, []);

  const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        const prefs = loadPreferences();
        savePreferences({ ...prefs, theme: next });
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-muted transition-colors min-h-[40px]"
    >
      {theme === 'dark' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
      <span>{theme === 'dark' ? 'Dark theme' : 'Light theme'}</span>
    </button>
  );
}
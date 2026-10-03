'use client';

// The colour scheme actually on screen. The theme engine resolves "system" and
// sets the `dark` class on <html> (see src/lib/prefs/index.ts); watching that
// class follows every route there, including a change made in Settings.

import { useEffect, useState } from 'react';

export type Scheme = 'light' | 'dark';

function read(): Scheme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useColorScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>('light');
  useEffect(() => {
    setScheme(read());
    const mo = new MutationObserver(() => setScheme(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return scheme;
}

// ── The shell paints first; pages wait for the dataset, Settings does not ────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/activity' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams('tab=connections'),
}));
// The shell itself is not under test: it only has to render what it is given.
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children, setupMode }: { children: unknown; setupMode: boolean }) =>
    createElement('div', { 'data-setup-mode': String(setupMode) }, children as never),
}));

import { DatasetStream, type DatasetStreamProps, type LayoutData } from './DatasetStream';
import { useDatasetReady } from './DatasetProvider';

function Page() {
  return createElement('p', null, `page ready=${useDatasetReady()}`);
}

const PROFILE = { name: '', timezone: 'UTC' } as never;
const DEMO: LayoutData = { mode: 'demo', dataset: null, meta: null, failure: null };

/** A promise React can read synchronously, as it is once it has settled. */
function settled(value: LayoutData): Promise<LayoutData> {
  return Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
}

const render = (data: Promise<LayoutData>, initialSetupMode = false) =>
  renderToStaticMarkup(
    createElement(
      DatasetStream,
      { data, initialSetupMode, profile: PROFILE, profileStored: false, initialPrefs: null } as unknown as DatasetStreamProps,
      createElement(Page)
    )
  );

describe('DatasetStream', () => {
  it('shows the shell and a loading state, not the page, while the data is on its way', () => {
    nav.pathname = '/activity';
    const html = render(new Promise<LayoutData>(() => {}));
    expect(html).toContain('Loading your health data…');
    expect(html).not.toContain('page ready');
    expect(html).toContain('data-setup-mode="false"');
  });

  it('renders Settings at once, with the dataset marked not ready', () => {
    nav.pathname = '/settings';
    const html = render(new Promise<LayoutData>(() => {}));
    expect(html).toContain('page ready=false');
    expect(html).not.toContain('Loading your health data…');
  });

  it('renders the page with the dataset ready once it is here', () => {
    nav.pathname = '/activity';
    const html = render(settled(DEMO));
    expect(html).toContain('page ready=true');
    expect(html).not.toContain('Loading your health data…');
  });

  it('starts the shell in setup mode when it is already known that no source is connected', () => {
    nav.pathname = '/settings';
    expect(render(new Promise<LayoutData>(() => {}), true)).toContain('data-setup-mode="true"');
  });
});

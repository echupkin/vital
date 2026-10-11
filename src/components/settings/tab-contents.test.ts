// ── Which section renders on which Settings tab ─────────────────────────────

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETUP_TARGET } from '@/components/data/LiveGate';
import { resolveTab } from './tabs';

const read = (file: string) => readFileSync(join(process.cwd(), 'src', file), 'utf8');
const sources = read('components/settings/SourcesTab.tsx');
const connections = read('components/settings/ConnectionsTab.tsx');
const page = read('app/settings/page.tsx');

describe('Sources tab', () => {
  it('holds every connection, in order', () => {
    const order = ['<HaeConnection', '<OuraConnection', '<WorkoutSources', '<MapProvidersCard'].map(s => sources.indexOf(s));
    expect(order.every(i => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('holds no data pipeline and no data quality', () => {
    expect(sources).not.toMatch(/Data pipeline|DataQualitySection/);
  });
});

describe('Connections tab', () => {
  it('holds the data pipeline with its data quality, and nothing else', () => {
    expect(connections).toContain('title="Data pipeline"');
    expect(connections).toContain('<DataQualitySection report={report} onReady={refreshDataset} checkKey={loads} />');
    expect(connections).not.toMatch(/<HaeConnection|<OuraConnection|<WorkoutSources|<MapProvidersCard/);
  });
});

describe('Settings page', () => {
  it('renders each tab component from its own tab id', () => {
    expect(page).toContain("tab === 'sources' && <SourcesTab />");
    expect(page).toContain("tab === 'connections' && <ConnectionsTab />");
  });

  it('shows the setup banner above the tabs', () => {
    expect(page.indexOf('<SetupBanner />')).toBeGreaterThan(0);
    expect(page.indexOf('<SetupBanner />')).toBeLessThan(page.indexOf('<Tabs '));
  });

  it('setup mode redirects to the Sources tab', () => {
    expect(SETUP_TARGET).toBe('/settings?tab=sources');
    expect(resolveTab('sources')).toBe('sources');
  });
});

// ── Workout sources section: one card per source, keyed off the source id ────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PipelineStatusReport } from '@/lib/pipeline/types';
import type { WorkoutSourceStatus } from '@/lib/workout-sources/types';
import { WorkoutSources } from './WorkoutSources';

const SOURCE: WorkoutSourceStatus = {
  id: 'hevy',
  displayName: 'Hevy',
  configured: true,
  host: 'hevy-sample.invalid',
  origin: 'live',
  sessions: 2,
  lastSyncAt: null,
  newestSessionAt: null,
  lastError: null,
};

function render(sources: WorkoutSourceStatus[] | null): string {
  const report = sources ? ({ workoutSources: sources } as PipelineStatusReport) : null;
  const heading = (kind: string, title: string) => createElement('h2', { 'data-kind': kind }, title);
  return renderToStaticMarkup(createElement(WorkoutSources, { report, heading }));
}

const cards = (html: string) => html.match(/data-workout-source="[^"]*"/g) ?? [];

describe('Workout sources section', () => {
  it('Hevy gets exactly one card, with its own form (no second Hevy card)', () => {
    const html = render([SOURCE]);
    expect(cards(html)).toEqual(['data-workout-source="hevy"']);
    expect(html.match(/>Hevy</g)).toHaveLength(1);
    expect(html).toContain('data-kind="section"');
  });

  it('a source with no connection form shows its sync line alone', () => {
    const html = render([{ ...SOURCE, id: 'sample-source', displayName: 'Sample source' }]);
    expect(html).toContain('Sample source');
    expect(html).toContain('Connected (hevy-sample.invalid) · 2 sessions');
  });

  it('demo mode keeps the demo sessions text and no form', () => {
    const html = render([{ ...SOURCE, configured: false, origin: 'demo', sessions: 7 }]);
    expect(html).toContain('Demo sessions (7)');
    expect(html).not.toContain('data-state=');
  });

  it('an empty report says so; a loading report renders no cards', () => {
    expect(render([])).toContain('No workout source was checked.');
    const loading = render(null);
    expect(cards(loading)).toEqual([]);
    expect(loading).not.toContain('No workout source was checked.');
  });
});

describe('Workout sources while they are being checked', () => {
  it('shows a Checking… card, not "No workout source was checked"', () => {
    const report = { workoutSources: [], pending: ['workouts'] } as unknown as PipelineStatusReport;
    const html = renderToStaticMarkup(createElement(WorkoutSources, { report, heading: (_k: string, t: string) => t }));
    expect(html).toContain('Checking…');
    expect(html).not.toContain('No workout source was checked');
  });
});

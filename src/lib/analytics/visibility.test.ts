// ── Owner request 2: no data, no box ────────────────────
//
// The shared rule is: a metric-derived box renders only when the metric has at
// least one observation in the window that box is showing. Zero observations
// means no box at all — no empty shell, no "0", no placeholder — and a panel
// whose whole content disappears loses its heading too.
//
// These tests exercise the rule at both levels:
//   * the pure predicate every page uses (`hasObservationsInWindow`,
//     `visibleSummaries`), and
//   * an actual server render of the real `SeriesCard`: a metric with zero
//     observations in the window produces no markup, and one with data does.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY, seriesInWindow } from '@/lib/adapters/dataset';
import { buildSeriesSummary, trailingWindow } from '@/lib/analytics';
import { SeriesCard, hasObservationsInWindow, visibleSummaries } from '@/components/domain/DomainShared';

/** Registered in the registry, absent from the dataset entirely. */
const ABSENT_METRIC = 'waist_circumference';
/** Present in the dataset with a daily series. */
const PRESENT_METRIC = 'resting_heart_rate';

const DAYS = 30;

describe('the shared "render only when there is data" rule', () => {
  it('reports no observations in the window for a metric the dataset does not carry', () => {
    const win = trailingWindow(REFERENCE_KEY, DAYS);
    expect(hasObservationsInWindow(ABSENT_METRIC, win)).toBe(false);
    expect(seriesInWindow(ABSENT_METRIC, win)).toHaveLength(0);
  });

  it('reports observations for a metric that does carry data', () => {
    const win = trailingWindow(REFERENCE_KEY, DAYS);
    expect(hasObservationsInWindow(PRESENT_METRIC, win)).toBe(true);
    expect(seriesInWindow(PRESENT_METRIC, win).length).toBeGreaterThan(0);
  });

  it('drops the summary of a metric with no point in the window and keeps the rest', () => {
    const summaries = [ABSENT_METRIC, PRESENT_METRIC].map(id =>
      buildSeriesSummary(id, REFERENCE_KEY, DAYS, 'metric')
    );
    expect(summaries.map(s => s.metricId)).toEqual([ABSENT_METRIC, PRESENT_METRIC]);
    expect(summaries[0].points).toHaveLength(0);

    const visible = visibleSummaries(summaries);
    expect(visible.map(s => s.metricId)).toEqual([PRESENT_METRIC]);
  });
});

describe('a metric card with zero observations renders nothing', () => {
  it('renders no markup at all for a metric with no observation in the window', () => {
    const summary = buildSeriesSummary(ABSENT_METRIC, REFERENCE_KEY, DAYS, 'metric');
    expect(summary.points).toHaveLength(0);

    const html = renderToStaticMarkup(
      React.createElement(SeriesCard, { summary, days: DAYS })
    );
    expect(html).toBe('');
    // No shell, no zero, no "No data"/"Not recorded" placeholder either.
    expect(html).not.toContain('No data');
    expect(html).not.toContain('Not recorded');
    expect(html).not.toContain('0');
  });

  it('renders the card when the metric does have an observation in the window', () => {
    const summary = buildSeriesSummary(PRESENT_METRIC, REFERENCE_KEY, DAYS, 'metric');
    expect(summary.points.length).toBeGreaterThan(0);

    const html = renderToStaticMarkup(
      React.createElement(SeriesCard, { summary, days: DAYS })
    );
    expect(html).not.toBe('');
    expect(html).toContain(summary.metricName);
    // The card links to the metric's real detail route.
    expect(html).toContain(`/metric/${PRESENT_METRIC}`);
  });
});

// ── The chart renders ONE observation and MANY through the same figure ───────
//
// The Lab chart must draw a single observation as a dot and NOTHING ELSE: a line
// between one point and nothing would assert movement that was never measured.
// This is asserted on the RENDERED MARKUP, not by reading the code, so a change
// of charting library or props that reintroduced a line for one point would fail
// here. recharts measures its container, which a server render cannot do, so the
// container is given a fixed size below.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LabChartModel, LabPoint } from '@/lib/lab/view';
import { LabChart } from './LabChart';

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    // In the browser this measures its box with a ResizeObserver; during a server
    // render it paints nothing. A fixed size lets the chart paint so the markup
    // below can be asserted.
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 640, height: 280 } as never),
  };
});

/** One numeric observation, with the interval it was scored against. */
function point(id: string, on: string, value: number): LabPoint {
  return {
    resultId: id,
    reportId: 'doc-1',
    resultOn: on,
    value,
    valueText: null,
    unit: 'mg/dL',
    printedFlag: null,
    interval: { low: 65, high: 99, origin: 'report', refText: '65-99 mg/dL', refBasis: null, bandNote: null, band: null },
    status: 'in_range',
    statusLabel: 'In range',
    tone: 'good',
    notes: [],
    extractionMethod: 'deterministic',
  };
}

const BAND: LabChartModel['band'] = {
  low: 65,
  high: 99,
  text: '65-99 mg/dL',
  origin: 'report',
  provenance: 'printed on your report',
  source: 'printed on the report',
};

function model(numeric: LabPoint[]): LabChartModel {
  return { mode: 'trend', numeric, readings: [], band: BAND, bandVaries: false, unit: 'mg/dL' };
}

/** Every `<circle>` the chart drew — the observation dots. */
function dots(html: string): string[] {
  return html.match(/<circle\b/g) ?? [];
}

/** The Line's own curve path. Absent exactly when there is no line to draw. */
function lineCurves(html: string): string[] {
  return html.match(/class="recharts-curve recharts-line-curve"/g) ?? [];
}

function render(m: LabChartModel): string {
  return renderToStaticMarkup(
    React.createElement(LabChart, { analyteName: 'Glucose', model: m, height: 200, domain: [60, 105] })
  );
}

describe('a single-observation series', () => {
  const html = render(model([point('p1', '2024-01-01', 78)]));

  it('draws exactly one dot and NO line path', () => {
    expect(dots(html)).toHaveLength(1);
    expect(lineCurves(html)).toHaveLength(0);
  });

  it('shows the one observation date stamp on the axis and the unit on the y axis', () => {
    expect(html).toContain('Jan 1');
    expect(html).toContain('mg/dL');
  });

  it('keeps the accessible chrome and says there is no trend to draw', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('One observation, so there is no trend to draw');
  });
});

describe('a multi-observation series', () => {
  const html = render(model([point('p1', '2024-01-01', 78), point('p2', '2024-02-01', 90), point('p3', '2024-03-01', 88)]));

  it('draws a line path and one dot per observation', () => {
    expect(lineCurves(html)).toHaveLength(1);
    expect(dots(html)).toHaveLength(3);
  });

  it('never claims a single observation', () => {
    expect(html).not.toContain('there is no trend to draw');
  });
});

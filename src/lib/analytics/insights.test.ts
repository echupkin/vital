import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY, seriesInWindow } from '@/lib/adapters/dataset';
import { formatMetricWithUnit } from '@/lib/metrics/format';
import { windowRangeLabel } from '@/lib/analytics/windows';
import {
  compareWindows,
  generateInsights,
  insightCounts,
  filterInsights,
  MIN_ASSOCIATION_STRENGTH,
  MIN_INSIGHT_CHANGE_PERCENT,
  MIN_INSIGHT_OBSERVATIONS,
} from '@/lib/analytics';
import { ASSOCIATION_NOTE, MIN_PAIRED_OBSERVATIONS } from '@/lib/analytics/relationships';

describe('insight generation (SPEC §7)', () => {
  const insights = generateInsights(REFERENCE_KEY);

  it('produces at least one observation from the dataset', () => {
    expect(insights.length).toBeGreaterThan(0);
  });

  it('is deterministic across calls', () => {
    const again = generateInsights(REFERENCE_KEY);
    expect(again.map(i => [i.id, i.title, i.summary])).toEqual(insights.map(i => [i.id, i.title, i.summary]));
  });

  it('cites metric, window, aggregation and coverage on every card', () => {
    for (const insight of insights) {
      expect(insight.metricId).toBeTruthy();
      expect(insight.windowLabel).toBeTruthy();
      expect(insight.coverage).toBeTruthy();
      expect(insight.computed.length).toBeGreaterThan(0);
      for (const ev of insight.evidence) {
        expect(ev.metricId).toBeTruthy();
        expect(ev.windowLabel).toBeTruthy();
        expect(ev.aggregation).toBeTruthy();
        expect(ev.coverage).toBeTruthy();
        expect(ev.href).toMatch(/^\/metric\/|^\/trends|^\/insights/);
      }
      expect(insight.href).toMatch(/^\/metric\/|^\/trends|^\/insights/);
    }
  });

  it('only emits a change or trend insight with enough observations on both sides', () => {
    for (const insight of insights.filter(i => i.kind === 'change' || i.kind === 'trend')) {
      const days = insight.kind === 'change' ? 7 : 90;
      const cmp = compareWindows(insight.metricId, REFERENCE_KEY, days);
      expect(cmp.counts.evaluated).toBeGreaterThanOrEqual(MIN_INSIGHT_OBSERVATIONS);
      expect(cmp.counts.baseline).toBeGreaterThanOrEqual(MIN_INSIGHT_OBSERVATIONS);
      if (insight.kind === 'change') {
        expect(Math.abs(cmp.comparison.deltaPercent as number)).toBeGreaterThanOrEqual(MIN_INSIGHT_CHANGE_PERCENT);
      }
    }
  });

  it('keeps every cited change insight consistent with a fresh computation', () => {
    const change = insights.filter(i => i.kind === 'change');
    expect(change.length).toBeGreaterThan(0);
    for (const insight of change) {
      const cmp = compareWindows(insight.metricId, REFERENCE_KEY, 7);
      const expected = formatMetricWithUnit(insight.metricId, cmp.comparison.current, 'metric');
      expect(insight.computed).toContain(`This period: ${expected}`);
      expect(insight.detail).toContain(windowRangeLabel(cmp.evaluatedWindow));
      expect(insight.detail).toContain(windowRangeLabel(cmp.baselineWindow));
    }
  });

  it('carries a bounded chart series rather than the whole record set', () => {
    for (const insight of insights) {
      expect(insight.points.length).toBeLessThanOrEqual(90);
    }
  });

  it('only emits an association with enough paired days, and never claims causation', () => {
    const associations = insights.filter(i => i.kind === 'association');
    for (const insight of associations) {
      expect(insight.coverage).toMatch(/\d+ paired days/);
      const paired = Number(/(\d+) paired days/.exec(insight.coverage)?.[1] ?? '0');
      expect(paired).toBeGreaterThanOrEqual(MIN_PAIRED_OBSERVATIONS);
      expect(insight.caveat).toBe(ASSOCIATION_NOTE);
      expect(insight.caveat).toContain('does not establish causation');
    }
  });

  it('gates an observation entirely when the evidence is too thin', () => {
    // A one-day window cannot satisfy the coverage gate, so nothing is emitted.
    const tiny = compareWindows('sleep_analysis', REFERENCE_KEY, 1);
    expect(tiny.counts.evaluated).toBeLessThan(MIN_INSIGHT_OBSERVATIONS);
    const singleDay = generateInsights(REFERENCE_KEY).filter(
      i => i.kind === 'change' && i.metricId === 'sleep_analysis' && i.windowLabel.includes('1 day')
    );
    expect(singleDay).toEqual([]);
  });

  it('counts and filters by kind without losing any card', () => {
    const counts = insightCounts(insights);
    expect(counts.all).toBe(insights.length);
    const sumOfKinds = counts.change + counts.trend + counts.association + counts.report;
    expect(sumOfKinds).toBe(counts.all);
    expect(filterInsights(insights, 'all')).toHaveLength(insights.length);
    expect(filterInsights(insights, 'association')).toEqual(insights.filter(i => i.kind === 'association'));
  });

  it('never states a raw float in a generated sentence', () => {
    for (const insight of insights) {
      // A bare three-decimal number would mean a figure bypassed the formatter.
      expect(insight.title).not.toMatch(/\d\.\d{3}/);
      expect(insight.summary).not.toMatch(/\d\.\d{3}/);
      expect(insight.detail).not.toMatch(/\d\.\d{3}/);
    }
  });

  it('uses the dataset for its window bounds', () => {
    for (const insight of insights) {
      const days = insight.kind === 'change' ? 7 : 90;
      const cmp = compareWindows(insight.metricId, REFERENCE_KEY, days);
      expect(seriesInWindow(insight.metricId, cmp.evaluatedWindow).length).toBe(cmp.counts.evaluated);
    }
  });
});

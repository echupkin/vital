// ── Silencing data-quality findings: the pure rule ──────────────────────────

import { describe, expect, it } from 'vitest';
import type { DataQualityReport, QualityCheckId, QualityFinding } from './quality';
import { QUALITY_CHECK_LABEL } from './quality';
import { applySilenced, validateSilenceInput } from './quality-silenced';

function finding(over: Partial<QualityFinding> & Pick<QualityFinding, 'check'>): QualityFinding {
  return {
    severity: 'warning',
    title: `Title of ${over.check}`,
    detail: 'Detail.',
    metrics: [],
    ranges: [],
    affectedDays: 0,
    remedy: ['Step one.'],
    ...over,
  };
}

const MISSING = finding({
  check: 'missing-days',
  severity: 'problem',
  metrics: ['step_count', 'active_energy'],
  ranges: [
    { from: '2026-09-20', to: '2026-09-22', days: 3 },
    { from: '2026-09-01', to: '2026-09-02', days: 2 },
  ],
  affectedDays: 5,
});
const STALE = finding({ check: 'stale', severity: 'problem', affectedDays: 2 });
const LATE_ENERGY = finding({
  check: 'late-start',
  severity: 'info',
  title: 'The food log starts late',
  metrics: ['dietary_energy'],
  ranges: [{ from: '2026-01-01', to: '2026-02-09', days: 40 }],
  affectedDays: 40,
});
const LATE_STEPS = finding({
  check: 'late-start',
  severity: 'warning',
  metrics: ['step_count'],
  ranges: [{ from: '2026-01-01', to: '2026-01-20', days: 20 }],
  affectedDays: 20,
});

function report(findings: QualityFinding[]): DataQualityReport {
  const ids = Object.keys(QUALITY_CHECK_LABEL) as QualityCheckId[];
  return {
    findings,
    checks: ids.map(id => {
      const own = findings.filter(f => f.check === id);
      return {
        id,
        label: QUALITY_CHECK_LABEL[id],
        outcome: own.length === 0 ? 'pass' : own.every(f => f.severity === 'info') ? 'note' : 'flagged',
        summary: own.length === 0 ? 'Fine.' : `${id} summary`,
      };
    }),
  };
}

describe('applySilenced', () => {
  it('returns the report unchanged and an empty list when nothing is silenced', () => {
    const r = report([MISSING, STALE]);
    const out = applySilenced(r, []);
    expect(out.report).toEqual(r);
    expect(out.silenced).toEqual([]);
  });

  it('hides a silenced finding and keeps the others, in order', () => {
    const out = applySilenced(report([MISSING, STALE]), [{ checkId: 'stale', metricId: '' }]);
    expect(out.report.findings.map(f => f.check)).toEqual(['missing-days']);
    expect(out.report.checks.find(c => c.id === 'stale')).toMatchObject({ outcome: 'pass' });
    expect(out.report.checks.find(c => c.id === 'missing-days')).toMatchObject({ outcome: 'flagged' });
  });

  it('does not mutate its input', () => {
    const r = report([MISSING, STALE]);
    const before = JSON.stringify(r);
    applySilenced(r, [{ checkId: 'stale', metricId: '' }]);
    expect(JSON.stringify(r)).toBe(before);
  });

  it('silences a per-metric finding by check and metric only', () => {
    const out = applySilenced(report([LATE_ENERGY, LATE_STEPS]), [{ checkId: 'late-start', metricId: 'dietary_energy' }]);
    expect(out.report.findings).toEqual([LATE_STEPS]);
    expect(out.silenced).toHaveLength(1);
    expect(out.silenced[0]).toMatchObject({ checkId: 'late-start', metricId: 'dietary_energy' });
  });

  it('rebuilds the summary and outcome of a check that is only partly silenced', () => {
    const out = applySilenced(report([LATE_ENERGY, LATE_STEPS]), [{ checkId: 'late-start', metricId: 'step_count' }]);
    const check = out.report.checks.find(c => c.id === 'late-start')!;
    expect(check.outcome).toBe('note');
    expect(check.summary).toContain('Calories (dietary)');
    expect(check.summary).not.toContain('Steps');
    expect(check.summary).toMatch(/starts well after your other data\.$/);
  });

  it('a metric silence does not hide the same check on another metric, nor another check on the same metric', () => {
    const out = applySilenced(report([LATE_STEPS, MISSING]), [{ checkId: 'late-start', metricId: 'dietary_energy' }]);
    expect(out.report.findings).toEqual([LATE_STEPS, MISSING]);
  });

  it('an aggregated finding is silenced by its check alone, whichever metrics it covers today', () => {
    const narrower = finding({ ...MISSING, metrics: ['step_count'] });
    expect(applySilenced(report([MISSING]), [{ checkId: 'missing-days', metricId: '' }]).report.findings).toEqual([]);
    expect(applySilenced(report([narrower]), [{ checkId: 'missing-days', metricId: '' }]).report.findings).toEqual([]);
  });

  it('reports first and last seen day over all ranges, newest first or not', () => {
    const out = applySilenced(report([MISSING]), [{ checkId: 'missing-days', metricId: '' }]);
    expect(out.silenced[0]).toMatchObject({ firstDay: '2026-09-01', lastDay: '2026-09-22', found: true, title: MISSING.title });
    expect(out.silenced[0].metricLabel).toMatch(/\S/);
  });

  it('keeps hiding a recurrence: days that appear later fall under the same silence', () => {
    const silenced = [{ checkId: 'missing-days' as const, metricId: '' }];
    const later = finding({ ...MISSING, ranges: [{ from: '2026-10-01', to: '2026-10-04', days: 4 }, ...MISSING.ranges], affectedDays: 9 });
    const out = applySilenced(report([later]), silenced);
    expect(out.report.findings).toEqual([]);
    expect(out.silenced[0]).toMatchObject({ firstDay: '2026-09-01', lastDay: '2026-10-04' });
  });

  it('lists a silence that matches nothing today, so it can still be restored', () => {
    const out = applySilenced(report([STALE]), [{ checkId: 'late-start', metricId: 'step_count' }]);
    expect(out.report.findings).toEqual([STALE]);
    expect(out.silenced).toEqual([
      expect.objectContaining({ checkId: 'late-start', metricId: 'step_count', found: false, firstDay: null, lastDay: null, severity: null }),
    ]);
  });

  it('a finding without days (stalled automation) reports no day range', () => {
    const out = applySilenced(report([STALE]), [{ checkId: 'stale', metricId: '' }]);
    expect(out.silenced[0]).toMatchObject({ found: true, firstDay: null, lastDay: null });
  });

  it('leaves a clean report when everything is silenced: no findings, every check passes', () => {
    const out = applySilenced(report([MISSING, STALE, LATE_ENERGY]), [
      { checkId: 'missing-days', metricId: '' },
      { checkId: 'stale', metricId: '' },
      { checkId: 'late-start', metricId: 'dietary_energy' },
    ]);
    expect(out.report.findings).toEqual([]);
    expect(out.report.checks.every(c => c.outcome === 'pass')).toBe(true);
    expect(out.silenced).toHaveLength(3);
  });

  it('ignores a key twice over', () => {
    const k = { checkId: 'stale' as const, metricId: '' };
    expect(applySilenced(report([STALE]), [k, k]).silenced).toHaveLength(1);
  });
});

describe('applySilenced and corrected checks', () => {
  const OVERLAP = finding({ check: 'overlapping-exports', severity: 'problem', correctable: true, metrics: ['step_count'] });

  it('leaves out a silence on a check Vital is correcting: there is nothing to hide', () => {
    const base = report([STALE]);
    const corrected: DataQualityReport = {
      ...base,
      checks: base.checks.map(c => (c.id === 'overlapping-exports' ? { ...c, outcome: 'corrected' as const, summary: 'Corrected by Vital.' } : c)),
    };
    const { report: shown, silenced } = applySilenced(corrected, [{ checkId: 'overlapping-exports', metricId: '' }]);
    expect(silenced).toEqual([]);
    expect(shown.checks.find(c => c.id === 'overlapping-exports')).toMatchObject({ outcome: 'corrected', summary: 'Corrected by Vital.' });
  });

  it('still hides the finding when the correction is off, and lists it as found', () => {
    const { report: shown, silenced } = applySilenced(report([OVERLAP]), [{ checkId: 'overlapping-exports', metricId: '' }]);
    expect(shown.findings).toEqual([]);
    expect(silenced).toEqual([expect.objectContaining({ checkId: 'overlapping-exports', found: true })]);
  });
});

describe('validateSilenceInput', () => {
  it('accepts a known check without a metric as the empty metric id', () => {
    expect(validateSilenceInput({ checkId: 'stale' })).toEqual({ ok: true, key: { checkId: 'stale', metricId: '' } });
    expect(validateSilenceInput({ checkId: 'stale', metricId: '' })).toEqual({ ok: true, key: { checkId: 'stale', metricId: '' } });
  });

  it('accepts a registered metric for a per-metric check', () => {
    expect(validateSilenceInput({ checkId: 'late-start', metricId: 'dietary_energy' })).toEqual({
      ok: true,
      key: { checkId: 'late-start', metricId: 'dietary_energy' },
    });
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['unknown check', { checkId: 'nope' }],
    ['missing check', {}],
    ['non-string check', { checkId: 3 }],
    ['unregistered metric', { checkId: 'late-start', metricId: 'not_a_metric' }],
    ['non-string metric', { checkId: 'late-start', metricId: 4 }],
    ['per-metric check without a metric', { checkId: 'late-start' }],
    ['a metric on a check that is not per metric', { checkId: 'missing-days', metricId: 'step_count' }],
    ['unknown field', { checkId: 'stale', day: '2026-01-01' }],
  ])('rejects %s', (_name, body) => {
    const out = validateSilenceInput(body);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/\S/);
  });
});

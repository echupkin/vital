// ── The data_quality stage and report read the same silencing ────────────────

import { describe, expect, it } from 'vitest';
import { resolvePipelineStatus, qualityStage } from '@/lib/pipeline/status';
import { applySilenced } from '@/lib/adapters/quality-silenced';
import { QUALITY_CHECK_LABEL, type DataQualityReport, type QualityJob } from '@/lib/adapters/quality';
import type { PipelineDatasetSummary } from '@/lib/pipeline/types';

const SUMMARY: PipelineDatasetSummary = {
  source: 'live', observationCount: 12, metricCount: 3, workouts: 0, referenceKey: '2026-09-17',
  windowStartKey: '2026-09-01', timezone: 'UTC', lastObservationAt: '2026-09-17T06:00:00.000Z', error: null,
};

const REPORT: DataQualityReport = {
  checks: [
    { id: 'stale', label: QUALITY_CHECK_LABEL.stale, outcome: 'flagged', summary: 'Nothing new for 40 hours.' },
    { id: 'missing-days', label: QUALITY_CHECK_LABEL['missing-days'], outcome: 'flagged', summary: '3 days missing.' },
    { id: 'late-start', label: QUALITY_CHECK_LABEL['late-start'], outcome: 'note', summary: 'Calories (dietary) starts well after your other data.' },
  ],
  findings: [
    { check: 'stale', severity: 'problem', title: 'No new data is arriving', detail: 'Old.', metrics: [], ranges: [], affectedDays: 1, remedy: ['x'] },
    {
      check: 'missing-days', severity: 'warning', title: 'Days are missing from the export', detail: 'Gaps.', metrics: ['step_count'],
      ranges: [{ from: '2026-09-01', to: '2026-09-03', days: 3 }], affectedDays: 3, remedy: ['y'],
    },
    {
      check: 'late-start', severity: 'info', title: 'The food log starts late', detail: 'Late.', metrics: ['dietary_energy'],
      ranges: [{ from: '2026-01-01', to: '2026-02-09', days: 40 }], affectedDays: 40, remedy: ['z'],
    },
  ],
};

const ready = (value: DataQualityReport | null): QualityJob => ({ state: 'ready', value, error: null, promise: Promise.resolve(value) });
const stage = (silenced: Parameters<typeof applySilenced>[1]) => {
  const view = applySilenced(REPORT, silenced);
  return qualityStage(ready(REPORT), 'live', SUMMARY, view);
};

describe('qualityStage with silenced findings', () => {
  it('counts every finding when nothing is silenced', () => {
    const s = stage([]);
    expect(s.status).toBe('degraded');
    expect(s.detail).toContain('2 findings to fix');
    expect(s.detail).toContain('Also 1 note.');
  });

  it('counts the findings and notes left after silencing, not before', () => {
    const s = stage([{ checkId: 'stale', metricId: '' }]);
    expect(s.status).toBe('degraded');
    expect(s.detail).toContain('1 finding to fix: days are missing from the export.');
    expect(s.detail).not.toContain('no new data');
    expect(s.derivedFrom).toContain('(1 flagged)');
  });

  it('drops a silenced note from the note count', () => {
    const s = stage([{ checkId: 'late-start', metricId: 'dietary_energy' }]);
    expect(s.detail).toContain('2 findings to fix');
    expect(s.detail).not.toContain('note');
  });

  it('reads healthy and clean when every finding is silenced, never unknown', () => {
    const s = stage([
      { checkId: 'stale', metricId: '' },
      { checkId: 'missing-days', metricId: '' },
      { checkId: 'late-start', metricId: 'dietary_energy' },
    ]);
    expect(s.status).toBe('healthy');
    expect(s.detail).toContain('No data-quality problems found');
    expect(s.detail).toContain('3 issues are silenced');
    expect(s.derivedFrom).toContain('(0 flagged)');
  });

  it('is healthy when only notes are left', () => {
    const s = stage([{ checkId: 'stale', metricId: '' }, { checkId: 'missing-days', metricId: '' }]);
    expect(s.status).toBe('healthy');
    expect(s.detail).toContain('1 note');
  });

  it('a silence that matches nothing today changes neither the status nor the text', () => {
    const base = qualityStage(ready(REPORT), 'live', SUMMARY, applySilenced(REPORT, []));
    const s = stage([{ checkId: 'late-start', metricId: 'step_count' }]);
    expect(s).toEqual(base);
  });

  it('says checking while the checks are still running, silenced or not', () => {
    const view = applySilenced(REPORT, [{ checkId: 'stale', metricId: '' }]);
    const job: QualityJob = { state: 'computing', value: null, error: null, promise: Promise.resolve(null) };
    expect(qualityStage(job, 'live', SUMMARY, view).status).toBe('checking');
  });

  it('says unknown, not checking, when the checks failed', () => {
    const job: QualityJob = { state: 'failed', value: null, error: 'boom', promise: Promise.resolve(null) };
    const s = qualityStage(job, 'live', SUMMARY, null);
    expect(s.status).toBe('unknown');
    expect(s.detail).toContain('boom');
  });
});

describe('resolvePipelineStatus and silenced findings', () => {
  const run = (silenced: Parameters<typeof applySilenced>[1]) =>
    resolvePipelineStatus({ env: {} as NodeJS.ProcessEnv, now: () => 0, skipDataset: true, qualityJob: ready(REPORT), silenced });

  it('serves the same report and stage as the quality route would: silenced findings gone everywhere', async () => {
    const report = await run([{ checkId: 'stale', metricId: '' }]);
    expect(report.quality!.findings.map(f => f.check)).toEqual(['missing-days', 'late-start']);
    expect(report.silenced).toEqual([expect.objectContaining({ checkId: 'stale', found: true })]);
    const s = report.stages.find(x => x.id === 'data_quality')!;
    expect(s.detail).toContain('1 finding to fix');
  });

  it('serves no silenced list when nothing is silenced', async () => {
    const report = await run([]);
    expect(report.silenced).toEqual([]);
    expect(report.quality!.findings).toHaveLength(3);
  });

  it('shows the all-clear text, not unknown, when every finding is silenced', async () => {
    const report = await run([
      { checkId: 'stale', metricId: '' },
      { checkId: 'missing-days', metricId: '' },
      { checkId: 'late-start', metricId: 'dietary_energy' },
    ]);
    expect(report.stages.find(x => x.id === 'data_quality')!.status).toBe('healthy');
    expect(report.quality!.findings).toEqual([]);
  });
});

describe('qualityStage with corrected checks', () => {
  it('reads healthy and says what Vital corrects', () => {
    const report: DataQualityReport = {
      findings: [],
      checks: [
        { id: 'overlapping-exports', label: QUALITY_CHECK_LABEL['overlapping-exports'], outcome: 'corrected', correcting: true, summary: 'Corrected.' },
        { id: 'duplicate-readings', label: QUALITY_CHECK_LABEL['duplicate-readings'], outcome: 'corrected', correcting: true, summary: 'Corrected.' },
        { id: 'stale', label: QUALITY_CHECK_LABEL.stale, outcome: 'pass', summary: 'Fresh.' },
      ],
    };
    const s = qualityStage(ready(report), 'live', SUMMARY, applySilenced(report, []));
    expect(s.status).toBe('healthy');
    expect(s.detail).toBe('No data-quality problems left to fix. Vital corrects overlapping exports and duplicate readings in its own totals.');
  });
});

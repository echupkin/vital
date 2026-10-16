// ── Data quality: Silence / Restore view states ──────────────────────────────

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QUALITY_CHECK_LABEL, type DataQualityReport, type QualityFinding } from '@/lib/adapters/quality';
import type { SilencedFinding } from '@/lib/adapters/quality-silenced';
import type { PipelineStatusReport } from '@/lib/pipeline/types';
import { DataQualitySection, DataQualityView } from './DataQuality';

const MISSING: QualityFinding = {
  check: 'missing-days', severity: 'warning', title: 'Days are missing from the export', detail: 'Gaps.', metrics: ['step_count'],
  ranges: [{ from: '2026-09-01', to: '2026-09-03', days: 3 }], affectedDays: 3, remedy: ['Run a manual export.'],
};
const LATE: QualityFinding = {
  check: 'late-start', severity: 'info', title: 'The food log starts late', detail: 'Late.', metrics: ['dietary_energy'],
  ranges: [{ from: '2026-01-01', to: '2026-02-09', days: 40 }], affectedDays: 40, remedy: ['Select nutrition.'],
};
const checks = (outcome: 'pass' | 'flagged') =>
  (Object.keys(QUALITY_CHECK_LABEL) as (keyof typeof QUALITY_CHECK_LABEL)[]).map(id => ({ id, label: QUALITY_CHECK_LABEL[id], outcome, summary: 's' }));
const report = (findings: QualityFinding[]): DataQualityReport => ({ checks: checks(findings.length ? 'flagged' : 'pass'), findings });

const SILENCED: SilencedFinding = {
  checkId: 'late-start', checkLabel: QUALITY_CHECK_LABEL['late-start'], metricId: 'dietary_energy', metricLabel: 'Calories (dietary)',
  title: 'The food log starts late', severity: 'info', found: true, firstDay: '2026-01-01', lastDay: '2026-02-09',
};

const view = (r: DataQualityReport, silenced: SilencedFinding[], extra: { busy?: string | null; error?: string | null } = {}) =>
  renderToStaticMarkup(createElement(DataQualityView, { quality: r, silenced, onSilence: () => {}, onRestore: () => {}, ...extra }));

describe('DataQualityView: findings', () => {
  it('gives each finding a Silence button with its one-line explanation, and keeps days and how to fix', () => {
    const html = view(report([MISSING, LATE]), []);
    expect(html.match(/>Silence</g)).toHaveLength(2);
    expect(html.match(/Stop showing this as an issue\. You can restore it below\./g)).toHaveLength(2);
    expect(html).toContain('Affected days');
    expect(html).toContain('How to fix it');
    expect(html).toContain('Run a manual export.');
  });

  it('shows no Silenced issues section when nothing is silenced', () => {
    expect(view(report([MISSING]), [])).not.toContain('Silenced issues');
  });

  it('says that a silence covers every day, including days that show up later', () => {
    expect(view(report([MISSING]), [])).toContain('including days that show up later');
  });

  it('disables the buttons and shows progress while a change is in flight', () => {
    const html = view(report([MISSING]), [], { busy: 'missing-days:' });
    expect(html).toContain('Silencing…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Silencing…/);
  });

  it('shows a failure as an alert', () => {
    const html = view(report([MISSING]), [], { error: 'No Postgres database is configured.' });
    expect(html).toMatch(/role="alert"[^>]*>No Postgres database is configured\./);
  });
});

describe('DataQualityView: silenced issues', () => {
  it('lists the silenced issue in a collapsed section with a count, its days and a Restore button', () => {
    const html = view(report([MISSING]), [SILENCED]);
    expect(html).toContain('Silenced issues (1)');
    expect(html).toMatch(/<details[^>]*data-silenced-issues(?![^>]*\bopen\b)[^>]*>/);
    expect(html).toContain('The food log starts late');
    expect(html).toContain('Calories (dietary)');
    expect(html).toContain('Seen 2026-01-01 to 2026-02-09');
    expect(html).toContain('>Restore<');
  });

  it('reads clean when every finding is silenced: no finding cards, no problem badge', () => {
    const html = view(report([]), [SILENCED]);
    expect(html).toContain('No data-quality problems found');
    expect(html).not.toContain('to fix');
    expect(html).not.toContain('>Silence<');
    expect(html).toContain('Silenced issues (1)');
  });

  it('says so when a silence matches nothing today, and can still be restored', () => {
    const html = view(report([]), [{ ...SILENCED, found: false, firstDay: null, lastDay: null, severity: null }]);
    expect(html).toContain('Not found right now; it stays hidden if it comes back');
    expect(html).toContain('>Restore<');
    expect(html).toContain('All checks passed');
  });

  it('disables Restore while a change is in flight', () => {
    const html = view(report([]), [SILENCED], { busy: 'late-start:dietary_energy' });
    expect(html).toContain('Restoring…');
  });
});

describe('DataQualitySection', () => {
  const status = (over: Partial<PipelineStatusReport>) =>
    ({ qualityState: 'ready', quality: report([MISSING]), silenced: [SILENCED], checkedAt: 'x', ...over }) as PipelineStatusReport;

  it('renders the report and the silenced list from the pipeline report', () => {
    const html = renderToStaticMarkup(createElement(DataQualitySection, { report: status({}) }));
    expect(html).toContain('Days are missing from the export');
    expect(html).toContain('Silenced issues (1)');
  });

  it('tolerates a report without a silenced list', () => {
    const html = renderToStaticMarkup(createElement(DataQualitySection, { report: status({ silenced: undefined as never }) }));
    expect(html).not.toContain('Silenced issues');
  });

  it('renders nothing when there is no export to check', () => {
    expect(renderToStaticMarkup(createElement(DataQualitySection, { report: status({ qualityState: 'unavailable', quality: null }) }))).toBe('');
  });
});

describe('DataQualityView: corrections', () => {
  const OVERLAP: QualityFinding = {
    check: 'overlapping-exports', severity: 'problem', title: 'Some activity is counted twice', detail: 'Doubled.', metrics: ['step_count'],
    ranges: [{ from: '2026-09-28', to: '2026-09-28', days: 1 }], affectedDays: 1,
    remedy: ['In Health Auto Export, use one time grouping.', 'See the guide.'], correctable: true,
  };

  it('offers Fix it in place of the steps when the correction is off, and keeps Silence', () => {
    const html = view(report([OVERLAP]), []);
    expect(html).toMatch(/aria-label="Fix it: Some activity is counted twice"[^>]*>Fix it</);
    expect(html).toContain('Your export server is not changed.');
    expect(html).toContain('To keep it from happening again: In Health Auto Export, use one time grouping.');
    expect(html).not.toContain('How to fix it');
    expect(html).toContain('>Silence<');
  });

  it('keeps the steps for a finding Vital cannot correct', () => {
    const html = view(report([MISSING]), []);
    expect(html).toContain('How to fix it');
    expect(html).not.toContain('>Fix it<');
  });

  it('shows progress on Fix it while it is in flight', () => {
    expect(view(report([OVERLAP]), [], { busy: 'correct:overlapping-exports' })).toMatch(/<button[^>]*disabled=""[^>]*>Fixing…/);
  });

  it('lists a corrected check as corrected by Vital, with Stop correcting', () => {
    const corrected: DataQualityReport = {
      findings: [],
      checks: [
        {
          id: 'overlapping-exports', label: QUALITY_CHECK_LABEL['overlapping-exports'], outcome: 'corrected', correcting: true,
          summary: 'Corrected by Vital: 120 finer records of Steps on 1 day are left out, so that activity is counted once.',
        },
      ],
    };
    const html = view(corrected, []);
    expect(html).toContain(': corrected by Vital');
    expect(html).toContain('Corrected by Vital: 120 finer records');
    expect(html).toMatch(/aria-label="Stop correcting: Overlapping exports \(double counting\)"[^>]*>Stop correcting</);
    expect(html).toContain('All checks passed');
  });
});

describe('DataQualityView: fixing a silenced issue', () => {
  const SILENCED_OVERLAP: SilencedFinding = {
    checkId: 'overlapping-exports', checkLabel: QUALITY_CHECK_LABEL['overlapping-exports'], metricId: '', metricLabel: 'Steps',
    title: 'Some activity is counted twice', severity: 'problem', found: true, firstDay: '2026-10-04', lastDay: '2026-10-06',
  };

  it('offers Fix it beside Restore for a silenced issue Vital can correct', () => {
    const html = view(report([]), [SILENCED_OVERLAP]);
    expect(html).toMatch(/aria-label="Fix it: Some activity is counted twice"[^>]*>Fix it</);
    expect(html).toContain('>Restore<');
  });

  it('offers no Fix it when the silenced issue is not found right now', () => {
    expect(view(report([]), [{ ...SILENCED_OVERLAP, found: false }])).not.toContain('>Fix it<');
  });

  it('offers no Fix it for a silenced issue Vital cannot correct', () => {
    expect(view(report([]), [SILENCED])).not.toContain('>Fix it<');
  });
});

import { describe, expect, it } from 'vitest';
import { CORRECTABLE_CHECKS, correctionFor, dropRedundant, validateCorrectionInput } from './quality-correct';
import { compactRecords, dataQualityReport, findRedundant, scanMetricRecords, type ScanRecord } from './quality';
import { METRIC_MAPPINGS, normalizeSimpleMetric, type RawSimpleRecord } from './normalize';

const TZ = 'America/New_York';
const NOW = new Date('2026-10-05T14:00:00Z');
const TODAY = '2026-10-05';
const ALL = new Set(CORRECTABLE_CHECKS);

/** An instant on a local (New York, EDT) day and clock time. */
const at = (day: string, h: number, m = 0, s = 0) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + 4, m, s)).toISOString();

const HOURS = [8, 9, 10, 12, 13, 15, 17, 18, 19, 20];

/** Steps sample by sample (twelve 5-minute samples an hour), plus the same hours again as on-the-hour totals. */
function doubledSteps(day: string, hours = HOURS): ScanRecord[] {
  return hours.flatMap(h => [
    ...Array.from({ length: 12 }, (_, i) => ({ date: at(day, h, i * 5, 7), value: 50, source: '' })),
    { date: at(day, h), value: 600, source: '' },
  ]);
}

describe('findRedundant', () => {
  it('marks the finer records of a doubled day and keeps the hourly totals', () => {
    const records = doubledSteps('2026-09-28');
    const { drop, count, overlapDays } = findRedundant('sum', compactRecords(records), TZ);
    expect(overlapDays.size).toBe(1);
    expect(count).toBe(HOURS.length * 12);
    const kept = records.filter((_, i) => drop[i] === 0);
    expect(kept).toHaveLength(HOURS.length);
    expect(kept.every(r => r.value === 600)).toBe(true);
  });

  it('leaves a stray doubled hour alone: the day is not flagged, so nothing is dropped', () => {
    const records = [
      ...doubledSteps('2026-09-28', [8]),
      // The rest of the day sample by sample only, so one hour is far below the flagging share.
      ...[9, 10, 11, 12, 13, 14, 15, 16, 17].flatMap(h => Array.from({ length: 12 }, (_, i) => ({ date: at('2026-09-28', h, i * 5, 7), value: 50, source: '' }))),
    ];
    expect(findRedundant('sum', compactRecords(records), TZ).count).toBe(0);
  });

  it('marks the on-the-hour copy of a reading, not the original or another source', () => {
    const day = '2026-09-28';
    const records = [
      { date: at(day, 7, 47, 12), value: 80.2, source: 'Weight Gurus' },
      { date: at(day, 7), value: 80.2, source: 'Weight Gurus' },
      { date: at(day, 10), value: 80.4, source: 'Lose It!' },
    ];
    const { drop, count } = findRedundant('latest', compactRecords(records), TZ);
    expect(count).toBe(1);
    expect([...drop]).toEqual([0, 1, 0]);
  });

  it('agrees with the scan on how many records repeat', () => {
    const records = doubledSteps('2026-09-28');
    expect(scanMetricRecords('step_count', 'sum', records, TZ).redundantRecords).toBe(HOURS.length * 12);
  });
});

describe('dropRedundant', () => {
  const records = doubledSteps('2026-09-28');

  it('drops nothing when the correction is off or the aggregation has none', () => {
    expect(dropRedundant(records, 'sum', new Set(), TZ)).toEqual({ kept: records, dropped: 0 });
    expect(dropRedundant(records, 'sum', undefined, TZ).dropped).toBe(0);
    expect(dropRedundant(records, 'mean', ALL, TZ).dropped).toBe(0);
    expect(dropRedundant(records, 'sum', new Set(['duplicate-readings'] as const), TZ).dropped).toBe(0);
  });

  it('keeps records without a readable instant, in order', () => {
    const odd = { date: 'not a date', value: 1, source: '' };
    const { kept, dropped } = dropRedundant([odd, ...records], 'sum', ALL, TZ);
    expect(dropped).toBe(HOURS.length * 12);
    expect(kept[0]).toBe(odd);
    expect(kept).toHaveLength(HOURS.length + 1);
  });

  it('maps each aggregation to its check', () => {
    expect(correctionFor('sum')).toBe('overlapping-exports');
    expect(correctionFor('latest')).toBe('duplicate-readings');
    expect(correctionFor('mean')).toBeNull();
  });
});

describe('normalizeSimpleMetric with the correction', () => {
  const mapping = METRIC_MAPPINGS.find(m => m.metricId === 'step_count')!;
  const raw: RawSimpleRecord[] = doubledSteps('2026-09-28').map(r => ({ date: r.date, qty: r.value, units: 'count', source: r.source }));
  const ctx = { tz: TZ, referenceKey: TODAY, windowStartKey: '2026-09-01' };

  it('counts a doubled day once with the correction on, and twice with it off', () => {
    const on = normalizeSimpleMetric(mapping, raw, { ...ctx, correct: ALL })!;
    const off = normalizeSimpleMetric(mapping, raw, ctx)!;
    expect(on.observations[0].qty).toBe(HOURS.length * 600);
    expect(off.observations[0].qty).toBe(HOURS.length * 1200);
    expect(on.correctedRecords).toBe(HOURS.length * 12);
    expect(off.correctedRecords).toBe(0);
  });
});

describe('the report with the correction', () => {
  const scan = () => scanMetricRecords('step_count', 'sum', doubledSteps('2026-09-28'), TZ);

  it('reports a corrected check, with what was left out, and no finding to fix', () => {
    const report = dataQualityReport({ scans: [scan()], daysByMetric: {}, referenceKey: TODAY, now: NOW, corrections: ALL });
    expect(report.findings.find(f => f.check === 'overlapping-exports')).toBeUndefined();
    const check = report.checks.find(c => c.id === 'overlapping-exports')!;
    expect(check.outcome).toBe('corrected');
    expect(check.correcting).toBe(true);
    expect(check.summary).toBe('Corrected by Vital: 120 finer records of Steps on 1 day are left out, so that activity is counted once.');
  });

  it('with the correction off, the finding offers to fix it and no longer asks to delete records by hand', () => {
    const report = dataQualityReport({ scans: [scan()], daysByMetric: {}, referenceKey: TODAY, now: NOW, corrections: new Set() });
    const finding = report.findings.find(f => f.check === 'overlapping-exports')!;
    expect(finding.correctable).toBe(true);
    expect(finding.remedy.join(' ')).not.toMatch(/mongodump|delete/i);
    expect(report.checks.find(c => c.id === 'overlapping-exports')!).toMatchObject({ outcome: 'flagged', correcting: false });
  });

  it('reports corrected duplicate readings', () => {
    const day = '2026-09-28';
    const weight = scanMetricRecords(
      'weight_body_mass',
      'latest',
      [
        { date: at(day, 7, 47, 12), value: 80.2, source: 'Weight Gurus' },
        { date: at(day, 7), value: 80.2, source: 'Weight Gurus' },
      ],
      TZ
    );
    const report = dataQualityReport({ scans: [weight], daysByMetric: {}, referenceKey: TODAY, now: NOW, corrections: ALL });
    expect(report.findings).toEqual([]);
    expect(report.checks.find(c => c.id === 'duplicate-readings')!.summary).toMatch(/^Corrected by Vital: 1 on-the-hour copy of .* readings on 1 day is left out\.$/);
  });
});

describe('validateCorrectionInput', () => {
  it('accepts a correctable check', () => {
    expect(validateCorrectionInput({ checkId: 'overlapping-exports' })).toEqual({ ok: true, checkId: 'overlapping-exports' });
  });

  it.each([
    ['a check Vital cannot correct', { checkId: 'missing-days' }],
    ['an unknown check', { checkId: 'nope' }],
    ['an extra field', { checkId: 'duplicate-readings', metricId: 'weight_body_mass' }],
    ['an array', []],
    ['null', null],
  ])('refuses %s', (_, body) => {
    expect(validateCorrectionInput(body).ok).toBe(false);
  });
});

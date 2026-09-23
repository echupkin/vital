// ── Tests for the Lab page view model ───────────────────────────────────────
//
// Pure functions only, so every honesty rule the Lab page claims is pinned here
// rather than through the DOM: grouping and out-of-range-first ordering, the
// counts by status, the change from the previous observation (including the
// single-observation and new/removed-analyte cases), the empty state, the
// unscored-because-no-range path and the non-numeric reading path.

import { describe, it, expect } from 'vitest';
import type { LabBand } from './analytes';
import { scoreResult } from './status';
import {
  BUCKET_LABEL,
  CATEGORY_ORDER,
  changeFromPrevious,
  chartDescription,
  chartDomain,
  chartModel,
  compareDocuments,
  countStatuses,
  daysBetween,
  filterByRange,
  formatNumber,
  formatReading,
  groupAnalytes,
  hasDocumentsWithoutResults,
  hasNoDocuments,
  intervalProvenance,
  latestPoint,
  orderAnalytes,
  orderedPoints,
  previousPoint,
  severityRank,
  statusBucket,
  summariseDocuments,
  unscoredReason,
  type LabAnalyte,
  type LabPoint,
  type LabReportDocument,
} from './view';

// ── Builders ────────────────────────────────────────────────────────────────

function makePoint(input: {
  id: string;
  on: string;
  value: number | null;
  valueText?: string | null;
  unit?: string | null;
  reportId?: string;
  refLow?: number | null;
  refHigh?: number | null;
  band?: LabBand | null;
}): LabPoint {
  const scored = scoreResult({
    value: input.value,
    valueText: input.valueText ?? null,
    refLow: input.refLow ?? null,
    refHigh: input.refHigh ?? null,
    printedFlag: null,
    band: input.band ?? null,
  });
  return {
    resultId: input.id,
    reportId: input.reportId ?? 'doc-1',
    resultOn: input.on,
    value: input.value,
    valueText: input.valueText ?? null,
    unit: input.unit ?? null,
    printedFlag: null,
    interval: scored.interval,
    status: scored.status,
    statusLabel: scored.label,
    tone: scored.tone,
    notes: scored.notes,
    extractionMethod: 'deterministic',
  };
}

function makeAnalyte(input: Partial<LabAnalyte> & { points: LabPoint[] }): LabAnalyte {
  return {
    analyteKey: 'alt',
    displayName: 'ALT',
    category: 'Liver',
    unit: 'U/L',
    registered: true,
    collisions: 0,
    warnings: [],
    ...input,
  };
}

function document(input: Partial<LabReportDocument> & { id: string }): LabReportDocument {
  return {
    kind: 'results',
    documentDate: null,
    labName: null,
    sourceFilename: 'report.pdf',
    createdAt: '2024-01-01T00:00:00.000Z',
    resultCount: 0,
    analyteCount: 0,
    dateCount: 0,
    firstResultOn: null,
    lastResultOn: null,
    ...input,
  };
}

// A realistic pair of observations inside a printed 10-40 interval, in U/L.
const printed = { refLow: 10, refHigh: 40, unit: 'U/L' };

// ── Counts and buckets ──────────────────────────────────────────────────────

describe('counting observations by status', () => {
  it('maps every status to exactly one of the four buckets', () => {
    expect(statusBucket('in_range')).toBe('in_range');
    expect(statusBucket('slightly_out_low')).toBe('slightly_out');
    expect(statusBucket('slightly_out_high')).toBe('slightly_out');
    expect(statusBucket('out_low')).toBe('out');
    expect(statusBucket('out_high')).toBe('out');
    expect(statusBucket('unscored_no_range')).toBe('unscored');
    expect(statusBucket('unscored_non_numeric')).toBe('unscored');
  });

  it('labels all four buckets, so no count is rendered unlabelled', () => {
    expect(Object.keys(BUCKET_LABEL).sort()).toEqual(['in_range', 'out', 'slightly_out', 'unscored']);
    expect(BUCKET_LABEL.in_range).toBe('In range');
    expect(BUCKET_LABEL.out).toBe('Out of range');
  });

  it('counts observations, and reports the total it counted', () => {
    const analytes = [
      makeAnalyte({
        analyteKey: 'a',
        points: [
          makePoint({ id: 'a1', on: '2024-01-01', value: 20, ...printed }),
          makePoint({ id: 'a2', on: '2024-02-01', value: 60, ...printed }),
        ],
      }),
      makeAnalyte({
        analyteKey: 'b',
        points: [
          makePoint({ id: 'b1', on: '2024-01-01', value: 30, ...printed }),
          makePoint({ id: 'b2', on: '2024-02-01', value: null, valueText: 'NEGATIVE' }),
          makePoint({ id: 'b3', on: '2024-03-01', value: 45, ...printed }),
        ],
      }),
    ];

    const counts = countStatuses(analytes);
    expect(counts.inRange).toBe(2);
    expect(counts.out).toBe(2);
    expect(counts.slightlyOut).toBe(0);
    expect(counts.unscored).toBe(1);
    expect(counts.total).toBe(5);
    expect(counts.inRange + counts.slightlyOut + counts.out + counts.unscored).toBe(counts.total);
  });
});

// ── Ordering and grouping ───────────────────────────────────────────────────

describe('grouping and out-of-range-first ordering', () => {
  it('ranks out above slightly out above in range above unscored', () => {
    expect(severityRank('out_high')).toBeLessThan(severityRank('slightly_out_high'));
    expect(severityRank('slightly_out_high')).toBeLessThan(severityRank('in_range'));
    expect(severityRank('in_range')).toBeLessThan(severityRank('unscored_no_range'));
  });

  const out = makeAnalyte({
    analyteKey: 'out',
    displayName: 'Out',
    points: [makePoint({ id: '1', on: '2024-01-01', value: 90, ...printed })],
  });
  const slightly = makeAnalyte({
    analyteKey: 'slightly',
    displayName: 'Slightly',
    points: [makePoint({ id: '2', on: '2024-01-01', value: 43, ...printed })],
  });
  const inside = makeAnalyte({
    analyteKey: 'inside',
    displayName: 'Inside',
    points: [makePoint({ id: '3', on: '2024-01-01', value: 20, ...printed })],
  });
  const unscored = makeAnalyte({
    analyteKey: 'unscored',
    displayName: 'Unscored',
    points: [makePoint({ id: '4', on: '2024-01-01', value: 5 })],
  });

  it('orders analytes by the severity of their latest observation', () => {
    expect(orderAnalytes([inside, unscored, slightly, out]).map(a => a.analyteKey)).toEqual([
      'out',
      'slightly',
      'inside',
      'unscored',
    ]);
  });

  it('orders by name inside one severity', () => {
    const b = makeAnalyte({ analyteKey: 'b', displayName: 'Beta', points: inside.points });
    const a = makeAnalyte({ analyteKey: 'a', displayName: 'Alpha', points: inside.points });
    expect(orderAnalytes([b, a]).map(x => x.analyteKey)).toEqual(['a', 'b']);
  });

  it('groups by category in the registry order and omits empty groups', () => {
    const groups = groupAnalytes([
      makeAnalyte({ analyteKey: 'cbc1', displayName: 'Hgb', category: 'CBC', points: inside.points }),
      makeAnalyte({ analyteKey: 'lipid1', displayName: 'LDL', category: 'Lipids', points: out.points }),
    ]);
    expect(groups.map(g => g.category)).toEqual(['Lipids', 'CBC']);
    expect(groups.every(g => g.analytes.length > 0)).toBe(true);
    expect(CATEGORY_ORDER[0]).toBe('Lipids');
  });

  it('keeps a category the order list does not know instead of dropping it', () => {
    const groups = groupAnalytes([
      makeAnalyte({ analyteKey: 'x', displayName: 'X', category: 'Cardiac/Muscle', points: inside.points }),
    ]);
    expect(groups.map(g => g.category)).toEqual(['Cardiac/Muscle']);
  });
});

// ── Ordering of points, never merging one date ──────────────────────────────

describe('observation ordering', () => {
  it('orders by result date and keeps two observations on one date as two points', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'later', on: '2024-03-01', value: 20, ...printed }),
        makePoint({ id: 'a', on: '2024-01-01', value: 30, ...printed }),
        makePoint({ id: 'b', on: '2024-01-01', value: 25, reportId: 'doc-2', ...printed }),
      ],
    });
    const ordered = orderedPoints(analyte);
    expect(ordered.map(p => p.resultId)).toEqual(['a', 'b', 'later']);
    expect(latestPoint(analyte)!.resultId).toBe('later');
    expect(previousPoint(analyte)!.resultId).toBe('b');
  });

  it('has no previous point when there is only one', () => {
    const analyte = makeAnalyte({ points: [makePoint({ id: 'solo', on: '2024-01-01', value: 20, ...printed })] });
    expect(latestPoint(analyte)!.resultId).toBe('solo');
    expect(previousPoint(analyte)).toBeNull();
  });
});

// ── The change from the previous observation ────────────────────────────────

describe('the change from the previous observation', () => {
  it('states that a single observation has nothing to compare with', () => {
    const analyte = makeAnalyte({
      points: [makePoint({ id: 'solo', on: '2024-01-01', value: 20, ...printed })],
    });
    const change = changeFromPrevious(analyte)!;
    expect(change.kind).toBe('first');
    expect(change.kind === 'first' && change.text).toContain('First observation');
  });

  it('reports the difference and the window it spans', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 20, ...printed }),
        makePoint({ id: 'p2', on: '2024-01-31', value: 34, ...printed }),
      ],
    });
    const change = changeFromPrevious(analyte)!;
    expect(change.kind).toBe('numeric');
    if (change.kind !== 'numeric') throw new Error('expected a numeric change');
    expect(change.delta).toBe(14);
    expect(change.deltaText).toBe('+14 U/L');
    expect(change.windowDays).toBe(30);
    expect(change.windowText).toBe('over 30 days');
    expect(change.from.resultId).toBe('p1');
    expect(change.to.resultId).toBe('p2');
  });

  it('signs a fall and keeps the unit from the report', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 34, ...printed }),
        makePoint({ id: 'p2', on: '2024-01-08', value: 20, ...printed }),
      ],
    });
    const change = changeFromPrevious(analyte)!;
    expect(change.kind === 'numeric' && change.deltaText).toBe('-14 U/L');
    expect(change.kind === 'numeric' && change.windowText).toBe('over 7 days');
  });

  it('describes a same-date pair as recorded on the same date, and still differences them', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'a', on: '2024-05-05', value: 20, ...printed }),
        makePoint({ id: 'b', on: '2024-05-05', value: 26, reportId: 'doc-2', ...printed }),
      ],
    });
    const change = changeFromPrevious(analyte)!;
    expect(change.kind).toBe('numeric');
    if (change.kind !== 'numeric') throw new Error('expected a numeric change');
    expect(change.windowText).toBe('recorded on the same date');
    expect(change.delta).toBe(6);
    expect(change.windowDays).toBe(0);
  });

  it('refuses to compute a difference when one side is not a number', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 20, ...printed }),
        makePoint({ id: 'p2', on: '2024-02-01', value: null, valueText: 'TRACE' }),
      ],
    });
    const change = changeFromPrevious(analyte)!;
    expect(change.kind).toBe('unavailable');
    expect(change.kind === 'unavailable' && change.text).toContain('No numeric change');
    expect(change.kind === 'unavailable' && change.text).toContain('TRACE');
  });

  it('has nothing to report for an analyte with no observations', () => {
    expect(changeFromPrevious(makeAnalyte({ points: [] }))).toBeNull();
  });
});

// ── Interval provenance ─────────────────────────────────────────────────────

describe('where the interval came from', () => {
  it('names the report when the report printed one', () => {
    const analyte = makeAnalyte({ points: [makePoint({ id: 'p', on: '2024-01-01', value: 20, ...printed })] });
    const provenance = intervalProvenance(latestPoint(analyte)!.interval);
    expect(provenance.text).toBe('printed on your report');
    expect(provenance.refText).toBe('10 - 40');
  });

  it('names the fallback table and the age/sex basis when no interval was printed', () => {
    const band: LabBand = {
      sex: 'male',
      minAge: 30,
      maxAge: 39,
      low: 4.6,
      high: 6.2,
      refText: 'M 4.6-6.2',
      source: 'secondary',
      sourceUrl: 'https://example.test',
      note: 'Ranges vary by lab.',
    };
    const analyte = makeAnalyte({
      points: [makePoint({ id: 'p', on: '2024-01-01', value: 5, unit: 'million/µL', band })],
    });
    const provenance = intervalProvenance(latestPoint(analyte)!.interval);
    expect(provenance.text).toBe('general reference interval (male 30-39 y) from the fallback table');
    expect(provenance.note).toBe('Ranges vary by lab.');
  });

  it('says plainly when there is no reference range at all', () => {
    const analyte = makeAnalyte({ points: [makePoint({ id: 'p', on: '2024-01-01', value: 5 })] });
    const provenance = intervalProvenance(latestPoint(analyte)!.interval);
    expect(provenance.text).toBe('no reference range — not scored');
    expect(provenance.refText).toBeNull();
  });
});

// ── Unscored reasons ────────────────────────────────────────────────────────

describe('why a row carries no status', () => {
  it('explains a value with no interval as unscored rather than guessed', () => {
    const analyte = makeAnalyte({ points: [makePoint({ id: 'p', on: '2024-01-01', value: 5 })] });
    const reason = unscoredReason(analyte, analyte.points[0]!, { sexSet: true, dateOfBirthSet: true });
    expect(reason).toContain('left unscored');
    expect(reason).not.toContain(' 0 ');
  });

  it('says a registry analyte with no interval of its own has nothing to score against', () => {
    // hs-CRP is registered with NO bands at all: the document itself says
    // "no agreed interval — leave unscored".
    const analyte = makeAnalyte({
      analyteKey: 'hs_crp',
      displayName: 'High-sensitivity C-reactive protein',
      category: 'Inflammation',
      unit: 'mg/L',
      points: [makePoint({ id: 'p', on: '2024-01-01', value: 1.2 })],
    });
    const reason = unscoredReason(analyte, analyte.points[0]!, { sexSet: true, dateOfBirthSet: true });
    expect(reason).toContain('No reference interval applies');
  });

  it('asks for Sex rather than applying a sex-specific band on an assumption', () => {
    // Hemoglobin's registry bands are male/female only: with no sex set, no band
    // is usable and the result stays unscored.
    const analyte = makeAnalyte({
      analyteKey: 'hemoglobin',
      displayName: 'Haemoglobin',
      category: 'CBC',
      unit: 'g/dL',
      points: [makePoint({ id: 'p', on: '2024-01-01', value: 15 })],
    });
    const reason = unscoredReason(analyte, analyte.points[0]!, { sexSet: false, dateOfBirthSet: true });
    expect(reason).toContain('A sex-specific interval would be needed here');
    expect(reason).toContain('Settings → Account');
  });

  it('explains a non-numeric reading as unscorable against a numeric interval', () => {
    const analyte = makeAnalyte({
      points: [makePoint({ id: 'p', on: '2024-01-01', value: null, valueText: 'NEGATIVE' })],
    });
    const reason = unscoredReason(analyte, analyte.points[0]!, { sexSet: true, dateOfBirthSet: true });
    expect(reason).toContain('non-numeric');
    expect(reason).toContain('NEGATIVE');
  });

  it('says an unregistered analyte has no registry entry to score against', () => {
    const analyte = makeAnalyte({
      analyteKey: 'widget_one',
      displayName: 'Widget One',
      registered: false,
      points: [makePoint({ id: 'p', on: '2024-01-01', value: 12.1 })],
    });
    const reason = unscoredReason(analyte, analyte.points[0]!, { sexSet: true, dateOfBirthSet: true });
    expect(reason).toContain('not in the reference registry');
  });

  it('returns nothing for a scored observation', () => {
    const analyte = makeAnalyte({ points: [makePoint({ id: 'p', on: '2024-01-01', value: 20, ...printed })] });
    expect(unscoredReason(analyte, analyte.points[0]!, { sexSet: true, dateOfBirthSet: true })).toBeNull();
  });
});

// ── Formatting: a missing value is never 0 ──────────────────────────────────

describe('formatting values', () => {
  it('never renders a missing value as zero', () => {
    expect(formatReading({ value: null, valueText: null, unit: 'mg/dL' })).toBe('no value');
    expect(formatReading({ value: null, valueText: null, unit: null })).toBe('no value');
    expect(formatReading({ value: null, valueText: '', unit: 'mg/dL' })).toBe('no value');
  });

  it('shows a non-numeric reading as the document printed it, with its unit', () => {
    expect(formatReading({ value: null, valueText: 'NEGATIVE', unit: null })).toBe('NEGATIVE');
    expect(formatReading({ value: null, valueText: ' TRACE ', unit: 'mg/dL' })).toBe('TRACE mg/dL');
  });

  it('shows a number with its unit, without inventing precision', () => {
    expect(formatReading({ value: 15, valueText: null, unit: 'g/dL' })).toBe('15 g/dL');
    expect(formatNumber(0.30000000000000004)).toBe('0.3');
    expect(formatNumber(null)).toBe('no value');
  });

  it('counts whole days between dates, and refuses to guess on a bad one', () => {
    expect(daysBetween('2024-01-01', '2024-01-31')).toBe(30);
    expect(daysBetween('2024-01-31', '2024-01-01')).toBe(-30);
    expect(daysBetween('not-a-date', '2024-01-01')).toBeNull();
  });
});

// ── Documents ───────────────────────────────────────────────────────────────

describe('the stored documents', () => {
  it('reports the empty state when nothing is imported', () => {
    expect(hasNoDocuments([])).toBe(true);
    expect(hasNoDocuments([document({ id: 'd1' })])).toBe(false);
    expect(hasDocumentsWithoutResults([], [])).toBe(false);
    expect(hasDocumentsWithoutResults([document({ id: 'd1' })], [])).toBe(true);
    expect(
      hasDocumentsWithoutResults([document({ id: 'd1' })], [
        makeAnalyte({ points: [makePoint({ id: 'p', on: '2024-01-01', value: 20, ...printed })] }),
      ])
    ).toBe(false);
  });

  it('summarises the count, the result date range, the newest document date and the labs', () => {
    const summary = summariseDocuments([
      document({
        id: 'd1',
        documentDate: '2024-01-02',
        labName: 'Sigma Total',
        firstResultOn: '2023-11-02',
        lastResultOn: '2024-01-02',
      }),
      document({
        id: 'd2',
        documentDate: '2025-06-01',
        labName: 'Sigma Total',
        firstResultOn: '2024-03-04',
        lastResultOn: '2025-06-01',
      }),
    ]);
    expect(summary.count).toBe(2);
    expect(summary.firstOn).toBe('2023-11-02');
    expect(summary.lastOn).toBe('2025-06-01');
    expect(summary.newestDocumentDate).toBe('2025-06-01');
    expect(summary.labNames).toEqual(['Sigma Total']);
  });

  it('invents no date when no document printed one', () => {
    const summary = summariseDocuments([document({ id: 'd1' })]);
    expect(summary.newestDocumentDate).toBeNull();
    expect(summary.firstOn).toBeNull();
    expect(summary.lastOn).toBeNull();
  });
});

// ── Comparison across documents ─────────────────────────────────────────────

describe('comparing two documents', () => {
  const then = document({ id: 'then-doc', documentDate: '2023-01-01', sourceFilename: 'earlier.pdf' });
  const now = document({ id: 'now-doc', documentDate: '2024-01-01', sourceFilename: 'later.pdf' });
  expect(then.id).not.toBe(now.id);

  it('gives the value in each document, the difference and the status change', () => {
    const analyte = makeAnalyte({
      analyteKey: 'alt',
      displayName: 'ALT',
      points: [
        makePoint({ id: 't1', on: '2022-12-20', value: 20, reportId: 'then-doc', ...printed }),
        makePoint({ id: 'n1', on: '2023-12-20', value: 62, reportId: 'now-doc', ...printed }),
      ],
    });
    const rows = compareDocuments([analyte], 'then-doc', 'now-doc');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.state).toBe('both');
    expect(row.then!.value).toBe(20);
    expect(row.now!.value).toBe(62);
    expect(row.delta).toBe(42);
    expect(row.deltaText).toBe('+42 U/L');
    expect(row.statusChanged).toBe(true);
    expect(row.statusText).toBe('In range → Above range');
    expect(row.note).toBeNull();
  });

  it('states an unchanged status explicitly', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 't1', on: '2022-12-20', value: 20, reportId: 'then-doc', ...printed }),
        makePoint({ id: 'n1', on: '2023-12-20', value: 24, reportId: 'now-doc', ...printed }),
      ],
    });
    const row = compareDocuments([analyte], 'then-doc', 'now-doc')[0]!;
    expect(row.statusChanged).toBe(false);
    expect(row.statusText).toBe('Unchanged (In range)');
  });

  it('marks an analyte present in only one of the two documents', () => {
    const removed = makeAnalyte({
      analyteKey: 'removed',
      displayName: 'Removed',
      points: [makePoint({ id: 't1', on: '2022-12-20', value: 20, reportId: 'then-doc', ...printed })],
    });
    const added = makeAnalyte({
      analyteKey: 'added',
      displayName: 'Added',
      points: [makePoint({ id: 'n1', on: '2023-12-20', value: 30, reportId: 'now-doc', ...printed })],
    });
    const rows = compareDocuments([removed, added], 'then-doc', 'now-doc');
    const removedRow = rows.find(row => row.analyteKey === 'removed')!;
    const addedRow = rows.find(row => row.analyteKey === 'added')!;

    expect(removedRow.state).toBe('then_only');
    expect(removedRow.now).toBeNull();
    expect(removedRow.deltaText).toBeNull();
    expect(removedRow.note).toContain('only one of the two documents');
    expect(removedRow.note).toContain('earlier');

    expect(addedRow.state).toBe('now_only');
    expect(addedRow.then).toBeNull();
    expect(addedRow.deltaText).toBeNull();
    expect(addedRow.note).toContain('later');
  });

  it('drops an analyte neither document contains', () => {
    const elsewhere = makeAnalyte({
      analyteKey: 'elsewhere',
      points: [makePoint({ id: 'x', on: '2022-01-01', value: 20, reportId: 'third-doc', ...printed })],
    });
    expect(compareDocuments([elsewhere], 'then-doc', 'now-doc')).toEqual([]);
  });

  it('uses a document\u2019s latest observation of an analyte and says how many it held', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 't1', on: '2022-03-01', value: 20, reportId: 'then-doc', ...printed }),
        makePoint({ id: 't2', on: '2022-09-01', value: 30, reportId: 'then-doc', ...printed }),
        makePoint({ id: 'n1', on: '2023-09-01', value: 40, reportId: 'now-doc', ...printed }),
      ],
    });
    const row = compareDocuments([analyte], 'then-doc', 'now-doc')[0]!;
    expect(row.then!.resultId).toBe('t2');
    expect(row.thenCount).toBe(2);
    expect(row.nowCount).toBe(1);
    expect(row.delta).toBe(10);
  });

  it('refuses a difference when one side is not a number', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 't1', on: '2022-12-20', value: 20, reportId: 'then-doc', ...printed }),
        makePoint({ id: 'n1', on: '2023-12-20', value: null, valueText: 'TRACE', reportId: 'now-doc' }),
      ],
    });
    const row = compareDocuments([analyte], 'then-doc', 'now-doc')[0]!;
    expect(row.delta).toBeNull();
    expect(row.deltaText).toBeNull();
  });
});

// ── Chart model ─────────────────────────────────────────────────────────────

describe('what the chart can honestly draw', () => {
  it('charts ONE observation as a range position, never as a one-point trend', () => {
    const analyte = makeAnalyte({
      points: [makePoint({ id: 'p1', on: '2024-01-01', value: 20, ...printed })],
    });
    const model = chartModel(analyte);
    expect(model.mode).toBe('range');
    expect(model.numeric).toHaveLength(1);
    expect(model.readings).toHaveLength(0);
    expect(model.band!.low).toBe(10);
    expect(model.band!.high).toBe(40);
    expect(model.band!.provenance).toBe('printed on your report');
    expect(chartDescription('ALT', model)).toContain('one observation');
    expect(chartDescription('ALT', model)).toContain('inside the interval 10 - 40');
  });

  it('puts an observation outside the band outside it, in words', () => {
    const analyte = makeAnalyte({
      points: [makePoint({ id: 'p1', on: '2024-01-01', value: 62, ...printed })],
    });
    const model = chartModel(analyte);
    expect(model.mode).toBe('range');
    expect(chartDescription('ALT', model)).toContain('outside the interval');
  });

  it('charts TWO OR MORE observations as a trend with the band shaded', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 20, ...printed }),
        makePoint({ id: 'p2', on: '2024-02-01', value: 30, ...printed }),
        makePoint({ id: 'p3', on: '2024-03-01', value: 50, ...printed }),
      ],
    });
    const model = chartModel(analyte);
    expect(model.mode).toBe('trend');
    expect(model.numeric.map(p => p.value)).toEqual([20, 30, 50]);
    expect(model.bandVaries).toBe(false);
    const domain = chartDomain(model)!;
    expect(domain[0]).toBeLessThanOrEqual(10);
    expect(domain[1]).toBeGreaterThanOrEqual(50);
    const description = chartDescription('ALT', model);
    expect(description).toContain('3 observations');
    expect(description).toContain('Latest 50 U/L');
  });

  it('flags a trend whose observations were not scored against one interval', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 20, refLow: 10, refHigh: 40 }),
        makePoint({ id: 'p2', on: '2024-02-01', value: 30, refLow: 5, refHigh: 50 }),
      ],
    });
    expect(chartModel(analyte).bandVaries).toBe(true);
  });

  it('lists a non-numeric reading instead of plotting it as a number', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: null, valueText: 'NEGATIVE' }),
        makePoint({ id: 'p2', on: '2024-02-01', value: null, valueText: 'TRACE' }),
      ],
    });
    const model = chartModel(analyte);
    expect(model.mode).toBe('readings');
    expect(model.numeric).toHaveLength(0);
    expect(model.readings).toHaveLength(2);
    const description = chartDescription('ALT', model);
    expect(description).toContain('no numeric values were printed');
    expect(description).toContain('NEGATIVE');
    expect(description).not.toMatch(/\b0\b/);
  });

  it('keeps a mixed series numeric and lists the non-numeric readings beside it', () => {
    const analyte = makeAnalyte({
      points: [
        makePoint({ id: 'p1', on: '2024-01-01', value: 20, ...printed }),
        makePoint({ id: 'p2', on: '2024-02-01', value: null, valueText: 'TRACE' }),
        makePoint({ id: 'p3', on: '2024-03-01', value: 24, ...printed }),
      ],
    });
    const model = chartModel(analyte);
    expect(model.mode).toBe('trend');
    expect(model.numeric.map(p => p.resultId)).toEqual(['p1', 'p3']);
    expect(model.readings.map(p => p.resultId)).toEqual(['p2']);
  });

  it('has no model at all for an analyte with no observations', () => {
    const model = chartModel(makeAnalyte({ points: [] }));
    expect(model.mode).toBe('readings');
    expect(model.numeric).toHaveLength(0);
    expect(chartDomain(model)).toBeNull();
  });
});

// ── The detail page's range control ─────────────────────────────────────────

describe('the range control', () => {
  const points = [
    makePoint({ id: 'p1', on: '2020-01-01', value: 20, ...printed }),
    makePoint({ id: 'p2', on: '2024-06-01', value: 30, ...printed }),
    makePoint({ id: 'p3', on: '2024-08-30', value: 40, ...printed }),
  ];

  it('measures the range back from the NEWEST OBSERVATION, not from today', () => {
    expect(filterByRange(points, 90).map(p => p.resultId)).toEqual(['p2', 'p3']);
    expect(filterByRange(points, 365).map(p => p.resultId)).toEqual(['p2', 'p3']);
  });

  it('returns every point for "all"', () => {
    expect(filterByRange(points, null)).toHaveLength(3);
  });
});
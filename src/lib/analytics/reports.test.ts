import { describe, expect, it } from 'vitest';
import { REFERENCE_KEY, WINDOW_START_KEY, seriesInWindow } from '@/lib/adapters/dataset';
import { addDays, dayKey, windowDays, windowRangeLabel } from '@/lib/analytics/windows';
import {
  buildMonthlyReports,
  buildReportArchive,
  buildWeeklyReports,
  monthlyReportWindows,
  weeklyReportWindows,
} from '@/lib/analytics';

describe('weekly reports (SPEC §7 report archive)', () => {
  const weeks = buildWeeklyReports(REFERENCE_KEY, 12);

  it('covers complete weeks of 7 days, the latest ending yesterday', () => {
    expect(weeks).toHaveLength(12);
    expect(weeks[0].window.endKey).toBe(addDays(REFERENCE_KEY, -1));
    expect(windowDays(weeks[0].window)).toBe(7);
    for (const report of weeks) {
      expect(report.coveredDays).toBe(7);
      expect(report.partial).toBe(false);
      expect(report.window.endKey < REFERENCE_KEY).toBe(true);
    }
    // Weeks do not overlap and run backwards contiguously.
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i].window.endKey).toBe(addDays(weeks[i - 1].window.startKey, -1));
    }
  });

  it('composes its paragraphs from computed values, not static prose', () => {
    const report = weeks[0];
    expect(report.paragraphs).toHaveLength(4);
    expect(report.paragraphs[0]).toContain('you recorded');
    expect(report.paragraphs[0]).toContain(windowRangeLabel(report.window));
    expect(report.paragraphs[3]).toContain('Coverage:');
    // "Across Sep 10 – Sep 16 …"
    expect(report.paragraphs[0]).toMatch(/Across Sep \d+ – Sep \d+ you recorded/);
  });

  it('states the coverage of the period and of each metric', () => {
    const report = weeks[0];
    expect(report.coverageNote).toContain('7 of 7 days');
    for (const line of report.lines) {
      expect(line.observations).toBeGreaterThan(0);
      expect(line.coverage).toMatch(/\d+ of 7 days/);
      expect(line.aggregation).toBeTruthy();
    }
  });

  it('derives every figure from the dataset for that window', () => {
    const report = weeks[0];
    const sleepLine = report.lines.find(l => l.metricId === 'sleep_analysis')!;
    const points = seriesInWindow('sleep_analysis', report.window);
    const average = points.reduce((a, p) => a + p.value, 0) / points.length;
    expect(sleepLine.observations).toBe(points.length);
    // 6h 52m style formatting from the registry, never a raw float.
    expect(sleepLine.value).toMatch(/^\d+h \d+m$/);
    expect(average).toBeGreaterThan(0);

    const stepsLine = report.lines.find(l => l.metricId === 'step_count')!;
    expect(stepsLine.value.endsWith('in total')).toBe(true);
    expect(stepsLine.aggregation).toContain('daily total');
  });

  it('reports the comparison period it actually uses', () => {
    const report = weeks[0];
    expect(report.paragraphs[1]).toMatch(/preceding period \(Sep \d+ – Sep \d+\)/);
    expect(report.paragraphs[1]).toContain('Sep 3 – Sep 9');
  });

  it('summarises recorded workouts', () => {
    const withWorkouts = weeks.find(r => r.paragraphs[2].includes('workout'));
    expect(withWorkouts).toBeDefined();
    const report = weeks[0];
    expect(report.paragraphs[2]).toMatch(/workout/);
  });

  it('is deterministic', () => {
    const again = buildWeeklyReports(REFERENCE_KEY, 3);
    expect(again.map(r => r.id)).toEqual(buildWeeklyReports(REFERENCE_KEY, 3).map(r => r.id));
    expect(again[0].paragraphs).toEqual(buildWeeklyReports(REFERENCE_KEY, 3)[0].paragraphs);
  });

  it('never reaches before the dataset begins', () => {
    for (const win of weeklyReportWindows(REFERENCE_KEY, 40)) {
      expect(win.startKey >= WINDOW_START_KEY).toBe(true);
    }
  });
});

describe('monthly reports (SPEC §7 report archive)', () => {
  const months = buildMonthlyReports(REFERENCE_KEY, 7);

  it('covers calendar months, clipped to the dataset and the reference day', () => {
    expect(months).toHaveLength(7);
    const september = months[0];
    expect(september.window.startKey).toBe('2026-09-01');
    expect(september.window.endKey).toBe(REFERENCE_KEY);
    expect(september.days).toBe(30);
    expect(september.coveredDays).toBe(17);
    expect(september.partial).toBe(true);
    expect(september.coverageNote).toContain('the period is incomplete');

    const march = months[months.length - 1];
    expect(march.window.startKey).toBe(WINDOW_START_KEY);
    expect(march.coveredDays).toBe(windowDays(march.window));
    expect(march.partial).toBe(true);
  });

  it('liberates no figure for a day the dataset does not cover', () => {
    const july = months.find(m => m.title.includes('July'))!;
    expect(july.coveredDays).toBe(31);
    expect(july.partial).toBe(false);
    for (const line of july.lines) {
      expect(line.coverage).toMatch(/\d+ of 31 days/);
    }
  });

  it('names the month in the title and the range in the period label', () => {
    expect(months[0].title).toBe('Month of September 2026');
    expect(months[1].title).toBe('Month of August 2026');
    expect(months[0].periodLabel).toContain('2026');
  });

  it('lists windows in descending order', () => {
    for (let i = 1; i < months.length; i++) {
      expect(months[i].window.endKey < months[i - 1].window.startKey).toBe(true);
    }
    expect(monthlyReportWindows(REFERENCE_KEY, 7)).toHaveLength(7);
  });
});

describe('report archive assembly', () => {
  it('returns both series with stable identifiers', () => {
    const archive = buildReportArchive(REFERENCE_KEY, { weeks: 4, months: 3 });
    expect(archive.weekly).toHaveLength(4);
    expect(archive.monthly).toHaveLength(3);
    expect(archive.weekly[0].id).toBe(`weekly-${archive.weekly[0].window.endKey}`);
    expect(archive.monthly[0].id).toBe(`monthly-${archive.monthly[0].window.endKey}`);
    for (const report of [...archive.weekly, ...archive.monthly]) {
      expect(report.paragraphs.every(p => p.length > 20)).toBe(true);
      expect(report.rangeKey).toContain('..');
      expect(dayKey(`${report.window.startKey}T12:00:00Z`)).toBe(report.window.startKey);
    }
  });
});

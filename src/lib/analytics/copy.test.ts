import { describe, expect, it } from 'vitest';
import { getAllMetrics } from '@/lib/metrics';
import { REFERENCE_KEY, seriesFor } from '@/lib/adapters/dataset';
import {
  buildBriefing,
  buildReportArchive,
  buildSeriesSummary,
  buildStorySummary,
  buildTrendFigure,
  buildWatchItem,
  changeRowSummary,
  compareWindows,
  computeChangeRow,
  generateInsights,
  isWithinWord,
  loggedDayStats,
  previousWindow,
  trailingWindow,
  type ChangeRow,
} from '@/lib/analytics';
import { describeChange } from '@/lib/metrics/format';
import { HANDLERS, unsupportedHandlerIds } from '@/lib/analyst/handlers';
import { retrieve } from '@/lib/analyst/retrieval';
import { SUPPORTED_PROMPTS, SUPPORTED_QUESTIONS } from '@/lib/analyst/prompts';

/**
 * Medical-safety vocabulary (SPEC §8). "Not a diagnosis" style disclaimers are
 * deliberately excluded from this list — the boundary statement itself is
 * required — while any clinical claim about the reader is not.
 */
const BANNED = /\b(normal|normally|healthy|unhealthy|concerning|safe|unsafe|dangerous|alarming|abnormal|good|bad|worse|serious|risk|risky)\b/i;

function collectStrings(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];

  const briefing = buildBriefing(REFERENCE_KEY);
  out.push({ label: 'briefing.headline', text: briefing.headline });
  out.push({ label: 'briefing.body', text: briefing.body });
  for (const c of briefing.categories) {
    out.push({ label: `briefing.category.${c.key}.status`, text: c.status });
    out.push({ label: `briefing.category.${c.key}.label`, text: c.label });
  }

  const watch = buildWatchItem(briefing);
  if (watch) {
    out.push({ label: 'watch.reason', text: watch.reason });
    out.push({ label: 'watch.changeLabel', text: watch.changeLabel });
    out.push({ label: 'watch.evaluatedLabel', text: watch.evaluatedLabel });
    out.push({ label: 'watch.baselineLabel', text: watch.baselineLabel });
    if (watch.exclusionNote) out.push({ label: 'watch.exclusionNote', text: watch.exclusionNote });
  }

  for (const days of [30, 90]) {
    const story = buildStorySummary(REFERENCE_KEY, days);
    out.push({ label: `story.${days}.paragraph`, text: story.paragraph });
    for (const o of story.observations) {
      out.push({ label: `story.${days}.${o.metricId}.title`, text: o.title });
      out.push({ label: `story.${days}.${o.metricId}.detail`, text: o.detail });
      out.push({ label: `story.${days}.${o.metricId}.evidence`, text: o.evidence });
    }
  }

  for (const m of getAllMetrics()) {
    const summary = buildSeriesSummary(m.id, REFERENCE_KEY, 30);
    out.push({ label: `series.${m.id}.latestValue`, text: summary.latestValue });
    out.push({ label: `series.${m.id}.changeValue`, text: summary.changeValue });
    out.push({ label: `series.${m.id}.lengthLabel`, text: summary.lengthLabel });
    if (m.unavailableReason) out.push({ label: `registry.${m.id}.unavailableReason`, text: m.unavailableReason });

    const figure = buildTrendFigure(m.id, REFERENCE_KEY, 30);
    out.push({ label: `figure.${m.id}.ariaLabel`, text: figure.ariaLabel });
  }

  const win7 = trailingWindow(REFERENCE_KEY, 7);
  const prior7 = previousWindow(win7, 7);
  const rows: ChangeRow[] = ['sleep_analysis', 'resting_heart_rate', 'heart_rate_variability', 'apple_exercise_time'].map(id => {
    const cmp = compareWindows(id, REFERENCE_KEY, 7);
    return {
      metricId: id,
      label: id,
      comparison: cmp.comparison,
      excludedDays: cmp.excludedDays,
      counts: cmp.counts,
    };
  });
  void prior7;
  void computeChangeRow;
  out.push({ label: 'changeRowSummary', text: changeRowSummary(rows) });
  for (const r of rows) {
    if (r.comparison.valid) continue;
    out.push({ label: `comparison.invalid.${r.metricId}`, text: 'not enough data' });
  }

  for (const delta of [0, 1, -1, 3.5, -3.5, 0.4]) {
    for (const pct of [null, 0, 5.5, -12.25]) {
      out.push({ label: `describeChange.${delta}.${pct}`, text: describeChange('resting_heart_rate', delta, pct).phrase });
    }
  }

  // Insight cards
  for (const insight of generateInsights(REFERENCE_KEY)) {
    out.push({ label: `insight.${insight.id}.title`, text: insight.title });
    out.push({ label: `insight.${insight.id}.summary`, text: insight.summary });
    out.push({ label: `insight.${insight.id}.detail`, text: insight.detail });
    out.push({ label: `insight.${insight.id}.coverage`, text: insight.coverage });
    out.push({ label: `insight.${insight.id}.caveat`, text: insight.caveat });
    insight.computed.forEach((c, i) => out.push({ label: `insight.${insight.id}.computed${i}`, text: c }));
    insight.evidence.forEach((e, i) => {
      out.push({ label: `insight.${insight.id}.evidence${i}.window`, text: e.windowLabel });
      out.push({ label: `insight.${insight.id}.evidence${i}.aggregation`, text: e.aggregation });
      out.push({ label: `insight.${insight.id}.evidence${i}.coverage`, text: e.coverage });
    });
  }

  // Report archive
  const archive = buildReportArchive(REFERENCE_KEY);
  for (const report of [...archive.weekly, ...archive.monthly]) {
    out.push({ label: `report.${report.id}.title`, text: report.title });
    out.push({ label: `report.${report.id}.period`, text: report.periodLabel });
    out.push({ label: `report.${report.id}.coverageNote`, text: report.coverageNote });
    report.paragraphs.forEach((p, i) => out.push({ label: `report.${report.id}.p${i}`, text: p }));
    report.highlights.forEach((h, i) => out.push({ label: `report.${report.id}.h${i}`, text: h }));
    report.lines.forEach((l, i) => {
      out.push({ label: `report.${report.id}.line${i}.value`, text: l.value });
      out.push({ label: `report.${report.id}.line${i}.aggregation`, text: l.aggregation });
      out.push({ label: `report.${report.id}.line${i}.coverage`, text: l.coverage });
    });
  }

  // Logged-intake copy
  for (const id of ['dietary_energy', 'dietary_protein', 'dietary_caffeine', 'dietary_water']) {
    const stats = loggedDayStats(id, REFERENCE_KEY, 90);
    out.push({ label: `nutrition.${id}.averageLabel`, text: stats.averageLabel });
    out.push({ label: `nutrition.${id}.coverageLabel`, text: stats.coverageLabel });
  }

  // Analyst answers, produced exactly as the service produces them
  for (const handler of HANDLERS) {
    const answer = handler.run({ bundle: retrieve(handler.id, REFERENCE_KEY), system: 'metric', refKey: REFERENCE_KEY });
    out.push({ label: `analyst.${answer.id}.title`, text: answer.title });
    answer.observed.forEach((p, i) => out.push({ label: `analyst.${answer.id}.observed${i}`, text: p }));
    answer.interpretation.forEach((p, i) => out.push({ label: `analyst.${answer.id}.interp${i}`, text: p }));
    answer.uncertainty.forEach((p, i) => out.push({ label: `analyst.${answer.id}.uncertain${i}`, text: p }));
    answer.followUps.forEach((f, i) => out.push({ label: `analyst.${answer.id}.follow${i}`, text: f }));
    out.push({ label: `analyst.${answer.id}.boundary`, text: answer.boundaryNote });
    answer.evidence.forEach((e, i) => {
      out.push({ label: `analyst.${answer.id}.ev${i}.window`, text: e.windowLabel });
      out.push({ label: `analyst.${answer.id}.ev${i}.aggregation`, text: e.aggregation });
      out.push({ label: `analyst.${answer.id}.ev${i}.samples`, text: e.sampleCount });
    });
  }

  return out;
}

describe('generated copy (SPEC §8 medical safety)', () => {
  it('never uses clinical or judgemental vocabulary', () => {
    const offenders = collectStrings().filter(s => BANNED.test(s.text));
    expect(offenders.map(o => `${o.label}: ${o.text}`)).toEqual([]);
  });

  it('never presents a personal baseline as a medical safety range', () => {
    // A negated statement ("not a comparison with a reference range") is the
    // required disclaimer; a positive one is the thing being banned.
    const triggers = collectStrings().filter(s => {
      if (!/(normal range|healthy range|reference range)/i.test(s.text)) return false;
      return !/\b(not|never|no)\b/i.test(s.text);
    });
    expect(triggers).toEqual([]);
  });
});

describe('briefing self-consistency (defect 4)', () => {
  it('states it in the headline when any category is outside its baseline', () => {
    const briefing = buildBriefing(REFERENCE_KEY);
    if (briefing.outside.length > 0) {
      expect(briefing.headline).not.toMatch(/broadly within/i);
      for (const c of briefing.outside) {
        expect(briefing.headline.toLowerCase()).toContain(c.label.toLowerCase());
      }
    } else {
      expect(briefing.headline).toBe('Your signals are broadly within your recent baseline.');
    }
  });

  it('keeps chips and headline on the same computation', () => {
    const briefing = buildBriefing(REFERENCE_KEY);
    // A chip may only say "Within baseline"/"Stable"/"Not enough data" when the
    // shared computation agrees; anything else must appear in the headline.
    for (const c of briefing.categories) {
      if (isWithinWord(c.status) || c.status === 'Not enough data') continue;
      expect(briefing.outside.map(o => o.key)).toContain(c.key);
    }
  });

  it('uses only the SPEC §5 vocabulary', () => {
    const allowed = new Set([
      'Within baseline',
      'Stable',
      'Above recent average',
      'Below recent average',
      'Not enough data',
    ]);
    const briefing = buildBriefing(REFERENCE_KEY);
    for (const c of briefing.categories) {
      expect(allowed.has(c.status)).toBe(true);
    }
  });

  it('derives every comparison row from real observations', () => {
    const row = compareWindows('step_count', REFERENCE_KEY, 7);
    // The in-progress day must be excluded from a sum comparison …
    expect(row.excludedDays).toContain(REFERENCE_KEY);
    expect(row.comparison.valid).toBe(true);
    // … and both sides must then be the same number of complete days.
    expect(row.evaluatedDays).toBe(row.baselineDays);
    expect(row.lengthLabel).toContain('complete days');
  });
});

describe('analyst question list', () => {
  it('backs every supported question with a registered handler', () => {
    expect(unsupportedHandlerIds()).toEqual([]);
    expect(SUPPORTED_PROMPTS).toHaveLength(SUPPORTED_QUESTIONS.length);
    expect(SUPPORTED_PROMPTS.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps seriesFor import used so the dataset stays the single source', () => {
    expect(seriesFor('step_count').length).toBeGreaterThan(0);
  });
});

// ── Silencing data-quality findings (pure) ──────────────────────────────────
//
// A reader can silence a finding they cannot (or will not) resolve. The match
// rule is a check id plus a metric id, and it covers ALL of the finding's days,
// including days that show up later: nothing about a day is ever stored.
//
// Which findings are per metric: only `late-start` emits one finding per
// metric, so it is keyed by check + metric. Every other check reports ONE
// finding that spans however many metrics are affected today (the set changes
// as exports are fixed), so it is keyed by the check alone (metric id ''): a
// silence on it must not come back just because a different metric is affected.
//
// `applySilenced` is applied before anything is counted: the severity roll-ups,
// the pipeline stage text and the notes are all computed from its result.
//
// A silence on a check Vital is correcting (overlapping exports, duplicate
// readings; see `quality-correct.ts`) has nothing to hide and is left out of
// the list: the check reads "Corrected by Vital" instead. Turning a correction
// on or off removes the silence on that check altogether (the correct route).

import { getMetric } from '../metrics/registry';
import {
  QUALITY_CHECK_LABEL,
  RECENT_DAYS,
  listLabels,
  type DataQualityReport,
  type QualityCheckId,
  type QualityCheckResult,
  type QualityFinding,
  type QualitySeverity,
} from './quality';

export const QUALITY_CHECK_IDS = Object.keys(QUALITY_CHECK_LABEL) as QualityCheckId[];

/** Checks whose findings are one per metric, silenced by check + metric. */
export const PER_METRIC_CHECKS: ReadonlySet<QualityCheckId> = new Set<QualityCheckId>(['late-start']);

export interface SilencedKey {
  checkId: QualityCheckId;
  /** Registry metric id, or '' when the check is not per metric. */
  metricId: string;
}

export interface SilencedFinding {
  checkId: QualityCheckId;
  checkLabel: string;
  metricId: string;
  /** The metric(s) concerned, as people read them; '' when there are none. */
  metricLabel: string;
  title: string;
  /** Null when the silence matches nothing in today's report. */
  severity: QualitySeverity | null;
  /** True when a finding exists today and is being hidden. */
  found: boolean;
  /** Earliest and latest affected day, from the days the report lists; null without any. */
  firstDay: string | null;
  lastDay: string | null;
}

/** The metric id a finding is silenced under. */
export function findingMetricId(f: QualityFinding): string {
  return PER_METRIC_CHECKS.has(f.check) ? (f.metrics[0] ?? '') : '';
}

const keyOf = (k: SilencedKey) => `${k.checkId}\u0000${k.metricId}`;
const metricName = (id: string) => getMetric(id)?.displayName ?? id;

export interface SilencedResult {
  /** The report with the silenced findings removed and its checks brought in line. */
  report: DataQualityReport;
  /** One entry per silence, matched or not, in the order given. */
  silenced: SilencedFinding[];
}

export function applySilenced(report: DataQualityReport, silenced: readonly SilencedKey[]): SilencedResult {
  const corrected = new Set(report.checks.filter(c => c.outcome === 'corrected').map(c => c.id));
  const keys = new Map<string, SilencedKey>();
  for (const k of silenced) if (!corrected.has(k.checkId)) keys.set(keyOf(k), k);
  if (keys.size === 0) return { report, silenced: [] };

  const hidden = new Map<string, QualityFinding[]>();
  const findings: QualityFinding[] = [];
  for (const f of report.findings) {
    const key = keyOf({ checkId: f.check, metricId: findingMetricId(f) });
    if (keys.has(key)) hidden.set(key, [...(hidden.get(key) ?? []), f]);
    else findings.push(f);
  }

  const checks = report.checks.map(c => reconcileCheck(c, report.findings, findings));

  const list: SilencedFinding[] = [...keys.values()].map(k => {
    const own = hidden.get(keyOf(k)) ?? [];
    const days = own.flatMap(f => f.ranges);
    const metrics = [...new Set(own.flatMap(f => f.metrics))];
    return {
      checkId: k.checkId,
      checkLabel: QUALITY_CHECK_LABEL[k.checkId],
      metricId: k.metricId,
      metricLabel: k.metricId ? metricName(k.metricId) : listLabels(metrics),
      title: own[0]?.title ?? QUALITY_CHECK_LABEL[k.checkId],
      severity: own.length ? own.reduce<QualitySeverity>((worst, f) => (rank(f.severity) < rank(worst) ? f.severity : worst), own[0].severity) : null,
      found: own.length > 0,
      firstDay: days.length ? days.map(r => r.from).sort()[0] : null,
      lastDay: days.length ? days.map(r => r.to).sort().at(-1)! : null,
    };
  });

  return { report: { checks, findings }, silenced: list };
}

function rank(s: QualitySeverity): number {
  return s === 'problem' ? 0 : s === 'warning' ? 1 : 2;
}

/** A check whose findings were all silenced passes; one only partly silenced is rebuilt from what is left. */
function reconcileCheck(check: QualityCheckResult, before: QualityFinding[], after: QualityFinding[]): QualityCheckResult {
  const was = before.filter(f => f.check === check.id);
  const left = after.filter(f => f.check === check.id);
  if (was.length === 0 || left.length === was.length) return check;
  if (left.length === 0) return { ...check, outcome: 'pass', summary: 'Silenced: not shown as an issue.' };
  const outcome = left.every(f => f.severity === 'info') ? 'note' : 'flagged';
  const ids = left.flatMap(f => f.metrics);
  const aged = outcome === 'note' && check.summary.endsWith(` All more than ${RECENT_DAYS} days ago.`);
  return {
    ...check,
    outcome,
    summary: `${listLabels(ids)} ${ids.length === 1 ? 'starts' : 'start'} well after your other data.${aged ? ` All more than ${RECENT_DAYS} days ago.` : ''}`,
  };
}

// ── Input validation (shared by the silence routes) ─────────────────────────

export type SilenceInput = { ok: true; key: SilencedKey } | { ok: false; error: string };

export function validateSilenceInput(body: unknown): SilenceInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'The request body must be a JSON object.' };
  }
  const { checkId, metricId, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { ok: false, error: `Unknown field(s): ${Object.keys(rest).join(', ')}.` };
  if (typeof checkId !== 'string' || !(QUALITY_CHECK_IDS as string[]).includes(checkId)) {
    return { ok: false, error: `"checkId" must be one of: ${QUALITY_CHECK_IDS.join(', ')}.` };
  }
  const check = checkId as QualityCheckId;
  if (metricId !== undefined && typeof metricId !== 'string') return { ok: false, error: '"metricId" must be a string.' };
  const metric = metricId ?? '';
  if (PER_METRIC_CHECKS.has(check)) {
    if (metric === '') return { ok: false, error: `"${check}" is reported per metric: "metricId" is required.` };
    if (!getMetric(metric)) return { ok: false, error: `"metricId" is not a registered metric: ${metric}.` };
  } else if (metric !== '') {
    return { ok: false, error: `"${check}" is not reported per metric: leave "metricId" out.` };
  }
  return { ok: true, key: { checkId: check, metricId: metric } };
}

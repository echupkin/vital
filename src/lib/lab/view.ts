// ── Lab page view model (pure) ──────────────────────────────────────────────
//
// Everything the Lab page and the analyte detail page DECIDE, as pure functions
// of the series read model: grouping and ordering, status counts, the change
// from the previous observation, the interval's provenance and the chart's
// shape. No I/O, no clock, no React, so all of it is unit-tested in view.test.ts
// rather than through the DOM.
//
// THE RULES ENCODED HERE, none of which is negotiable:
//   * a missing value is NEVER rendered as 0 — every formatter returns a word;
//   * two observations sharing a date are NEVER merged into one point (the store
//     keeps both and reports `collisions`), so ordering and deltas keep both;
//   * the interval shown with a value is the interval that value was scored
//     against, and its provenance is stated in words;
//   * a non-numeric reading (NEGATIVE, TRACE, "<0.5") is never plotted as a
//     number: it is a labelled reading, and it cannot carry a numeric delta;
//   * nothing here is a judgement. "Above range" means "above the population
//     reference interval this value was scored against", never "abnormal".

import { ANALYTES, type AnalyteCategory } from './analytes';
import type { ResolvedInterval, ResultStatus, StatusTone } from './status';

/** Which pass produced a stored row. Mirrors `lab_results.extraction_method`. */
export type LabExtractionMethod = 'deterministic' | 'model' | 'manual';

/** One observation, as `/api/lab/summary` serves it. */
export interface LabPoint {
  resultId: string;
  reportId: string;
  resultOn: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  printedFlag: string | null;
  interval: ResolvedInterval;
  status: ResultStatus;
  statusLabel: string;
  tone: StatusTone;
  notes: string[];
  extractionMethod: LabExtractionMethod;
}

/** One analyte's whole series, as `/api/lab/summary` serves it. */
export interface LabAnalyte {
  analyteKey: string;
  displayName: string;
  category: AnalyteCategory;
  unit: string | null;
  registered: boolean;
  points: LabPoint[];
  /** Present in the payload; kept optional so the type never claims more. */
  first?: { value: number; on: string } | null;
  last?: { value: number; on: string } | null;
  delta?: number | null;
  collisions?: number;
  warnings?: string[];
}

/** The `/api/lab/summary` payload. */
export interface LabSummary {
  available: boolean;
  reason?: string;
  profile: { sexSet: boolean; dateOfBirthSet: boolean };
  analytes: LabAnalyte[];
  totalObservations: number;
  collisions: number;
}

/** The owner's facts that choose a band. Never inferred from a document. */
export interface LabProfileFacts {
  sexSet: boolean;
  dateOfBirthSet: boolean;
}

/** One document, as `/api/lab/reports` serves it. */
export interface LabReportDocument {
  id: string;
  kind: 'results' | 'order' | 'unknown';
  documentDate: string | null;
  labName: string | null;
  sourceFilename: string;
  createdAt: string;
  resultCount: number;
  analyteCount: number;
  dateCount: number;
  firstResultOn: string | null;
  lastResultOn: string | null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** A number as text. Deterministic, no locale grouping, no invented precision. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'no value';
  return String(Math.round(value * 1000) / 1000);
}

/**
 * One observation as the reader sees it: `15 g/dL`, or `NEGATIVE`, or — when the
 * document printed neither — the words "no value". Never `0`.
 */
export function formatReading(point: Pick<LabPoint, 'value' | 'valueText' | 'unit'>): string {
  const unit = point.unit && point.unit.trim().length > 0 ? ` ${point.unit}` : '';
  if (point.value !== null && Number.isFinite(point.value)) return `${formatNumber(point.value)}${unit}`;
  if (point.valueText && point.valueText.trim().length > 0) return `${point.valueText.trim()}${unit}`;
  return 'no value';
}

/** True when this observation carries a number that can be plotted and scored. */
export function isNumericPoint(point: Pick<LabPoint, 'value'>): boolean {
  return point.value !== null && Number.isFinite(point.value);
}

// ── The description, trimmed for the card ───────────────────────────────────

/**
 * The character budget a Lab card's description line gets: about two lines at
 * the card's width, so the card stays scannable and the chart keeps its space.
 */
export const CARD_DESCRIPTION_CHARS = 180;

/**
 * A description trimmed to the card's budget, or returned unchanged when it
 * already fits — an ellipsis appears ONLY when something was actually cut.
 *
 * The cut is made at a word boundary, so a sentence is never cut mid-word and
 * therefore never mid-number: `150-199 mg/dL` can never become `150-19…`. When
 * there is no word boundary inside the budget (a single very long token) the
 * text is returned whole rather than cut through it.
 */
export function cardDescription(text: string, maxChars: number = CARD_DESCRIPTION_CHARS): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const window = flat.slice(0, maxChars + 1);
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace <= 0) return flat;
  const cut = window.slice(0, lastSpace).replace(/[\s,;:.]+$/, '');
  return cut.length > 0 ? `${cut}…` : flat;
}

/** Whole days between two ISO dates, or null when either is unparseable. */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return null;
  const ms = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
  return Math.round(ms / 86_400_000);
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// ── Status buckets and counts ───────────────────────────────────────────────

/** The four buckets the summary strip counts. Nothing finer is shown. */
export type StatusBucket = 'in_range' | 'slightly_out' | 'out' | 'unscored';

export function statusBucket(status: ResultStatus): StatusBucket {
  switch (status) {
    case 'in_range':
      return 'in_range';
    case 'slightly_out_low':
    case 'slightly_out_high':
      return 'slightly_out';
    case 'out_low':
    case 'out_high':
    case 'out_of_expected':
      return 'out';
    default:
      return 'unscored';
  }
}

export const BUCKET_LABEL: Record<StatusBucket, string> = {
  in_range: 'In range',
  slightly_out: 'Slightly out',
  out: 'Out of range',
  unscored: 'Unscored',
};

export interface StatusCounts {
  inRange: number;
  slightlyOut: number;
  out: number;
  unscored: number;
  /** Every counted observation, so the reader can check the arithmetic. */
  total: number;
}

/**
 * COUNT observations by status bucket, across every analyte: four counts over
 * the imported rows, and nothing else — no health score, no percentage.
 */
export function countStatuses(analytes: LabAnalyte[]): StatusCounts {
  const counts: StatusCounts = { inRange: 0, slightlyOut: 0, out: 0, unscored: 0, total: 0 };
  for (const analyte of analytes) {
    for (const point of analyte.points) {
      counts.total += 1;
      switch (statusBucket(point.status)) {
        case 'in_range':
          counts.inRange += 1;
          break;
        case 'slightly_out':
          counts.slightlyOut += 1;
          break;
        case 'out':
          counts.out += 1;
          break;
        default:
          counts.unscored += 1;
      }
    }
  }
  return counts;
}

/**
 * Ordering weight: lower sorts first, so anything out of range leads. Ranked on
 * the LATEST observation, because that is the value and status the card shows —
 * an ordering that disagreed with the visible status would read as a bug.
 */
export function severityRank(status: ResultStatus): number {
  switch (statusBucket(status)) {
    case 'out':
      return 0;
    case 'slightly_out':
      return 1;
    case 'in_range':
      return 2;
    default:
      return 3;
  }
}

// ── Ordering ────────────────────────────────────────────────────────────────

/**
 * Points oldest first. Two rows sharing a date keep their own order
 * (`resultId` breaks the tie) — they are never merged into one point.
 */
export function orderedPoints(analyte: LabAnalyte): LabPoint[] {
  return [...analyte.points].sort((a, b) =>
    a.resultOn === b.resultOn ? a.resultId.localeCompare(b.resultId) : a.resultOn < b.resultOn ? -1 : 1
  );
}

export function latestPoint(analyte: LabAnalyte): LabPoint | null {
  const points = orderedPoints(analyte);
  return points.length > 0 ? points[points.length - 1]! : null;
}

/** The observation immediately before the latest one. Both are kept even on one date. */
export function previousPoint(analyte: LabAnalyte): LabPoint | null {
  const points = orderedPoints(analyte);
  return points.length > 1 ? points[points.length - 2]! : null;
}

/** The category order the registry itself is written in, so grouping is stable. */
export const CATEGORY_ORDER: AnalyteCategory[] = [
  'Lipids',
  'Metabolic',
  'CBC',
  'Liver',
  'Kidney/Electrolytes',
  'Thyroid',
  'Iron/Vitamins',
  'Inflammation',
  'Hormones',
  'Coagulation',
  'Cardiac/Muscle',
  'Other',
];

export interface AnalyteGroup {
  category: AnalyteCategory;
  /** Out of range first, then slightly out, in range, unscored; then by name. */
  analytes: LabAnalyte[];
}

export function orderAnalytes(analytes: LabAnalyte[]): LabAnalyte[] {
  return [...analytes].sort((a, b) => {
    const latestA = latestPoint(a);
    const latestB = latestPoint(b);
    const rankA = latestA ? severityRank(latestA.status) : 4;
    const rankB = latestB ? severityRank(latestB.status) : 4;
    if (rankA !== rankB) return rankA - rankB;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Group the analytes by category; empty groups are not emitted at all. */
export function groupAnalytes(analytes: LabAnalyte[]): AnalyteGroup[] {
  const byCategory = new Map<AnalyteCategory, LabAnalyte[]>();
  for (const analyte of analytes) {
    const bucket = byCategory.get(analyte.category);
    if (bucket) bucket.push(analyte);
    else byCategory.set(analyte.category, [analyte]);
  }
  const ordered: AnalyteGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const bucket = byCategory.get(category);
    if (!bucket || bucket.length === 0) continue;
    ordered.push({ category, analytes: orderAnalytes(bucket) });
    byCategory.delete(category);
  }
  // A category the order list does not know (a future registry entry) is still
  // shown rather than dropped.
  for (const [category, bucket] of byCategory) {
    ordered.push({ category, analytes: orderAnalytes(bucket) });
  }
  return ordered;
}

// ── The change from the previous observation ────────────────────────────────

export type ChangeState =
  | { kind: 'first'; text: string }
  | {
      kind: 'numeric';
      delta: number;
      deltaText: string;
      windowDays: number;
      windowText: string;
      from: LabPoint;
      to: LabPoint;
    }
  | { kind: 'unavailable'; text: string; from: LabPoint; to: LabPoint };

/**
 * The change from the observation before the latest one, with the window it
 * spans. A single observation has no change to show — that is stated, not
 * rendered as zero.
 */
export function changeFromPrevious(analyte: LabAnalyte): ChangeState | null {
  const points = orderedPoints(analyte);
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { kind: 'first', text: 'First observation for this analyte — no earlier value to compare with.' };
  }
  const to = points[points.length - 1]!;
  const from = points[points.length - 2]!;
  const days = daysBetween(from.resultOn, to.resultOn);
  const windowText =
    days === null
      ? 'over an unknown window'
      : days === 0
        ? 'recorded on the same date'
        : `over ${days} day${days === 1 ? '' : 's'}`;

  if (!isNumericPoint(from) || !isNumericPoint(to)) {
    const which = !isNumericPoint(to) ? to : from;
    return {
      kind: 'unavailable',
      text: `No numeric change: one of these readings is not a number (${formatReading(which)}), so no difference is calculated ${windowText}.`,
      from,
      to,
    };
  }

  const delta = (to.value as number) - (from.value as number);
  const unit = to.unit && to.unit.trim().length > 0 ? ` ${to.unit}` : from.unit ? ` ${from.unit}` : '';
  const sign = delta > 0 ? '+' : '';
  return {
    kind: 'numeric',
    delta,
    deltaText: `${sign}${formatNumber(delta)}${unit}`,
    windowDays: days ?? 0,
    windowText,
    from,
    to,
  };
}

// ── Interval provenance ─────────────────────────────────────────────────────

export interface IntervalProvenance {
  /** The provenance in words, exactly as the task requires it stated. */
  text: string;
  /** The interval as it should be shown, e.g. "<200 mg/dL". Null when there is none. */
  refText: string | null;
  /** Any flag the band itself carries (assay-dependent, sources disagreeing, …). */
  note: string | null;
}

/**
 * Where the interval a value was scored against came from: the report's own
 * print, the fallback table (with the band's age/sex basis), a manual entry, or
 * nothing at all — in which case the value is unscored and says so.
 */
export function intervalProvenance(interval: ResolvedInterval): IntervalProvenance {
  switch (interval.origin) {
    case 'report':
      return {
        text: 'printed on your report',
        refText: interval.refText ?? intervalText(interval.low, interval.high),
        note: null,
      };
    case 'reference_table':
      return {
        text: interval.refBasis
          ? `general reference interval (${interval.refBasis}) from the fallback table`
          : 'general reference interval from the fallback table',
        refText: interval.refText ?? intervalText(interval.low, interval.high),
        note: interval.bandNote ?? null,
      };
    case 'manual':
      return {
        text: 'reference interval entered by hand',
        refText: interval.refText ?? intervalText(interval.low, interval.high),
        note: null,
      };
    default:
      return { text: 'no reference range — not scored', refText: null, note: null };
  }
}

function intervalText(low: number | null, high: number | null): string | null {
  if (low !== null && high !== null) return `${formatNumber(low)} - ${formatNumber(high)}`;
  if (low !== null) return `> ${formatNumber(low)}`;
  if (high !== null) return `< ${formatNumber(high)}`;
  return null;
}

// ── Why a row is unscored ───────────────────────────────────────────────────

/**
 * The reason a specific observation carries no status. A sex-specific band is
 * never applied on an assumption, so when the only bands that could apply are
 * sex-specific and Sex is unset, this says so — with the place to set it.
 */
export function unscoredReason(
  analyte: LabAnalyte,
  point: LabPoint,
  profile: LabProfileFacts
): string | null {
  if (point.status === 'unscored_non_numeric') {
    return `This result was printed as a non-numeric value (${formatReading(point)}), so it cannot be scored against a numeric interval.`;
  }
  if (point.status !== 'unscored_no_range') return null;

  if (!analyte.registered) {
    return 'This analyte is not in the reference registry, so no fallback interval exists for it. Nothing is invented to score it against.';
  }

  const registry = ANALYTES.find(entry => entry.key === analyte.analyteKey) ?? null;
  const bands = registry?.bands ?? [];
  if (bands.length === 0) {
    return (
      analyte.warnings?.find(message => message.includes('not in the reference registry')) ??
      'No reference interval applies to this analyte, so it is left unscored rather than measured against a guessed number.'
    );
  }

  const sexSpecificOnly = bands.every(band => band.sex !== 'any');
  if (sexSpecificOnly && !profile.sexSet) {
    return 'A sex-specific interval would be needed here; set Sex in Settings → Account. Until then this result is left unscored rather than banded by an assumption.';
  }

  const ageBands = bands.every(band => band.minAge !== undefined || band.maxAge !== undefined);
  if (ageBands && !profile.dateOfBirthSet) {
    return 'This analyte’s reference bands depend on age and no date of birth is set, so it is left unscored. Set Date of birth in Settings → Account.';
  }

  return (
    point.notes[0] ??
    'No interval was printed on this report and no fallback band applies, so this result is left unscored.'
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentSummary {
  count: number;
  /** Earliest and latest RESULT date across the stored observations. */
  firstOn: string | null;
  lastOn: string | null;
  /** The newest document date printed on any document, or null when none printed one. */
  newestDocumentDate: string | null;
  labNames: string[];
}

export function summariseDocuments(reports: LabReportDocument[]): DocumentSummary {
  const firsts = reports.map(report => report.firstResultOn).filter((v): v is string => Boolean(v));
  const lasts = reports.map(report => report.lastResultOn).filter((v): v is string => Boolean(v));
  const documentDates = reports.map(report => report.documentDate).filter((v): v is string => Boolean(v));
  const labNames = [...new Set(reports.map(report => report.labName).filter((v): v is string => Boolean(v)))];
  return {
    count: reports.length,
    firstOn: firsts.length > 0 ? firsts.reduce((a, b) => (a < b ? a : b)) : null,
    lastOn: lasts.length > 0 ? lasts.reduce((a, b) => (a > b ? a : b)) : null,
    newestDocumentDate:
      documentDates.length > 0 ? documentDates.reduce((a, b) => (a > b ? a : b)) : null,
    labNames,
  };
}

// ── Chart model ─────────────────────────────────────────────────────────────

export type LabChartMode = 'trend' | 'range' | 'readings';

export interface ChartBand {
  low: number | null;
  high: number | null;
  /** The interval as text, e.g. "<200 mg/dL". */
  text: string | null;
  origin: ResolvedInterval['origin'];
  /** The band's provenance in words. */
  provenance: string;
  /**
   * The source in the short words the chart must state beside the band, because
   * that is what makes the band trustworthy: `printed on the report` or
   * `general reference interval`. Null when no interval applies at all.
   */
  source: string | null;
}

/** The interval's origin in the words the chart and the range card use. */
export function intervalSourceWords(origin: ResolvedInterval['origin']): string | null {
  switch (origin) {
    case 'report':
      return 'printed on the report';
    case 'reference_table':
      return 'general reference interval';
    case 'manual':
      return 'entered by hand';
    default:
      return null;
  }
}

export interface LabChartModel {
  mode: LabChartMode;
  /** Observations that carry a number, oldest first — the only ones plotted. */
  numeric: LabPoint[];
  /** Observations that carry no number: labelled readings, listed not plotted. */
  readings: LabPoint[];
  /** The interval the latest plotted value was scored against. */
  band: ChartBand | null;
  /** True when the observations were not all scored against the same interval. */
  bandVaries: boolean;
  unit: string | null;
}

/**
 * Decide what can honestly be drawn: a trend across dates for two or more
 * numeric observations, a single range-position chart for exactly one, and a
 * labelled reading list when nothing is numeric at all.
 */
export function chartModel(analyte: LabAnalyte): LabChartModel {
  const points = orderedPoints(analyte);
  const numeric = points.filter(isNumericPoint);
  const readings = points.filter(point => !isNumericPoint(point));
  const mode: LabChartMode = numeric.length >= 2 ? 'trend' : numeric.length === 1 ? 'range' : 'readings';

  const last = numeric.length > 0 ? numeric[numeric.length - 1]! : null;
  // A BAND IS DRAWN ONLY WHEN THE INTERVAL HAS A LIMIT. An interval that is only
  // a unit, or no interval at all, leaves `band` null: the chart draws nothing
  // and the card says so, rather than shading an invented range.
  const hasLimits = last !== null && (last.interval.low !== null || last.interval.high !== null);
  const band: ChartBand | null =
    last && hasLimits
      ? {
          low: last.interval.low,
          high: last.interval.high,
          text: intervalProvenance(last.interval).refText,
          origin: last.interval.origin,
          provenance: intervalProvenance(last.interval).text,
          source: intervalSourceWords(last.interval.origin),
        }
      : null;

  const bandVaries =
    numeric.length > 1 &&
    numeric.some(
      point =>
        point.interval.low !== last?.interval.low ||
        point.interval.high !== last?.interval.high ||
        point.interval.origin !== last?.interval.origin
    );

  return { mode, numeric, readings, band, bandVaries, unit: analyte.unit };
}

/** The axis bounds a chart needs, always including the interval band. */
export function chartDomain(model: LabChartModel): [number, number] | null {
  const values = model.numeric.map(point => point.value as number);
  if (model.band?.low !== null && model.band?.low !== undefined) values.push(model.band.low);
  if (model.band?.high !== null && model.band?.high !== undefined) values.push(model.band.high);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

/**
 * The reference range as the range card shows it: the two printed limits with
 * the unit, or the single limit the interval actually has. Never invents an end
 * the report did not print.
 */
export function referenceRangeText(band: ChartBand, unit: string | null): string {
  const suffix = unit && unit.trim().length > 0 ? ` ${unit.trim()}` : '';
  if (band.low !== null && band.high !== null) {
    return `${formatNumber(band.low)} – ${formatNumber(band.high)}${suffix}`;
  }
  if (band.high !== null) return `up to ${formatNumber(band.high)}${suffix}`;
  if (band.low !== null) return `${formatNumber(band.low)}${suffix} or more`;
  return 'no numeric limit printed';
}

/** A sentence a screen reader can read in place of the chart. */
export function chartDescription(analyteName: string, model: LabChartModel): string {
  const unit = model.unit && model.unit.trim().length > 0 ? ` ${model.unit}` : '';
  if (model.mode === 'readings') {
    const shown = model.readings.map(point => `${formatReading(point)} on ${point.resultOn}`).join('; ');
    return `${analyteName}: no numeric values were printed, so nothing is plotted. Readings: ${shown}.`;
  }
  if (model.mode === 'range') {
    const point = model.numeric[0]!;
    const band = model.band;
    const inside =
      band && band.low !== null && band.high !== null
        ? point.value! >= band.low && point.value! <= band.high
          ? 'inside'
          : 'outside'
        : 'position unknown against';
    return `${analyteName}: one observation, ${formatReading(point)}, recorded ${point.resultOn}, ${inside} the interval ${
      band?.text ?? 'none'
    }${band?.source ? ` (${band.source})` : ''}.${
      band ? '' : ' No reference interval with numeric limits applies, so no band is drawn.'
    } Status: ${point.statusLabel}.`;
  }
  const first = model.numeric[0]!;
  const last = model.numeric[model.numeric.length - 1]!;
  const values = model.numeric.map(point => point.value as number);
  return `${analyteName}: ${model.numeric.length} observations from ${first.resultOn} to ${last.resultOn}, ranging ${formatNumber(
    Math.min(...values)
  )} to ${formatNumber(Math.max(...values))}${unit}. Interval band ${model.band?.text ?? 'none'}${
    model.band?.source ? `, ${model.band.source}` : ''
  }${model.band ? '' : ' — no reference interval with numeric limits applies, so no band is drawn'}. Latest ${formatReading(
    last
  )} on ${last.resultOn}: ${last.statusLabel}.`;
}

// ── The page as a whole ─────────────────────────────────────────────────────

/** True when there is nothing to show: no documents, so no observations. */
export function hasNoDocuments(reports: LabReportDocument[]): boolean {
  return reports.length === 0;
}

/**
 * True when documents are stored but produced no observation at all. The page
 * says so rather than looking like an empty database.
 */
export function hasDocumentsWithoutResults(reports: LabReportDocument[], analytes: LabAnalyte[]): boolean {
  return reports.length > 0 && analytes.length === 0;
}

/** Every registered analyte in a category, for the detail page's "related" list. */
export function relatedAnalytes(analyteKey: string, category: AnalyteCategory, present: string[]): string[] {
  const fromRegistry = ANALYTES.filter(entry => entry.category === category && entry.key !== analyteKey).map(
    entry => entry.key
  );
  const extras = present.filter(key => key !== analyteKey && !fromRegistry.includes(key));
  return [...extras, ...fromRegistry].slice(0, 12);
}

// ── The detail page's own range control ─────────────────────────────────────

/**
 * The observations inside a range, measured BACK FROM THE NEWEST OBSERVATION,
 * never from today: a document imported ten years late must not fall outside
 * every window. `days === null` means "all", which returns every point.
 */
export function filterByRange(points: LabPoint[], days: number | null): LabPoint[] {
  if (days === null || points.length === 0) return points;
  const newest = points.reduce((a, b) => (a.resultOn > b.resultOn ? a : b)).resultOn;
  return points.filter(point => {
    const gap = daysBetween(point.resultOn, newest);
    return gap !== null && gap <= days;
  });
}

// ── The analyst's lab context block (pure) ───────────────────────────────────
//
// Before this gate the analyst's context was metric summaries, metric pairs and
// workouts only: the owner's lab observations — five documents, printed
// reference intervals, dates and qualitative results — were invisible to the
// model and could not honestly be cited. This module builds the missing block.
//
// DETERMINISTIC, NO MODEL CALLS. Everything here is a pure function of the
// series read model the Lab page renders (see ../lab/view and ../lab/status), so
// the block states exactly what the Lab UI states: the same interval, the same
// provenance words, the same status label. Nothing is invented, nothing is
// rounded into a value the document did not print, and a qualitative result is
// never turned into a number.
//
// BOUNDED, AND IT SAYS SO. At most MAX_LAB_SERIES series are carried, each with
// the latest and previous observation (so "is it moving?" is answerable); when
// the question names an analyte, that analyte's series carries up to
// MAX_POINTS_PER_SERIES observations — the same cap the metric retrieval uses.
// When more series exist than are shown, the block's own `note` says so; it is
// never truncated silently.
//
// WHAT IS NOT HERE. No diagnosis, no "normal"/"safe" verdict, no risk score: the
// status label is the same population-interval verdict the Lab page shows, and
// the reference interval is stated with its basis (printed on the report vs a
// general fallback) so the model can tell the two apart.

import { ANALYTES } from '../lab/analytes';
import { daysBetween, formatNumber, formatReading, intervalProvenance } from '../lab/view';
import type { ResolvedInterval, ResultStatus, StatusTone } from '../lab/status';
import type { PanelSpecimen } from '../lab/panel';
import type { LabContextSnapshot, LabSnapshotReading, LabSnapshotSeries } from './types';
import { MAX_POINTS_PER_SERIES, type LabSpec } from './retrieval';

/**
 * The number of series the overview block carries.
 *
 * BUDGET REASONING (measured, not guessed). One entry — its latest and previous
 * reading with their intervals, plus the display strings — serializes to about
 * 1.4 KB, so 40 series would be ~57 KB of the context, nearly twice the ~32 KB
 * the WHOLE general metric selection already occupies (14 summaries over 30
 * days). 20 series is ~29 KB: a lab block comparable to the metric context it
 * travels with, not one that pushes it out. The owner's data holds ~126 series,
 * so the block states "showing the 20 most recently measured of 126" — and a
 * question that names an analyte is not limited by this cap at all: it gets that
 * analyte's own bounded history (≤ MAX_POINTS_PER_SERIES observations).
 */
export const MAX_LAB_SERIES = 20;

/** The words that make a question a lab question rather than a wearable one. */
export const LAB_TOPIC_RE =
  /(?:^|[^a-z])(lab|labs|labwork|lab ?result|blood ?work|blood ?test|blood ?panel|blood ?result|panel|cholesterol|a1c|hba1c|egfr|creatinine|testosterone|ferritin|tsh|thyroid|ldl|hdl|triglyceride|triglycerides|ha?emoglobin|psa|lipid|vitamin d|metabolic)(?:[^a-z]|$)/i;

/**
 * Analyte names that are ordinary health-log words too. `protein` is a logged
 * macro as often as it is a lab analyte, so it only selects the lab block when
 * the question also carries a lab word ("my protein lab result", not "how much
 * protein am I eating?").
 */
const AMBIGUOUS_ANALYTE_KEYS = new Set(['protein']);

// ── Input: the series read model, flattened ──────────────────────────────────

/** One observation, already scored — the shape the loader hands over. */
export interface LabSeriesObservationInput {
  /** ISO observation date (`resultOn`). */
  on: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  /** The reference cell exactly as the document printed it, or null. */
  printedRefText: string | null;
  interval: ResolvedInterval;
  status: ResultStatus;
  statusLabel: string;
  tone: StatusTone;
}

/** One series (analyte + specimen), ordered oldest → newest by its points. */
export interface LabSeriesInput {
  seriesKey: string;
  analyteKey: string;
  /** Already qualified `(blood)`/`(urine)` where a collision exists. */
  displayName: string;
  specimen: PanelSpecimen;
  registered: boolean;
  unit: string | null;
  points: LabSeriesObservationInput[];
}

/** Everything the loader read, with the totals the block must state. */
export interface LabSourceInput {
  available: boolean;
  reason: string | null;
  documents: number;
  totalObservations: number;
  collisions: number;
  series: LabSeriesInput[];
}

// ── Which analyte a question is about ────────────────────────────────────────

export interface RequestedAnalyte {
  key: string;
  displayName: string;
  /** The name the question used, as the registry spells it. */
  matched: string;
}

/** Lowercase, punctuation → single spaces, trimmed. Word-boundary matching. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Candidate {
  key: string;
  displayName: string;
  name: string;
  words: string;
}

const CANDIDATES: Candidate[] = ANALYTES.flatMap(analyte => {
  const names = [...new Set([analyte.displayName, ...analyte.aliases])];
  return names
    // The registry's own spelling, plus its own name truncated at the first
    // comma: `Vitamin D, 25-Hydroxy` is how the document prints it, and "vitamin
    // d" is how a question names it. Nothing is invented — the shorter form is
    // the registry's own words.
    .flatMap(name => [name, name.split(',')[0]!.trim()])
    .map(name => ({ key: analyte.key, displayName: analyte.displayName, name, words: words(name) }))
    .filter(candidate => candidate.words.length >= 2);
}).sort((a, b) => b.words.length - a.words.length);

/**
 * The analyte a question names, matched against the registry's own names and
 * aliases on whole-word boundaries (`ldl-c`, `a1c`, `egfr`, `testosterone`). The
 * longest name wins, so "free testosterone" beats "testosterone". Returns null
 * when the question names no registered analyte.
 */
export function analyteRequestedBy(question: string): RequestedAnalyte | null {
  const haystack = ` ${words(question)} `;
  for (const candidate of CANDIDATES) {
    if (haystack.includes(` ${candidate.words} `)) {
      return { key: candidate.key, displayName: candidate.displayName, matched: candidate.name };
    }
  }
  return null;
}

/**
 * True when a question should select the lab block for a NAMED analyte. A lab
 * word always qualifies; an ambiguous name (see AMBIGUOUS_ANALYTE_KEYS) needs
 * one, so a nutrition question about protein does not read as a lab question.
 */
export function looksLikeLabQuestion(question: string): boolean {
  const requested = analyteRequestedBy(question);
  if (!requested) return false;
  if (AMBIGUOUS_ANALYTE_KEYS.has(requested.key) && !LAB_TOPIC_RE.test(question)) return false;
  return true;
}

// ── Readings and their display strings ───────────────────────────────────────

/** True when a printed cell is a plain number (`5.2`) rather than a word or a bound (`NEGATIVE`, `<30`, `1+`). */
function isPlainNumber(text: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(text.trim());
}

/**
 * The printed result text when it is NOT a plain number — `NEGATIVE`,
 * `NONE SEEN`, `<30`, `1+`. Null when the cell is a plain number (in which case
 * the numeric value and its unit are what a reader needs).
 */
export function printedResultOf(reading: LabSnapshotReading): string | null {
  const printed = (reading.valueText ?? '').trim();
  return printed.length > 0 && !isPlainNumber(printed) ? printed : null;
}

/**
 * The reading as a reader sees it: `210 mg/dL`, or the printed word/bound
 * (`NEGATIVE`, `1+`) — never a number the document did not print. A bounded
 * result is shown as the bound, so `1+` is never rendered as `1`.
 */
export function readingText(reading: LabSnapshotReading): string {
  const unit = reading.unit && reading.unit.trim().length > 0 ? ` ${reading.unit}` : '';
  const printed = printedResultOf(reading);
  if (printed) return `${printed}${unit}`;
  return formatReading({ value: reading.value, valueText: reading.valueText, unit: reading.unit });
}

function toReading(point: LabSeriesObservationInput): LabSnapshotReading {
  const prov = intervalProvenance(point.interval);
  const printed = point.printedRefText !== null && point.printedRefText.trim().length > 0 ? point.printedRefText.trim() : null;
  return {
    on: point.on,
    value: point.value,
    valueText: point.valueText,
    unit: point.unit,
    printedRefText: printed,
    // What the Lab surfaces show beside the value: the cell the document printed
    // when there is one, else the resolved interval.
    intervalText: printed ?? prov.refText,
    intervalBasis: prov.text,
    status: point.status,
    statusLabel: point.statusLabel,
    tone: point.tone,
    interval: point.interval,
  };
}

/** The change between two readings, or the words that say it cannot be given. */
function changeText(previous: LabSnapshotReading, latest: LabSnapshotReading): string {
  if (previous.value === null || latest.value === null) return 'no numeric change (one reading is not a number)';
  const delta = latest.value - previous.value;
  const unit = latest.unit && latest.unit.trim().length > 0 ? ` ${latest.unit}` : previous.unit ? ` ${previous.unit}` : '';
  const days = daysBetween(previous.on, latest.on);
  const over = days === null ? '' : days === 0 ? ' on the same date' : ` over ${days} day${days === 1 ? '' : 's'}`;
  return `${delta > 0 ? '+' : ''}${formatNumber(delta)}${unit}${over}`;
}

/** One compact line per series, inside the untrusted block. */
function lineFor(series: LabSeriesInput, latest: LabSnapshotReading, previous: LabSnapshotReading | null): string {
  const interval = latest.intervalText ? ` against ${latest.intervalText} (${latest.intervalBasis})` : ` (${latest.intervalBasis})`;
  const printed = printedResultOf(latest);
  const qualitative = printed
    ? ` — printed "${printed}", the report expects "${latest.printedRefText ?? latest.intervalText ?? 'no expected value'}"`
    : '';
  const prev = previous ? `; previous ${readingText(previous)} on ${previous.on}` : '; no earlier observation';
  return `${series.displayName}: latest ${readingText(latest)} on ${latest.on} — ${latest.statusLabel}${interval}${qualitative}${prev}`;
}

function seriesSnapshot(input: LabSeriesInput, mode: 'overview' | 'analyte', maxPoints: number): LabSnapshotSeries {
  const points = input.points;
  const latestPoint = points.length > 0 ? points[points.length - 1]! : null;
  const previousPoint = points.length > 1 ? points[points.length - 2]! : null;
  const latest = latestPoint ? toReading(latestPoint) : null;
  const previous = previousPoint ? toReading(previousPoint) : null;

  // Overview keeps only the two readings a line needs; an analyte question keeps
  // the bounded history so a trend is answerable. The overview carries no
  // separate history array — latest/previous already hold those two readings.
  const historyPoints = mode === 'analyte' ? points.slice(-maxPoints) : points.slice(-2);
  const history = mode === 'analyte' ? historyPoints.map(toReading) : [];
  const shownPoints = mode === 'analyte' ? history.length : Math.min(points.length, 2);
  const truncated = points.length > shownPoints;

  const display: Record<string, string> = {
    name: input.displayName,
    specimen: input.specimen === 'urine' ? 'urine series' : 'blood/other series',
    observations: String(points.length),
    coverage: `${points.length} observation${points.length === 1 ? '' : 's'} stored for this series`,
  };
  if (latest) {
    display.latest = readingText(latest);
    display.latestOn = latest.on;
    display.status = latest.statusLabel;
    display.interval = latest.intervalText ?? 'no interval printed';
    display.intervalBasis = latest.intervalBasis;
    display.previous = previous ? readingText(previous) : 'no earlier observation';
    if (previous) display.previousOn = previous.on;
    if (previous) display.change = changeText(previous, latest);
    const printed = printedResultOf(latest);
    if (printed) {
      display.printedResult = printed;
      display.expectedResult = latest.printedRefText ?? latest.intervalText ?? 'no expected value printed';
    }
    display.line = lineFor(input, latest, previous);
  }
  if (mode === 'analyte' && history.length > 0) {
    display.history = history.map(reading => `${readingText(reading)} on ${reading.on} (${reading.statusLabel})`).join('; ');
  }
  if (truncated) {
    display.historyTruncated = `showing the ${shownPoints} most recent of ${points.length} observations`;
  }

  return {
    seriesKey: input.seriesKey,
    displayName: input.displayName,
    specimen: input.specimen,
    registered: input.registered,
    unit: input.unit,
    observations: points.length,
    shownPoints,
    truncated,
    latest,
    previous,
    history,
    display,
  };
}

// ── The block ────────────────────────────────────────────────────────────────

function recencyOf(series: LabSeriesInput): string {
  const last = series.points.length > 0 ? series.points[series.points.length - 1]!.on : '';
  return last;
}

export interface BuildLabSnapshotOptions {
  question: string;
  spec?: LabSpec | null;
  maxSeries?: number;
  maxPoints?: number;
}

/** A snapshot that states, in words, why there is no lab data. */
function unavailableSnapshot(reason: string): LabContextSnapshot {
  return {
    available: false,
    reason,
    documents: 0,
    totalObservations: 0,
    totalSeries: 0,
    collisions: 0,
    selection: 'overview',
    requestedAnalyte: null,
    requestedName: null,
    found: false,
    shownSeries: 0,
    note: reason,
    series: [],
  };
}

/**
 * Build the bounded lab block for a question.
 *
 * A question that names an analyte gets that analyte's bounded history (and, if
 * the data does not hold it, `found: false` — never another analyte substituted
 * for it). Any other question gets the overview: the most recently measured
 * series, latest and previous observation each. Both state their own bound.
 */
export function buildLabSnapshot(source: LabSourceInput, options: BuildLabSnapshotOptions): LabContextSnapshot {
  if (!source.available) return unavailableSnapshot(source.reason ?? 'No lab results are available in the context.');

  const maxSeries = options.maxSeries ?? MAX_LAB_SERIES;
  const maxPoints = options.maxPoints ?? MAX_POINTS_PER_SERIES;
  const requested = looksLikeLabQuestion(options.question) ? analyteRequestedBy(options.question) : null;
  const mode: 'overview' | 'analyte' = requested ? 'analyte' : 'overview';

  const base = {
    available: true,
    reason: null,
    documents: source.documents,
    totalObservations: source.totalObservations,
    totalSeries: source.series.length,
    collisions: source.collisions,
    selection: mode,
    requestedAnalyte: requested?.key ?? null,
    requestedName: requested?.displayName ?? null,
  } as const;

  if (mode === 'analyte' && requested) {
    const matches = source.series
      .filter(series => series.analyteKey === requested.key)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (matches.length === 0) {
      return {
        ...base,
        found: false,
        shownSeries: 0,
        note: `no lab results for "${requested.displayName}" were found among the ${source.series.length} stored lab series`,
        series: [],
      };
    }
    return {
      ...base,
      found: true,
      shownSeries: matches.length,
      note: `showing the ${matches.length} series for "${requested.displayName}" out of ${source.series.length} stored lab series; each carries up to the last ${maxPoints} observations`,
      series: matches.map(series => seriesSnapshot(series, 'analyte', maxPoints)),
    };
  }

  const ordered = [...source.series].sort((a, b) => {
    const recency = recencyOf(b).localeCompare(recencyOf(a));
    return recency !== 0 ? recency : a.displayName.localeCompare(b.displayName);
  });
  const shown = ordered.slice(0, maxSeries);
  const note =
    shown.length < source.series.length
      ? `showing the ${shown.length} most recently measured of ${source.series.length} lab series`
      : `showing all ${source.series.length} lab series`;

  return {
    ...base,
    found: true,
    shownSeries: shown.length,
    note,
    series: shown.map(series => seriesSnapshot(series, 'overview', maxPoints)),
  };
}

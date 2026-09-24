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
//
// THE CAP NEVER HIDES A NAME. A capped block carries `notIncludedSeries`: the
// display names of every stored series it left out, with `capped: true` and a
// `note` that states the rule. A series that EXISTS can therefore never be
// reported as "not recorded" — the model is given the distinction in the data
// and the prompt requires it (see systemPrompt.ts). A named-analyte question is
// not limited by this cap at all: it fetches that analyte's own bounded history.
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
 * 1.4 KB. Measured against the owner's own dataset (104 series, 10 categories),
 * the 20-series overview block — including the list of the 84 series it left out
 * — is 28,844 bytes (≈1.4 KB per entry), against the ~32 KB the WHOLE general
 * metric selection already occupies (14 summaries over 30 days). Forty series
 * would be ~55 KB: a lab block that pushes the metric context out rather than
 * travelling with it. A question that names an analyte is not limited by this
 * cap at all: it gets that analyte's own bounded history (≤
 * MAX_POINTS_PER_SERIES observations).
 *
 * WHAT THE CAP SELECTS (see `overviewSelection`). Not twenty series picked by
 * newest date alone: when many series share one newest date (one document), that
 * rule shows an arbitrary alphabetical slice of a single day and hides
 * everything else. The block instead carries, in order: the most recent series
 * overall, the most recent series in each category the data holds, the
 * longest-running series, and then the most recently measured to fill the
 * budget. Whatever it leaves out is named in `notIncludedSeries`.
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
  /** The registry's category, or 'Other' for an unrecognised analyte. */
  category: string;
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

/** A series' category, or 'Other' when the loader did not state one. */
function categoryOf(series: LabSeriesInput): string {
  const category = series.category;
  return typeof category === 'string' && category.trim().length > 0 ? category : 'Other';
}

/** Most recently measured first; ties broken by name, so the order is stable. */
function byRecency(a: LabSeriesInput, b: LabSeriesInput): number {
  const recency = recencyOf(b).localeCompare(recencyOf(a));
  return recency !== 0 ? recency : a.displayName.localeCompare(b.displayName);
}

/**
 * The series an overview block carries, inside a budget.
 *
 * Why not "the most recently measured"? The owner's documents put ~90 series on
 * ONE newest date, so newest-date-only shows an arbitrary alphabetical slice of a
 * single day and hides every other series — the exact defect gate 29k fixes.
 *
 * The rule, in priority order, each pick once:
 *   1. the most recent series overall (the freshest thing the owner has);
 *   2. the most recent series in EACH category the data holds (coverage of what
 *      the owner actually has, not one panel);
 *   3. the longest-running series (where a trend is answerable at all);
 *   4. the most recently measured, to fill any remaining budget.
 *
 * Deterministic: recency, then observation count, then display name. Whatever it
 * does not reach is named in `notIncludedSeries`, so the block is never silent
 * about what it left out.
 */
export function overviewSelection(series: LabSeriesInput[], budget: number): LabSeriesInput[] {
  const ordered = [...series].sort(byRecency);
  const picked: LabSeriesInput[] = [];
  const seen = new Set<string>();
  const take = (candidate: LabSeriesInput | undefined): void => {
    if (!candidate || picked.length >= budget || seen.has(candidate.seriesKey)) return;
    seen.add(candidate.seriesKey);
    picked.push(candidate);
  };

  // 1. The most recent series overall.
  take(ordered[0]);

  // 2. The most recent series in each category the data holds.
  const byCategory = new Map<string, LabSeriesInput>();
  for (const candidate of ordered) {
    const category = categoryOf(candidate);
    if (!byCategory.has(category)) byCategory.set(category, candidate);
  }
  for (const candidate of [...byCategory.values()].sort(byRecency)) take(candidate);

  // 3. The series with a multi-observation history, longest first: these are the
  //    ones a "how has it changed?" question can be answered from.
  const withHistory = series
    .filter(candidate => candidate.points.length > 1)
    .sort((a, b) => b.points.length - a.points.length || byRecency(a, b));
  for (const candidate of withHistory) take(candidate);

  // 4. Fill the remaining budget with the most recently measured.
  for (const candidate of ordered) take(candidate);

  return picked;
}

export interface BuildLabSnapshotOptions {
  question: string;
  /**
   * The lab selection the handler declared (see retrieval.ts). Advisory: the
   * QUESTION decides — a question that names an analyte always selects that
   * analyte's series, whatever spec the handler declared, so the snapshot cap can
   * never hide a series the owner asked about. Kept so a caller can state its
   * intent and a test can pin it.
   */
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
    capped: false,
    note: reason,
    notIncludedSeries: [],
    series: [],
  };
}

/**
 * Build the bounded lab block for a question.
 *
 * A question that names an analyte gets that analyte's bounded history — the
 * snapshot cap does NOT apply to it, so an analyte the owner asks about can never
 * be hidden by a cap that happened to fill up on other series — and, if the data
 * does not hold it, `found: false` (never another analyte substituted for it).
 *
 * Any other question gets the overview: see `overviewSelection` for what the
 * budget is spent on. A block that does not carry every series sets `capped` and
 * names what it left out in `notIncludedSeries`, so "the data does not hold this"
 * can never be said about a series that exists.
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

  /** The names of the series this block does not carry, so absence is never assumed. */
  const namesNotIn = (carried: LabSeriesInput[]): string[] => {
    const shownKeys = new Set(carried.map(series => series.seriesKey));
    return source.series
      .filter(series => !shownKeys.has(series.seriesKey))
      .map(series => series.displayName)
      .sort((a, b) => a.localeCompare(b));
  };

  if (mode === 'analyte' && requested) {
    // NOT LIMITED BY THE SNAPSHOT CAP: the named analyte's series are fetched in
    // full (bounded per series), whatever the cap would have selected.
    const matches = source.series
      .filter(series => series.analyteKey === requested.key)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (matches.length === 0) {
      // The canonical key is not held at all — a genuine absence, stated as such.
      return {
        ...base,
        found: false,
        shownSeries: 0,
        capped: false,
        note: `no lab results for "${requested.displayName}" were found among the ${source.series.length} stored lab series`,
        notIncludedSeries: [],
        series: [],
      };
    }
    return {
      ...base,
      found: true,
      shownSeries: matches.length,
      capped: false,
      note: `showing the ${matches.length} series for "${requested.displayName}" out of ${source.series.length} stored lab series; each carries up to the last ${maxPoints} observations`,
      notIncludedSeries: namesNotIn(matches),
      series: matches.map(series => seriesSnapshot(series, 'analyte', maxPoints)),
    };
  }

  const shown = overviewSelection(source.series, maxSeries);
  const leftOut = source.series.length - shown.length;
  const note =
    leftOut > 0
      ? `showing ${shown.length} of ${source.series.length} lab series — the most recent result overall, the most recent result in each category, and the longest-running series; the other ${leftOut} series exist in the data and are named in notIncludedSeries`
      : `showing all ${source.series.length} lab series`;

  return {
    ...base,
    found: true,
    shownSeries: shown.length,
    capped: leftOut > 0,
    note,
    notIncludedSeries: namesNotIn(shown),
    series: shown.map(series => seriesSnapshot(series, 'overview', maxPoints)),
  };
}
